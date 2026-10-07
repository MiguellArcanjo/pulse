import Fastify from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import type { Db } from "../db/db.ts";
import { createEntry, createInvestigation, createProject, confirmFinding, dashboard, projectHome, projects, projectsOverview, ResearchError, saveSettings, search, settings, snapshot, updateProjectDetails } from "./store.ts";

const ProjectParams = z.object({ projectId: z.uuid() });
const InvestigationParams = ProjectParams.extend({ investigationId: z.uuid() });

/** Instância exclusivamente local, independente da API e autenticação do Morph. */
export function buildResearchApp(db: Db, origin: string, uiDirectory?: string) {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  const token = randomBytes(32).toString("hex");
  const host = new URL(origin).host;
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin)) return reply.code(403).send({ error: "Origem não permitida." });
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    if (!req.url.startsWith("/api/")) return;
    const supplied = req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith("research_session="))?.slice("research_session=".length) ?? "";
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply.code(401).send({ error: "Abra o workspace para iniciar uma sessão local." });
    if (req.method !== "GET" && req.headers.origin !== origin) return reply.code(403).send({ error: "Origem obrigatória." });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Revise os campos informados.", issues: err.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
    if (err instanceof ResearchError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    return reply.code(status && status >= 400 && status < 500 ? status : 500).send({ error: "Não foi possível concluir a operação." });
  });
  app.get("/", async (_req, reply) => {
    // O segredo fica em cookie HttpOnly; nunca no JavaScript ou no log.
    reply.header("Set-Cookie", `research_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return reply.type("text/html").send(uiDirectory ? await readFile(join(uiDirectory, "index.html")) : "Workspace local");
  });
  if (uiDirectory) app.get("/assets/:file", async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[a-zA-Z0-9_-]+\.(js|css)$/) }).parse(req.params);
    try { return reply.type(file.endsWith(".js") ? "text/javascript" : "text/css").send(await readFile(join(uiDirectory, "assets", file))); }
    catch { return reply.code(404).send({ error: "Arquivo não encontrado." }); }
  });
  app.get("/api/dashboard", async () => dashboard(db));
  app.get("/api/search", async req => ({ results: await search(db, z.object({ q: z.string().max(200).default("") }).parse(req.query).q) }));
  app.get("/api/settings", async () => settings(db));
  app.put("/api/settings", async req => saveSettings(db, req.body));
  app.get("/api/projects", async () => ({ projects: await projects(db) }));
  app.get("/api/projects-overview", async () => ({ projects: await projectsOverview(db) }));
  app.patch("/api/projects/:projectId", async req => updateProjectDetails(db, ProjectParams.parse(req.params).projectId, req.body));
  app.post("/api/projects", async (req, reply) => reply.code(201).send(await createProject(db, req.body)));
  app.get("/api/projects/:projectId", async req => snapshot(db, ProjectParams.parse(req.params).projectId));
  app.get("/api/projects/:projectId/home", async req => projectHome(db, ProjectParams.parse(req.params).projectId));
  app.post("/api/projects/:projectId/investigations", async (req, reply) => reply.code(201).send(await createInvestigation(db, ProjectParams.parse(req.params).projectId, req.body)));
  app.post("/api/projects/:projectId/investigations/:investigationId/entries", async (req, reply) => {
    const p = InvestigationParams.parse(req.params);
    return reply.code(201).send(await createEntry(db, p.projectId, p.investigationId, req.body));
  });
  app.post("/api/projects/:projectId/investigations/:investigationId/findings", async (req, reply) => {
    const p = InvestigationParams.parse(req.params);
    return reply.code(201).send(await confirmFinding(db, p.projectId, p.investigationId, req.body));
  });
  return app;
}
