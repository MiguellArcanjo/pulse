import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { pgliteDb } from "../db/pglite.ts";
import { buildProjectHome } from "./project-home.ts";
import { confirmFinding, createEntry, createInvestigation, createProject, projectHome } from "./store.ts";

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

test("visão geral vazia: sem continue, sem atenção, contagens zeradas", async () => {
  const p = await createProject(db, project);
  const home = await projectHome(db, p.id);
  assert.equal(home.continue, null);
  assert.deepEqual(home.attention, []);
  assert.equal(home.attentionTotal, 0);
  assert.equal(home.progress, 0);
  assert.equal(home.counts.assets, 2);
  assert.equal(home.counts.investigations, 0);
  // Mesmo sem investigações, a criação do projeto já é um evento.
  assert.ok(home.recent.some((e) => e.kind === "project.created"));
});

test("visão geral: continue, contagens, atenção e atividade vêm dos registros", async () => {
  const p = await createProject(db, project);
  const i = await createInvestigation(db, p.id, inv);
  const o = await createEntry(db, p.id, i.id, { kind: "OBSERVATION", title: "Resposta diferente", content: "c", source: "s" });
  const h1 = await createEntry(db, p.id, i.id, { kind: "HYPOTHESIS", title: "Possível IDOR", content: "c", source: "s", relatedIds: [o.id], confidence: 72 });
  await createEntry(db, p.id, i.id, { kind: "HYPOTHESIS", title: "Enumeração", content: "c", source: "s", confidence: 31 });
  const e = await createEntry(db, p.id, i.id, { kind: "EVIDENCE", title: "Comparação", content: "c", source: "s", relatedIds: [h1.id] });

  let home = await projectHome(db, p.id);
  assert.equal(home.continue?.investigationId, i.id);
  assert.equal(home.continue?.stage, 3);
  assert.equal(home.continue?.stageLabel, "Evidência");
  assert.equal(home.continue?.observations, 1);
  assert.equal(home.continue?.hypotheses, 2);
  assert.equal(home.continue?.evidence, 1);
  assert.equal(home.counts.hypotheses, 2);
  assert.equal(home.counts.openHypotheses, 2);
  // Progresso = etapa 3 de 4 = 75%.
  assert.equal(home.progress, 75);
  // Só hipóteses abertas na atenção, ordenadas por confiança informada.
  assert.deepEqual(home.attention.map((a) => [a.kind, a.title, a.confidence]), [
    ["hypothesis", "Possível IDOR", 72],
    ["hypothesis", "Enumeração", 31],
  ]);

  await confirmFinding(db, p.id, i.id, { hypothesisId: h1.id, evidenceIds: [e.id], title: "IDOR confirmado", severity: "HIGH", impact: "i", reproduction: "r", rationale: "j", confirmed: true });
  home = await projectHome(db, p.id);
  // Finding entra primeiro na atenção; a hipótese confirmada sai das abertas.
  assert.equal(home.attention[0]?.kind, "finding");
  assert.equal(home.attention[0]?.severity, "HIGH");
  assert.ok(!home.attention.some((a) => a.kind === "hypothesis" && a.title === "Possível IDOR"));
  assert.equal(home.counts.findings, 1);
  assert.equal(home.counts.highFindings, 1);
  assert.equal(home.progress, 100);
  assert.ok(home.recent.some((x) => x.kind === "finding.confirmed"));
});

test("continue prefere investigação em andamento; se todas concluídas, a mais recente", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const p = { ...project, id: "p1", createdAt: "2026-10-01T00:00:00Z", scopeVersion: 1, status: "ACTIVE" } as never;
  const investigations = [
    { ...inv, id: "i-old", projectId: "p1", title: "Concluída", createdAt: "2026-10-02T00:00:00Z" },
    { ...inv, id: "i-new", projectId: "p1", title: "Em andamento", createdAt: "2026-10-03T00:00:00Z" },
  ] as never[];
  const entries = [{ id: "e1", investigationId: "i-new", kind: "OBSERVATION", title: "o", content: "c", source: "s", relatedIds: [], createdAt: "2026-10-06T00:00:00Z" }] as never[];
  const findings = [{ id: "f1", investigationId: "i-old", hypothesisId: "h", evidenceIds: ["e"], title: "ok", severity: "LOW", impact: "i", reproduction: "r", rationale: "j", confirmed: true, createdAt: "2026-10-05T00:00:00Z" }] as never[];
  const events = [
    { id: 2, investigationId: "i-new", kind: "observation.created", summary: "", actor: "local:user", createdAt: "2026-10-06T00:00:00Z" },
    { id: 1, investigationId: "i-old", kind: "finding.confirmed", summary: "", actor: "local:user", createdAt: "2026-10-05T00:00:00Z" },
  ];
  const home = buildProjectHome({ project: p, investigations, entries, findings, events, now });
  // i-old é mais recente por criação, mas está concluída: continue aponta para a em andamento.
  assert.equal(home.continue?.investigationId, "i-new");
  assert.equal(home.continue?.stage, 1);
});
