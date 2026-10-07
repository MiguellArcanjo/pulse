import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { pgliteDb } from "../db/pglite.ts";
import { buildResearchApp } from "./app.ts";
import { buildDashboard } from "./dashboard.ts";
import { confirmFinding, createEntry, createInvestigation, createProject, dashboard, saveSettings, search, settings } from "./store.ts";

let db: Db;
before(async () => {
  db = await pgliteDb("memory://");
  await migrate(db, fileURLToPath(new URL("../../research-migrations/", import.meta.url)));
});
after(async () => {
  await db.close();
});

const project = {
  name: "Apart",
  type: "OWN_PROJECT",
  authorizationSource: "Projeto próprio.",
  authorizationExpiresAt: null,
  environment: "STAGING",
  allowedHosts: ["api.apart.test", "app.apart.test"],
  deniedHosts: [],
  restrictions: "Somente revisão manual.",
};
const inv = { title: "Controle de acesso em membros", assetHost: "api.apart.test", objective: "Comparar respostas entre papéis." };

test("confiança só vale para hipóteses e fica entre 0 e 100", async () => {
  const p = await createProject(db, project);
  const i = await createInvestigation(db, p.id, inv);
  const base = { title: "x", content: "y", source: "manual" };
  await assert.rejects(createEntry(db, p.id, i.id, { ...base, kind: "OBSERVATION", confidence: 50 }));
  await assert.rejects(createEntry(db, p.id, i.id, { ...base, kind: "HYPOTHESIS", confidence: 101 }));
  const h = await createEntry(db, p.id, i.id, { ...base, kind: "HYPOTHESIS", confidence: 72 });
  assert.equal(h.confidence, 72);
});

test("painel: etapas, prioridades, atenção e contagens vêm só dos registros", async () => {
  const fresh = await pgliteDb("memory://");
  await migrate(fresh, fileURLToPath(new URL("../../research-migrations/", import.meta.url)));
  try {
    const empty = await dashboard(fresh);
    assert.equal(empty.totals.projects, 0);
    assert.deepEqual(empty.priorities, []);
    assert.equal(empty.sinceLastVisit, null, "primeira visita não tem 'desde a última'");

    const p = await createProject(fresh, project);
    const i = await createInvestigation(fresh, p.id, inv);
    const o = await createEntry(fresh, p.id, i.id, { kind: "OBSERVATION", title: "Resposta diferente", content: "c", source: "s" });
    const h1 = await createEntry(fresh, p.id, i.id, { kind: "HYPOTHESIS", title: "Possível IDOR", content: "c", source: "s", relatedIds: [o.id], confidence: 72 });
    const h2 = await createEntry(fresh, p.id, i.id, { kind: "HYPOTHESIS", title: "Enumeração", content: "c", source: "s", confidence: 31 });
    await createEntry(fresh, p.id, i.id, { kind: "HYPOTHESIS", title: "Sem confiança", content: "c", source: "s" });
    const e = await createEntry(fresh, p.id, i.id, { kind: "EVIDENCE", title: "Comparação", content: "c", source: "s", relatedIds: [h1.id] });

    let d = await dashboard(fresh);
    assert.equal(d.totals.projects, 1);
    assert.equal(d.totals.hypotheses, 3);
    assert.equal(d.investigations[0]?.stage, 3);
    assert.equal(d.investigations[0]?.stageLabel, "Evidência");
    assert.equal(d.attention.hypothesesWithEvidence, 1);
    assert.deepEqual(
      d.priorities.map((x) => [x.title, x.confidence]),
      [["Possível IDOR", 72], ["Enumeração", 31], ["Sem confiança", null]],
    );
    assert.equal(d.projects[0]?.hostsInScope, 2);
    assert.equal(d.series.hypotheses.at(-1), 3);
    assert.equal(d.series.hypotheses.length, 14);

    assert.ok(d.recent.some((x) => x.kind === "evidence.created"));
    await confirmFinding(fresh, p.id, i.id, {
      hypothesisId: h1.id,
      evidenceIds: [e.id],
      title: "IDOR confirmado",
      severity: "HIGH",
      impact: "i",
      reproduction: "r",
      rationale: "j",
      confirmed: true,
    });
    d = await dashboard(fresh);
    // Finding vem primeiro e a hipótese confirmada sai da fila de hipóteses abertas.
    assert.deepEqual(d.priorities.map((x) => [x.kind, x.title]), [["finding", "IDOR confirmado"], ["hypothesis", "Enumeração"], ["hypothesis", "Sem confiança"]]);
    assert.equal(d.totals.highFindings, 1);
    assert.equal(d.investigations[0]?.stage, 4);
    assert.equal(d.attention.hypothesesWithEvidence, 0);
    assert.ok(d.sinceLastVisit, "segunda visita mostra o que mudou");
    assert.equal(d.sinceLastVisit.findings, 1);
    void h2;
  } finally {
    await fresh.close();
  }
});

