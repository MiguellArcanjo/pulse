import * as z from "zod";

const text = z.string().trim().min(1).max(4000);
const title = z.string().trim().min(1).max(160);
// V1: hosts exatos. Wildcards e URLs não são interpretados como autorização.
export const Host = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
// Links externos do projeto: só http(s). Abrem no navegador do sistema, nunca dentro do app.
const Url = z.url({ protocol: /^https?$/ }).max(300);
export const ProjectStatus = z.enum(["ACTIVE", "ANALYSIS", "PAUSED", "DONE"]);
/** Tipo de alvo e criticidade: organização do pesquisador, não mudam o escopo. */
export const ProjectTarget = z.enum(["WEB", "API", "MOBILE", "INFRA", "OTHER"]);
export const ProjectCriticality = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
/** Informações descritivas, editáveis a qualquer momento (não mudam escopo nem autorização). */
const details = {
  description: z.string().trim().min(1).max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  links: z.object({ site: Url.optional(), repository: Url.optional(), docs: Url.optional() }).strict().optional(),
  target: ProjectTarget.optional(),
  criticality: ProjectCriticality.optional(),
};
export const ProjectInput = z.object({
  ...details,
  status: ProjectStatus.optional(),
  name: title,
  type: z.enum(["OWN_PROJECT", "AUTHORIZED_PROJECT", "BUG_BOUNTY", "LAB", "CTF"]),
  authorizationSource: text,
  authorizationExpiresAt: z.iso.datetime().nullable(),
  environment: z.enum(["PRODUCTION", "STAGING", "LOCAL"]),
  allowedHosts: z.array(Host).min(1).max(100),
  deniedHosts: z.array(Host).max(100),
  restrictions: text,
}).strict().refine(v => !v.allowedHosts.some(h => v.deniedHosts.includes(h)), "Um host não pode estar nas duas listas.");
/** Edição de status e informações. Escopo e autorização têm fluxo próprio (versionado). */
export const ProjectDetailsUpdate = z.object({
  status: ProjectStatus.optional(),
  description: z.string().trim().max(500).optional(),
  tags: details.tags,
  links: details.links,
  target: details.target,
  criticality: details.criticality,
}).strict().refine(v => Object.keys(v).length > 0, "Nada para atualizar.");
export const InvestigationInput = z.object({ title, assetHost: Host, objective: text }).strict();
export const EntryInput = z.object({
  kind: z.enum(["OBSERVATION", "HYPOTHESIS", "EVIDENCE"]),
  title,
  content: text,
  source: text,
  relatedIds: z.array(z.uuid()).max(30).default([]),
  /** Confiança informada pelo pesquisador (0–100). Só para hipóteses; nunca calculada pela IA sem revisão. */
  confidence: z.number().int().min(0).max(100).optional(),
}).strict().refine(v => v.confidence === undefined || v.kind === "HYPOTHESIS", "Confiança só se aplica a hipóteses.");
export const FindingInput = z.object({
  hypothesisId: z.uuid(),
  evidenceIds: z.array(z.uuid()).min(1).max(30),
  title,
  severity: z.enum(["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  impact: text,
  reproduction: text,
  rationale: text,
  confirmed: z.literal(true),
}).strict();
export const SettingsInput = z.object({ displayName: z.string().trim().min(1).max(60) }).strict();
export type SettingsInput = z.infer<typeof SettingsInput>;
export type ProjectInput = z.infer<typeof ProjectInput>;
export type InvestigationInput = z.infer<typeof InvestigationInput>;
export type EntryInput = z.infer<typeof EntryInput>;
export type FindingInput = z.infer<typeof FindingInput>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Project = ProjectInput & { id: string; createdAt: string; scopeVersion: number; status: ProjectStatus; updatedAt?: string };
export type Investigation = InvestigationInput & { id: string; projectId: string; createdAt: string };
export type Entry = EntryInput & { id: string; investigationId: string; createdAt: string };
export type Finding = FindingInput & { id: string; investigationId: string; createdAt: string };
export type TimelineEvent = { id: number; investigationId: string | null; kind: string; summary: string; createdAt: string; actor: string };
export type DashboardEvent = TimelineEvent & { projectId: string };
