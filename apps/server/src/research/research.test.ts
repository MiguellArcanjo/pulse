import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pgliteDb } from "../db/pglite.ts";
import { migrate } from "../db/migrate.ts";
import type { Db } from "../db/db.ts";
import { buildResearchApp } from "./app.ts";
import { createProject, createInvestigation, createEntry, confirmFinding, snapshot } from "./store.ts";

let db: Db;
const input = { name: "Programa autorizado", type: "BUG_BOUNTY", authorizationSource: "Autorização do laboratório de testes", authorizationExpiresAt: null, environment: "STAGING", allowedHosts: ["api.example.com"], deniedHosts: ["admin.example.com"], restrictions: "Somente revisão manual. Nenhuma execução ativa." };
before(async () => { db = await pgliteDb("memory://"); await migrate(db, fileURLToPath(new URL("../../research-migrations/", import.meta.url))); });
after(async () => { await db.close(); });
const investigationInput = { title: "Verificar controle de acesso", assetHost: "api.example.com", objective: "Investigar diferenças observadas entre duas contas de laboratório." };

test("fluxo black-box completo sem repositório, persistência e timeline", async () => {
  const p = await createProject(db, input);
  const i = await createInvestigation(db, p.id, investigationInput);
  const o = await createEntry(db, p.id, i.id, { kind: "OBSERVATION", title: "Resposta diferente", content: "Duas contas receberam respostas diferentes.", source: "Anotação manual do laboratório." });
  const h = await createEntry(db, p.id, i.id, { kind: "HYPOTHESIS", title: "Possível diferença de autorização", content: "Ainda não confirmada.", source: "Revisão da observação.", relatedIds: [o.id] });
  const e = await createEntry(db, p.id, i.id, { kind: "EVIDENCE", title: "Comparação revisada", content: "Resultado controlado registrado pelo pesquisador.", source: "Laboratório local.", relatedIds: [h.id] });
  const f = await confirmFinding(db, p.id, i.id, { hypothesisId: h.id, evidenceIds: [e.id], title: "Finding revisado", severity: "LOW", impact: "Impacto demonstrado no laboratório.", reproduction: "Repetir a comparação com as contas de teste.", rationale: "Revisão humana das evidências.", confirmed: true });
  const result = await snapshot(db, p.id);
  assert.equal(result.findings[0]?.id, f.id);
  assert.equal(result.entries.length, 3);
  assert.equal(result.investigations[0]?.assetHost, "api.example.com");
  assert.equal(result.events.length, 6);
  assert.equal(result.events[0]?.kind, "finding.confirmed");
  assert.ok(result.events.every(e => e.actor === "local:user"));
  const { id: _id, investigationId: _investigationId, createdAt: _createdAt, ...duplicate } = f;
  await assert.rejects(confirmFinding(db, p.id, i.id, duplicate), /já possui/);
});

test("cadastro não autoriza host externo, subdomínio implícito ou wildcard", async () => {
  const p = await createProject(db, input);
  for (const host of ["admin.example.com", "sub.api.example.com", "other.example.com"]) await assert.rejects(createInvestigation(db, p.id, { ...investigationInput, assetHost: host }), /escopo/);
  await assert.rejects(createProject(db, { ...input, allowedHosts: ["*.example.com"] }));
  await assert.rejects(createProject(db, { ...input, allowedHosts: ["api.example.com/path"] }));
  await assert.rejects(createProject(db, { ...input, deniedHosts: input.allowedHosts }));
  assert.equal((await snapshot(db, p.id)).investigations.length, 0);
});

test("autorização expirada bloqueia novas investigações", async () => {
  await assert.rejects(createProject(db, { ...input, authorizationExpiresAt: "2000-01-01T00:00:00Z" }), /expirou/);
  const p = await createProject(db, input);
  await db.query("UPDATE research_projects SET data=jsonb_set(data,'{authorizationExpiresAt}', '\"2000-01-01T00:00:00Z\"') WHERE id=$1", [p.id]);
  await assert.rejects(createInvestigation(db, p.id, investigationInput), /expirou/);
});

test("finding exige confirmação, hipótese e evidências da mesma investigação", async () => {
  const p = await createProject(db, input);
  const i = await createInvestigation(db, p.id, investigationInput);
  const other = await createInvestigation(db, p.id, investigationInput);
  const h = await createEntry(db, p.id, i.id, { kind: "HYPOTHESIS", title: "Hipótese", content: "Precisa de verificação.", source: "Manual" });
  const e = await createEntry(db, p.id, other.id, { kind: "EVIDENCE", title: "Outra investigação", content: "Não pode ser usada implicitamente.", source: "Manual" });
  const proposal = { hypothesisId: h.id, evidenceIds: [e.id], title: "Proposta", severity: "LOW", impact: "Impacto", reproduction: "Passos", rationale: "Motivo", confirmed: true };
  await assert.rejects(confirmFinding(db, p.id, i.id, proposal), /evidências/);
  await assert.rejects(confirmFinding(db, p.id, i.id, { ...proposal, confirmed: false }));
  await assert.rejects(confirmFinding(db, p.id, i.id, { ...proposal, evidenceIds: [] }));
  await assert.rejects(confirmFinding(db, p.id, i.id, { ...proposal, hypothesisId: e.id }), /hipótese/);
  const before = await snapshot(db, p.id);
  await assert.rejects(createEntry(db, p.id, i.id, { kind: "OBSERVATION", title: "Inválida", content: "Texto", source: "Manual", relatedIds: [e.id] }), /referência/);
  assert.deepEqual(await snapshot(db, p.id), before);
  assert.equal(before.findings.length, 0);
  const anotherProject = await createProject(db, input);
  await assert.rejects(createEntry(db, anotherProject.id, i.id, { kind: "OBSERVATION", title: "Inválida", content: "Texto", source: "Manual" }), /neste projeto/);
});

test("gravação e auditoria são atômicas mesmo com falha no banco", async () => {
  const p = await createProject(db, input);
  const i = await createInvestigation(db, p.id, investigationInput);
  const before = await snapshot(db, p.id);
  const failing: Db = { ...db, transaction: fn => db.transaction(tx => fn({ query: (sql, params) => { if (sql.startsWith("INSERT INTO research_events")) throw new Error("Falha simulada no teste"); return tx.query(sql, params); } })) };
  await assert.rejects(createEntry(failing, p.id, i.id, { kind: "OBSERVATION", title: "Não persiste", content: "Texto", source: "Manual" }), /simulada/);
  assert.deepEqual(await snapshot(db, p.id), before);
});

test("API local exige sessão e origem; schema inválido não chega ao domínio", async () => {
  const origin = "http://127.0.0.1:47710";
  const app = buildResearchApp(db, origin);
  try {
    const headers = { host: "127.0.0.1:47710" };
    assert.equal((await app.inject({ url: "/api/projects", headers })).statusCode, 401);
    const opened = await app.inject({ url: "/", headers });
    const cookie = String(opened.headers["set-cookie"]).split(";")[0]!;
    assert.match(String(opened.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
    assert.equal((await app.inject({ url: "/api/projects", headers: { ...headers, cookie } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/projects", headers: { ...headers, cookie, origin: "https://external.example" } })).statusCode, 403);
    assert.equal((await app.inject({ url: "/", headers: { host: "external.example" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, cookie }, payload: input })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, cookie, origin }, payload: { name: "Incompleto" } })).statusCode, 400);
    assert.equal((await app.inject({ url: `/api/projects/${randomUUID()}`, headers: { ...headers, cookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, cookie, origin }, payload: input })).statusCode, 201);
  } finally { await app.close(); }
});
