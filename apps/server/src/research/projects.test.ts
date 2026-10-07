import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { pgliteDb } from "../db/pglite.ts";
import { buildResearchApp } from "./app.ts";
import { buildProjectsOverview } from "./projects-overview.ts";
import { confirmFinding, createEntry, createInvestigation, createProject, project, projectsOverview, snapshot, updateProjectDetails } from "./store.ts";

let db: Db;
before(async () => {
  db = await pgliteDb("memory://");
  await migrate(db, fileURLToPath(new URL("../../research-migrations/", import.meta.url)));
});
after(async () => {
  await db.close();
});

const base = {
  name: "Apart",
  type: "OWN_PROJECT",
  authorizationSource: "Projeto próprio.",
  authorizationExpiresAt: null,
  environment: "PRODUCTION",
  allowedHosts: ["api.apart.test", "app.apart.test"],
  deniedHosts: [],
  restrictions: "Somente revisão manual.",
};

test("projeto nasce Ativo, com descrição, tags e links opcionais", async () => {
  const p = await createProject(db, { ...base, description: "Comunicação em tempo real.", tags: ["Node.js", "Node.js", "WebSocket"], links: { site: "https://apart.test" } });
  assert.equal(p.status, "ACTIVE");
  assert.deepEqual(p.tags, ["Node.js", "WebSocket"]);
  await assert.rejects(createProject(db, { ...base, links: { site: "javascript:alert(1)" } }));
  await assert.rejects(createProject(db, { ...base, links: { repository: "file:///c:/x" } }));
});

test("status inicial, tipo de alvo e criticidade vêm do assistente e podem ser editados", async () => {
  const p = await createProject(db, { ...base, status: "ANALYSIS", target: "API", criticality: "HIGH" });
  assert.equal(p.status, "ANALYSIS");
  assert.equal(p.target, "API");
  assert.equal(p.criticality, "HIGH");
  await assert.rejects(createProject(db, { ...base, target: "SATELLITE" }));
  await assert.rejects(createProject(db, { ...base, allowedHosts: ["*.apart.test"] }));
  const next = await updateProjectDetails(db, p.id, { criticality: "LOW", target: "WEB" });
  assert.equal(next.criticality, "LOW");
  assert.equal(next.target, "WEB");
  assert.deepEqual(next.allowedHosts, base.allowedHosts);
});

test("editar status e informações registra evento e não toca no escopo", async () => {
  const p = await createProject(db, base);
  const updated = await updateProjectDetails(db, p.id, { status: "PAUSED", description: "Pausado até a próxima sprint.", tags: ["API"] });
  assert.equal(updated.status, "PAUSED");
  assert.equal(updated.scopeVersion, 1);
  assert.deepEqual(updated.allowedHosts, base.allowedHosts);
  // Campos de escopo/autorização não são aceitos aqui.
  await assert.rejects(updateProjectDetails(db, p.id, { allowedHosts: ["outro.test"] }));
  await assert.rejects(updateProjectDetails(db, p.id, {}));
  // Descrição vazia remove a descrição.
  const cleared = await updateProjectDetails(db, p.id, { description: "" });
  assert.equal(cleared.description, undefined);
  const events = (await snapshot(db, p.id)).events;
  assert.equal(events[1]?.summary, "Status alterado: Ativo → Pausado.");
  assert.equal((await project(db, p.id)).status, "PAUSED");
});

test("progresso é a média das etapas das investigações, e a série mostra a evolução", async () => {
  const fresh = await pgliteDb("memory://");
  await migrate(fresh, fileURLToPath(new URL("../../research-migrations/", import.meta.url)));
  try {
    const p = await createProject(fresh, base);
    let [o] = await projectsOverview(fresh);
    assert.equal(o?.progress, 0, "sem investigações: 0%");
    const i1 = await createInvestigation(fresh, p.id, { title: "A", assetHost: "api.apart.test", objective: "x" });
    await createInvestigation(fresh, p.id, { title: "B", assetHost: "app.apart.test", objective: "x" });
    const h = await createEntry(fresh, p.id, i1.id, { kind: "HYPOTHESIS", title: "h", content: "c", source: "s" });
    const e = await createEntry(fresh, p.id, i1.id, { kind: "EVIDENCE", title: "e", content: "c", source: "s", relatedIds: [h.id] });
    [o] = await projectsOverview(fresh);
    assert.equal(o?.progress, 38, "(3 + 0) / 8 = 37,5% → 38%");
    await confirmFinding(fresh, p.id, i1.id, { hypothesisId: h.id, evidenceIds: [e.id], title: "f", severity: "LOW", impact: "i", reproduction: "r", rationale: "j", confirmed: true });
    [o] = await projectsOverview(fresh);
    assert.equal(o?.progress, 50);
    assert.equal(o?.hypotheses, 1);
    assert.equal(o?.findings, 1);
    assert.equal(o?.assets, 2);
    assert.equal(o?.series.length, 30);
    assert.equal(o?.series.at(-1)?.progress, 50);
  } finally {
    await fresh.close();
  }
});

test("série: antes de o projeto existir não há ponto; depois, acompanha as etapas", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const [o] = buildProjectsOverview({
    now,
    projects: [{ ...base, id: "p", createdAt: "2026-10-01T12:00:00Z", scopeVersion: 1, status: "ACTIVE" } as never],
    investigations: [{ id: "i", projectId: "p", title: "t", assetHost: "api.apart.test", objective: "o", createdAt: "2026-10-02T12:00:00Z" }],
    entries: [{ id: "h", investigationId: "i", kind: "HYPOTHESIS", title: "h", content: "c", source: "s", relatedIds: [], createdAt: "2026-10-05T12:00:00Z" }],
    findings: [],
    events: [],
  });
  const byDate = Object.fromEntries((o?.series ?? []).map((s) => [s.date, s.progress]));
  assert.equal(byDate["2026-09-30"], null);
  assert.equal(byDate["2026-10-01"], null, "projeto sem investigação ainda: sem progresso");
  assert.equal(byDate["2026-10-03"], 0);
  assert.equal(byDate["2026-10-06"], 50);
});

test("rotas: listagem e edição exigem sessão; edição exige Origin", async () => {
  const origin = "http://127.0.0.1:47710";
  const app = buildResearchApp(db, origin);
  const h = { host: "127.0.0.1:47710" };
  const cookie = String((await app.inject({ method: "GET", url: "/", headers: h })).headers["set-cookie"]).split(";")[0]!;
  assert.equal((await app.inject({ method: "GET", url: "/api/projects-overview", headers: h })).statusCode, 401);
  const list = await app.inject({ method: "GET", url: "/api/projects-overview", headers: { ...h, cookie } });
  assert.equal(list.statusCode, 200);
  const id = (list.json() as { projects: { id: string }[] }).projects[0]!.id;
  assert.equal((await app.inject({ method: "PATCH", url: `/api/projects/${id}`, headers: { ...h, cookie }, payload: { status: "DONE" } })).statusCode, 403);
  const ok = await app.inject({ method: "PATCH", url: `/api/projects/${id}`, headers: { ...h, cookie, origin }, payload: { status: "DONE" } });
  assert.equal(ok.statusCode, 200);
  await app.close();
});
