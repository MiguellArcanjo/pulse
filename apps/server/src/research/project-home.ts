import { STAGES } from "./dashboard.ts";
import type { Entry, Finding, Investigation, Project, TimelineEvent } from "./schema.ts";

/**
 * Visão geral do projeto aberto (mockup): "continue de onde parou", atenção, atividade e contagens.
 * Tudo calculado dos registros reais — nenhum número é estimado, previsto ou gerado por IA.
 * Função pura (recebe "agora"), testável sem banco.
 */

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFORMATIONAL: 0 };
/** Quantas prioridades e eventos recentes mostrar na visão geral. */
const ATTENTION_SHOWN = 4;
const RECENT_SHOWN = 6;

type Input = {
  project: Project;
  investigations: Investigation[];
  entries: Entry[];
  findings: Finding[];
  /** Eventos do projeto, mais recentes primeiro (id desc). */
  events: TimelineEvent[];
  now: Date;
};

function stageOf(inv: Investigation, entries: Entry[], findings: Finding[]): number {
  if (findings.some((f) => f.investigationId === inv.id)) return 4;
  const own = entries.filter((e) => e.investigationId === inv.id);
  if (own.some((e) => e.kind === "EVIDENCE")) return 3;
  if (own.some((e) => e.kind === "HYPOTHESIS")) return 2;
  if (own.some((e) => e.kind === "OBSERVATION")) return 1;
  return 0;
}

export function buildProjectHome({ project, investigations, entries, findings, events, now }: Input) {
  const t = now.getTime();
  const investigationById = new Map(investigations.map((i) => [i.id, i]));
  // Última atividade de uma investigação: evento mais recente dela; sem evento, a criação.
  const lastActivityOf = (id: string) =>
    events.find((e) => e.investigationId === id)?.createdAt ?? investigationById.get(id)?.createdAt ?? project.createdAt;

  const hypotheses = entries.filter((e) => e.kind === "HYPOTHESIS");
  const evidence = entries.filter((e) => e.kind === "EVIDENCE");
  const observations = entries.filter((e) => e.kind === "OBSERVATION");
  const findingByHypothesis = new Set(findings.map((f) => f.hypothesisId));
  const openHypotheses = hypotheses.filter((h) => !findingByHypothesis.has(h.id));

  const progress =
    investigations.length === 0
      ? 0
      : Math.round((investigations.reduce((acc, i) => acc + stageOf(i, entries, findings), 0) / (investigations.length * 4)) * 100);

  // Continue de onde parou: investigação em andamento mais recente; se todas concluídas, a mais recente.
  const byActivity = [...investigations].sort((a, b) => ms(lastActivityOf(b.id)) - ms(lastActivityOf(a.id)));
  const pick = byActivity.find((i) => stageOf(i, entries, findings) < 4) ?? byActivity[0] ?? null;
  const cont =
    pick === null
      ? null
      : (() => {
          const stage = stageOf(pick, entries, findings);
          return {
            investigationId: pick.id,
            title: pick.title,
            assetHost: pick.assetHost,
            objective: pick.objective,
            stage,
            stageLabel: STAGES[stage],
            progress: Math.round((stage / 4) * 100),
            observations: observations.filter((e) => e.investigationId === pick.id).length,
            hypotheses: hypotheses.filter((e) => e.investigationId === pick.id).length,
            evidence: evidence.filter((e) => e.investigationId === pick.id).length,
            findings: findings.filter((f) => f.investigationId === pick.id).length,
            lastActivityAt: lastActivityOf(pick.id),
          };
        })();

  // Atenção: findings por severidade, depois hipóteses abertas por confiança informada.
  const attention = [
    ...[...findings]
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
      .map((f) => ({
        kind: "finding" as const,
        id: f.id,
        investigationId: f.investigationId,
        title: f.title,
        assetHost: investigationById.get(f.investigationId)?.assetHost ?? "",
        severity: f.severity,
        confidence: null as number | null,
        lastActivityAt: lastActivityOf(f.investigationId),
      })),
    ...[...openHypotheses]
      .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
      .map((h) => ({
        kind: "hypothesis" as const,
        id: h.id,
        investigationId: h.investigationId,
        title: h.title,
        assetHost: investigationById.get(h.investigationId)?.assetHost ?? "",
        severity: null as string | null,
        confidence: h.confidence ?? null,
        lastActivityAt: lastActivityOf(h.investigationId),
      })),
  ];

  const updatedAt = events.reduce((max, e) => (ms(e.createdAt) > ms(max) ? e.createdAt : max), project.updatedAt ?? project.createdAt);

  return {
    project: {
      id: project.id,
      name: project.name,
      type: project.type,
      environment: project.environment,
      status: project.status,
      description: project.description ?? null,
      tags: project.tags ?? [],
      links: project.links ?? {},
      target: project.target ?? null,
      criticality: project.criticality ?? null,
      hosts: project.allowedHosts,
      scopeVersion: project.scopeVersion,
      authorizationSource: project.authorizationSource,
      authorizationExpiresAt: project.authorizationExpiresAt,
      authorizationExpired: !!project.authorizationExpiresAt && ms(project.authorizationExpiresAt) <= t,
      createdAt: project.createdAt,
      updatedAt,
    },
    counts: {
      assets: project.allowedHosts.length,
      investigations: investigations.length,
      observations: observations.length,
      hypotheses: hypotheses.length,
      evidence: evidence.length,
      findings: findings.length,
      highFindings: findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= SEVERITY_RANK["HIGH"]!).length,
      openHypotheses: openHypotheses.length,
    },
    progress,
    continue: cont,
    attention: attention.slice(0, ATTENTION_SHOWN),
    attentionTotal: attention.length,
    recent: events.slice(0, RECENT_SHOWN).map((e) => ({ id: e.id, kind: e.kind, summary: e.summary, investigationId: e.investigationId, createdAt: e.createdAt })),
  };
}

export type ProjectHome = ReturnType<typeof buildProjectHome>;