test("investigação parada, autorização vencendo e projeto expirado", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const old = "2026-09-20T12:00:00Z";
  const d = buildDashboard({
    now,
    lastVisitAt: null,
    projects: [
      { ...project, id: "p1", type: "BUG_BOUNTY", environment: "PRODUCTION", createdAt: old, scopeVersion: 1, authorizationExpiresAt: "2026-10-10T00:00:00Z" } as never,
      { ...project, id: "p2", type: "LAB", environment: "LOCAL", createdAt: old, scopeVersion: 1, authorizationExpiresAt: "2026-10-01T00:00:00Z" } as never,
    ],
    investigations: [{ ...inv, id: "i1", projectId: "p1", createdAt: old }],
    entries: [],
    findings: [],
    events: [{ id: 1, projectId: "p1", investigationId: "i1", kind: "investigation.created", summary: "", actor: "local:user", createdAt: old }],
  });
  assert.equal(d.attention.idleInvestigations, 1);
  assert.equal(d.attention.expiringAuthorizations, 2);
  assert.equal(d.projects.find((p) => p.id === "p2")?.status, "expired");
  assert.equal(d.projects.find((p) => p.id === "p1")?.status, "idle");
});

test("nome exibido: salvar, ler e validar", async () => {
  await assert.rejects(saveSettings(db, { displayName: "" }));
  await saveSettings(db, { displayName: "Miguel" });
  assert.deepEqual(await settings(db), { displayName: "Miguel" });
});

test("rotas do painel e de preferências exigem a sessão local", async () => {
  const origin = "http://127.0.0.1:47710";
  const app = buildResearchApp(db, origin);
  const home = await app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:47710" } });
  const cookie = String(home.headers["set-cookie"]).split(";")[0]!;
  assert.equal((await app.inject({ method: "GET", url: "/api/dashboard", headers: { host: "127.0.0.1:47710" } })).statusCode, 401);
  const ok = await app.inject({ method: "GET", url: "/api/dashboard", headers: { host: "127.0.0.1:47710", cookie } });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { displayName: string }).displayName, "Miguel");
  const put = await app.inject({ method: "PUT", url: "/api/settings", headers: { host: "127.0.0.1:47710", cookie, origin }, payload: { displayName: "Mi" } });
  assert.equal(put.statusCode, 200);
  const noOrigin = await app.inject({ method: "PUT", url: "/api/settings", headers: { host: "127.0.0.1:47710", cookie }, payload: { displayName: "X" } });
  assert.equal(noOrigin.statusCode, 403);
  await app.close();
});

test("busca global encontra projeto, investigação e registros; curingas são literais", async () => {
  const r = await search(db, "apart");
  assert.ok(r.some((x) => x.kind === "project" && x.title === "Apart"));
  assert.ok(r.some((x) => x.kind === "investigation"));
  assert.deepEqual(await search(db, "%"), []);
  assert.deepEqual(await search(db, "a"), [], "termos muito curtos não buscam");
});
