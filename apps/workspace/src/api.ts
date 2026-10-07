export type Project = { id: string; name: string; type: string; environment: string; authorizationSource: string; authorizationExpiresAt: string | null; allowedHosts: string[]; deniedHosts: string[]; restrictions: string; scopeVersion: number };
export type Investigation = { id: string; title: string; assetHost: string; objective: string };
export type Entry = { id: string; investigationId: string; kind: "OBSERVATION" | "HYPOTHESIS" | "EVIDENCE"; title: string; content: string; source: string; relatedIds: string[]; confidence?: number };
export type Finding = { id: string; investigationId: string; hypothesisId: string; evidenceIds: string[]; title: string; severity: string; impact: string; reproduction: string; rationale: string };
export type Snapshot = { project: Project; investigations: Investigation[]; entries: Entry[]; findings: Finding[]; events: { id: number; investigationId: string | null; summary: string; createdAt: string; actor: string }[] };
/** Painel inicial (apps/server/src/research/dashboard.ts). Tudo vem dos registros reais. */
export type Dashboard = {
  displayName: string | null;
  totals: { projects: number; activeProjects: number; investigations: number; activeInvestigations: number; hypotheses: number; newHypotheses: number; findings: number; highFindings: number };
  series: { projects: number[]; investigations: number[]; hypotheses: number[]; findings: number[] };
  attention: { hypothesesWithEvidence: number; idleInvestigations: number; expiringAuthorizations: number; findingsToReport: number };
  investigations: { id: string; projectId: string; projectName: string; projectType: string; environment: string; title: string; assetHost: string; stage: number; stageLabel: string; lastActivityAt: string }[];
  priorities: { kind: "finding" | "hypothesis"; id: string; investigationId: string; projectId: string; title: string; assetHost: string; severity: string | null; confidence: number | null }[];
  projects: { id: string; name: string; type: string; host: string; hostsInScope: number; investigations: number; findings: number; hypotheses: number; status: "active" | "idle" | "expired"; lastActivityAt: string; activity: number[] }[];
  recent: { id: number; projectId: string; projectName: string; investigationId: string | null; kind: string; summary: string; createdAt: string }[];
  sinceLastVisit: { hypotheses: number; investigationsUpdated: number; findings: number; evidence: number } | null;
};
export type SearchResult = { kind: "project" | "investigation" | "hypothesis" | "observation" | "evidence" | "finding"; id: string; projectId: string; investigationId: string | null; title: string; subtitle: string };

export type ProjectStatus = "ACTIVE" | "ANALYSIS" | "PAUSED" | "DONE";
export type ProjectLinks = { site?: string; repository?: string; docs?: string };
export type ProjectTarget = "WEB" | "API" | "MOBILE" | "INFRA" | "OTHER";
export type ProjectCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
/** Página Projetos (apps/server/src/research/projects-overview.ts). */
export type ProjectOverview = {
  id: string; name: string; type: string; environment: string; status: ProjectStatus;
  description: string | null; tags: string[]; links: ProjectLinks; hosts: string[];
  target: ProjectTarget | null; criticality: ProjectCriticality | null;
  assets: number; investigations: number; hypotheses: number; findings: number; progress: number;
  authorizationExpired: boolean; createdAt: string; updatedAt: string;
  series: { date: string; progress: number | null }[];
};

/** Visão geral do projeto aberto (apps/server/src/research/project-home.ts). Tudo dos registros reais. */
export type ProjectHome = {
  project: {
    id: string; name: string; type: string; environment: string; status: ProjectStatus;
    description: string | null; tags: string[]; links: ProjectLinks; target: ProjectTarget | null;
    criticality: ProjectCriticality | null; hosts: string[]; scopeVersion: number;
    authorizationSource: string; authorizationExpiresAt: string | null; authorizationExpired: boolean;
    createdAt: string; updatedAt: string;
  };
  counts: { assets: number; investigations: number; observations: number; hypotheses: number; evidence: number; findings: number; highFindings: number; openHypotheses: number };
  progress: number;
  continue: null | {
    investigationId: string; title: string; assetHost: string; objective: string;
    stage: number; stageLabel: string; progress: number;
    observations: number; hypotheses: number; evidence: number; findings: number; lastActivityAt: string;
  };
  attention: { kind: "finding" | "hypothesis"; id: string; investigationId: string; title: string; assetHost: string; severity: string | null; confidence: number | null; lastActivityAt: string }[];
  attentionTotal: number;
  recent: { id: number; kind: string; summary: string; investigationId: string | null; createdAt: string }[];
};

export async function api<T>(path: string, body?: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<T> {
  const r = await fetch(`/api${path}`, body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data: unknown = await r.json();
  if (!r.ok) {
    const error = data as { error?: string; issues?: { path: string; message: string }[] };
    throw new Error(error.issues?.map(i => `${i.path}: ${i.message}`).join(" · ") || error.error || "Não foi possível salvar.");
  }
  return data as T;
}
