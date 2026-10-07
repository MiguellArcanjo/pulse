import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/db.ts";
import { buildDashboard } from "./dashboard.ts";
import { buildProjectHome } from "./project-home.ts";
import { buildProjectsOverview } from "./projects-overview.ts";
import { ProjectDetailsUpdate, ProjectInput, InvestigationInput, EntryInput, FindingInput, SettingsInput, type DashboardEvent, type Project, type Investigation, type Entry, type Finding, type TimelineEvent } from "./schema.ts";

export class ResearchError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) { super(message); this.status = status; }
}
type DataRow<T> = { data: T };
async function event(tx: Queryable, projectId: string, investigationId: string | null, kind: string, summary: string) {
  await tx.query("INSERT INTO research_events (project_id, investigation_id, kind, summary, actor) VALUES ($1,$2,$3,$4,'local:user')", [projectId, investigationId, kind, summary]);
}
/** Projetos criados antes do campo de status/informações recebem os valores padrão. */
function normalize(p: Project): Project {
  return { ...p, status: p.status ?? "ACTIVE", tags: p.tags ?? [], links: p.links ?? {} };
}
export async function projects(db: Queryable): Promise<Project[]> {
  return (await db.query<DataRow<Project>>("SELECT data FROM research_projects ORDER BY created_at DESC, id")).map(r => normalize(r.data));
}
export async function project(db: Queryable, id: string): Promise<Project> {
  const row = (await db.query<DataRow<Project>>("SELECT data FROM research_projects WHERE id=$1", [id]))[0];
  if (!row) throw new ResearchError("Projeto não encontrado.", 404);
  return normalize(row.data);
}
const STATUS_LABEL = { ACTIVE: "Ativo", ANALYSIS: "Em análise", PAUSED: "Pausado", DONE: "Concluído" } as const;
/** Atualiza status e informações descritivas. Escopo e autorização não passam por aqui. */
export async function updateProjectDetails(db: Db, id: string, input: unknown) {
  const parsed = ProjectDetailsUpdate.parse(input);
  return db.transaction(async tx => {
    const current = (await tx.query<DataRow<Project>>("SELECT data FROM research_projects WHERE id=$1 FOR UPDATE", [id]))[0];
    if (!current) throw new ResearchError("Projeto não encontrado.", 404);
    const before = normalize(current.data);
    const next: Project = { ...before, updatedAt: new Date().toISOString() };
    if (parsed.status) next.status = parsed.status;
    if (parsed.description !== undefined) {
      if (parsed.description) next.description = parsed.description;
      else delete next.description;
    }
    if (parsed.tags) next.tags = [...new Set(parsed.tags)];
    if (parsed.links) next.links = parsed.links;
    if (parsed.target) next.target = parsed.target;
    if (parsed.criticality) next.criticality = parsed.criticality;
    await tx.query("UPDATE research_projects SET data=$2 WHERE id=$1", [id, JSON.stringify(next)]);
    const summary = parsed.status && parsed.status !== before.status ? `Status alterado: ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[parsed.status]}.` : "Informações do projeto atualizadas.";
    await event(tx, id, null, "project.updated", summary);
    return next;
  });
}
export async function createProject(db: Db, input: unknown) {
  const parsed = ProjectInput.parse(input);
  if (parsed.authorizationExpiresAt && Date.parse(parsed.authorizationExpiresAt) <= Date.now()) throw new ResearchError("A autorização já expirou.");
  const data: Project = { ...parsed, tags: [...new Set(parsed.tags ?? [])], links: parsed.links ?? {}, allowedHosts: [...new Set(parsed.allowedHosts)], deniedHosts: [...new Set(parsed.deniedHosts)], id: randomUUID(), createdAt: new Date().toISOString(), scopeVersion: 1, status: parsed.status ?? "ACTIVE" };
  return db.transaction(async tx => {
    await tx.query("INSERT INTO research_projects(id,data) VALUES($1,$2)", [data.id, JSON.stringify(data)]);
    await event(tx, data.id, null, "project.created", "Projeto e escopo registrados (versão 1).");
    return data;
  });
}
export async function createInvestigation(db: Db, projectId: string, input: unknown) {
  const parsed = InvestigationInput.parse(input);
  return db.transaction(async tx => {
    const p = await project(tx, projectId);
    if (p.deniedHosts.includes(parsed.assetHost) || !p.allowedHosts.includes(parsed.assetHost)) throw new ResearchError("O host precisa estar explicitamente no escopo permitido.");
    if (p.authorizationExpiresAt && Date.parse(p.authorizationExpiresAt) <= Date.now()) throw new ResearchError("A autorização expirou. Nenhuma investigação nova foi criada.");
    const data: Investigation = { ...parsed, id: randomUUID(), projectId, createdAt: new Date().toISOString() };
    await tx.query("INSERT INTO research_investigations(id,project_id,data) VALUES($1,$2,$3)", [data.id, projectId, JSON.stringify(data)]);
    await event(tx, projectId, data.id, "investigation.created", "Investigação criada.");
    return data;
  });
}
async function investigation(tx: Queryable, projectId: string, id: string) {
  const row = (await tx.query<DataRow<Investigation>>("SELECT data FROM research_investigations WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, projectId]))[0];
  if (!row) throw new ResearchError("Investigação não encontrada neste projeto.", 404);
  return row.data;
}
export async function createEntry(db: Db, projectId: string, investigationId: string, input: unknown) {
  const parsed = EntryInput.parse(input);
  return db.transaction(async tx => {
    await investigation(tx, projectId, investigationId);
    for (const id of parsed.relatedIds) {
      const match = await tx.query("SELECT id FROM research_entries WHERE id=$1 AND investigation_id=$2", [id, investigationId]);
      if (!match.length) throw new ResearchError("A referência não pertence a esta investigação.");
    }
    const data: Entry = { ...parsed, id: randomUUID(), investigationId, createdAt: new Date().toISOString() };
    await tx.query("INSERT INTO research_entries(id,investigation_id,kind,data) VALUES($1,$2,$3,$4)", [data.id, investigationId, data.kind, JSON.stringify(data)]);
    await event(tx, projectId, investigationId, `${data.kind.toLowerCase()}.created`, `${{ OBSERVATION: "Observação", HYPOTHESIS: "Hipótese", EVIDENCE: "Evidência" }[data.kind]} registrada.`);
    return data;
  });
}
export async function confirmFinding(db: Db, projectId: string, investigationId: string, input: unknown) {
  const parsed = FindingInput.parse(input);
  return db.transaction(async tx => {
    await investigation(tx, projectId, investigationId);
    const entries = (await tx.query<DataRow<Entry>>("SELECT data FROM research_entries WHERE investigation_id=$1", [investigationId])).map(r => r.data);
    if (!entries.some(e => e.id === parsed.hypothesisId && e.kind === "HYPOTHESIS")) throw new ResearchError("Selecione uma hipótese desta investigação.");
    if (!parsed.evidenceIds.every(id => entries.some(e => e.id === id && e.kind === "EVIDENCE"))) throw new ResearchError("Todas as evidências devem pertencer a esta investigação.");
    if ((await tx.query("SELECT id FROM research_findings WHERE hypothesis_id=$1", [parsed.hypothesisId])).length) throw new ResearchError("Esta hipótese já possui um finding.", 409);
    const data: Finding = { ...parsed, evidenceIds: [...new Set(parsed.evidenceIds)], id: randomUUID(), investigationId, createdAt: new Date().toISOString() };
    await tx.query("INSERT INTO research_findings(id,investigation_id,hypothesis_id,data) VALUES($1,$2,$3,$4)", [data.id, investigationId, data.hypothesisId, JSON.stringify(data)]);
    await event(tx, projectId, investigationId, "finding.confirmed", "Finding confirmado pelo usuário com evidências e justificativa.");
    return data;
  });
}
export async function snapshot(db: Db, projectId: string) {
  return db.transaction(async tx => {
    const p = await project(tx, projectId);
    const investigations = (await tx.query<DataRow<Investigation>>("SELECT data FROM research_investigations WHERE project_id=$1 ORDER BY created_at DESC, id", [projectId])).map(r => r.data);
    const entries = (await tx.query<DataRow<Entry>>("SELECT e.data FROM research_entries e JOIN research_investigations i ON i.id=e.investigation_id WHERE i.project_id=$1 ORDER BY e.created_at, e.id", [projectId])).map(r => r.data);
    const findings = (await tx.query<DataRow<Finding>>("SELECT f.data FROM research_findings f JOIN research_investigations i ON i.id=f.investigation_id WHERE i.project_id=$1 ORDER BY f.created_at, f.id", [projectId])).map(r => r.data);
    const events = await tx.query<TimelineEvent>('SELECT id::int, investigation_id AS "investigationId", kind, summary, actor, created_at::text AS "createdAt" FROM research_events WHERE project_id=$1 ORDER BY id DESC LIMIT 200', [projectId]);
    return { project: p, investigations, entries, findings, events };
  });
}

/** Visão geral do projeto aberto (mockup): continue, atenção e atividade, tudo dos registros reais. */
export async function projectHome(db: Db, projectId: string, now = new Date()) {
  return db.transaction(async tx => {
    const p = await project(tx, projectId);
    const investigations = (await tx.query<DataRow<Investigation>>("SELECT data FROM research_investigations WHERE project_id=$1 ORDER BY created_at DESC, id", [projectId])).map(r => r.data);
    const entries = (await tx.query<DataRow<Entry>>("SELECT e.data FROM research_entries e JOIN research_investigations i ON i.id=e.investigation_id WHERE i.project_id=$1", [projectId])).map(r => r.data);
    const findings = (await tx.query<DataRow<Finding>>("SELECT f.data FROM research_findings f JOIN research_investigations i ON i.id=f.investigation_id WHERE i.project_id=$1", [projectId])).map(r => r.data);
    const events = await tx.query<TimelineEvent>('SELECT id::int, investigation_id AS "investigationId", kind, summary, actor, created_at::text AS "createdAt" FROM research_events WHERE project_id=$1 ORDER BY id DESC LIMIT 200', [projectId]);
    return buildProjectHome({ project: p, investigations, entries, findings, events, now });
  });
}

/** Preferências locais (nome exibido). */
export async function settings(db: Queryable): Promise<{ displayName: string | null }> {
  const row = (await db.query<{ value: { displayName: string } }>("SELECT value FROM research_settings WHERE key='profile'"))[0];
  return { displayName: row?.value.displayName ?? null };
}
export async function saveSettings(db: Queryable, input: unknown) {
  const parsed = SettingsInput.parse(input);
  await db.query("INSERT INTO research_settings(key,value) VALUES('profile',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [JSON.stringify(parsed)]);
  return parsed;
}

/**
 * Painel inicial. Lê os registros e calcula tudo em dashboard.ts. Também registra a visita,
 * para o resumo "desde sua última visita" da próxima abertura.
 */
export async function dashboard(db: Db, now = new Date()) {
  return db.transaction(async tx => {
    const projectsList = await projects(tx);
    const investigations = (await tx.query<DataRow<Investigation>>("SELECT data FROM research_investigations")).map(r => r.data);
    const entries = (await tx.query<DataRow<Entry>>("SELECT data FROM research_entries")).map(r => r.data);
    const findings = (await tx.query<DataRow<Finding>>("SELECT data FROM research_findings")).map(r => r.data);
    const events = await tx.query<DashboardEvent>(
      `SELECT id::int, project_id AS "projectId", investigation_id AS "investigationId", kind, summary, actor, created_at::text AS "createdAt"
         FROM research_events
        WHERE created_at > now() - interval '30 days' OR id IN (SELECT id FROM research_events ORDER BY id DESC LIMIT 20)`,
    );
    const visit = (await tx.query<{ value: { at: string } }>("SELECT value FROM research_settings WHERE key='last_visit'"))[0];
    await tx.query("INSERT INTO research_settings(key,value) VALUES('last_visit',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [JSON.stringify({ at: now.toISOString() })]);
    const profile = await settings(tx);
    return { displayName: profile.displayName, ...buildDashboard({ projects: projectsList, investigations, entries, findings, events, now, lastVisitAt: visit?.value.at ?? null }) };
  });
}

export type SearchResult = { kind: "project" | "investigation" | "hypothesis" | "observation" | "evidence" | "finding"; id: string; projectId: string; investigationId: string | null; title: string; subtitle: string };

/** Busca global por título/host em projetos, investigações, registros e findings. */
export async function search(db: Queryable, raw: string): Promise<SearchResult[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  // Escapa os curingas do LIKE: o texto do usuário é procurado literalmente.
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = await db.query<SearchResult>(
    `SELECT 'project' AS kind, id::text AS id, id::text AS "projectId", NULL AS "investigationId", data->>'name' AS title, data->'allowedHosts'->>0 AS subtitle
       FROM research_projects WHERE data->>'name' ILIKE $1 OR data->>'allowedHosts' ILIKE $1
     UNION ALL
     SELECT 'investigation', i.id::text, i.project_id::text, i.id::text, i.data->>'title', i.data->>'assetHost'
       FROM research_investigations i WHERE i.data->>'title' ILIKE $1 OR i.data->>'assetHost' ILIKE $1
     UNION ALL
     SELECT lower(e.kind), e.id::text, i.project_id::text, i.id::text, e.data->>'title', i.data->>'assetHost'
       FROM research_entries e JOIN research_investigations i ON i.id = e.investigation_id WHERE e.data->>'title' ILIKE $1
     UNION ALL
     SELECT 'finding', f.id::text, i.project_id::text, i.id::text, f.data->>'title', i.data->>'assetHost'
       FROM research_findings f JOIN research_investigations i ON i.id = f.investigation_id WHERE f.data->>'title' ILIKE $1
     LIMIT 20`,
    [like],
  );
  return rows;
}

/** Página Projetos: todos os projetos com contagens, progresso e série de 30 dias. */
export async function projectsOverview(db: Db, now = new Date()) {
  return db.transaction(async tx => {
    const list = await projects(tx);
    const investigations = (await tx.query<DataRow<Investigation>>("SELECT data FROM research_investigations")).map(r => r.data);
    const entries = (await tx.query<DataRow<Entry>>("SELECT data FROM research_entries")).map(r => r.data);
    const findings = (await tx.query<DataRow<Finding>>("SELECT data FROM research_findings")).map(r => r.data);
    const events = await tx.query<DashboardEvent>(
      `SELECT DISTINCT ON (project_id) id::int, project_id AS "projectId", investigation_id AS "investigationId", kind, summary, actor, created_at::text AS "createdAt"
         FROM research_events ORDER BY project_id, id DESC`,
    );
    return buildProjectsOverview({ projects: list, investigations, entries, findings, events, now });
  });
}
