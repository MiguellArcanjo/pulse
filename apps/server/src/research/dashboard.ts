import type { DashboardEvent, Entry, Finding, Investigation, Project } from "./schema.ts";

/**
 * Painel inicial: tudo calculado a partir dos registros reais. Nenhum número aqui é
 * estimado, previsto ou gerado por IA. Função pura (recebe "agora"), testável sem banco.
 */

export type DashboardInput = {
  projects: Project[];
  investigations: Investigation[];
  entries: Entry[];
  findings: Finding[];
  events: DashboardEvent[];
  now: Date;
  /** Última visita ao painel (para "desde sua última visita"); null na primeira vez. */
  lastVisitAt: string | null;
};

const DAY = 86_400_000;
const SERIES_DAYS = 14;
/** Investigação sem nenhum evento há este tempo é considerada parada. */
const IDLE_DAYS = 7;
/** Autorização que vence dentro deste prazo pede atenção. */
const EXPIRING_DAYS = 14;

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFORMATIONAL: 0 };
export const STAGES = ["Sem registros", "Observação", "Hipótese", "Evidência", "Finding"] as const;

const ms = (iso: string) => Date.parse(iso);

/** Total acumulado por dia, nos últimos 14 dias (o último ponto é hoje). */
function cumulative(dates: string[], now: Date): number[] {
  const end = now.getTime();
  return Array.from({ length: SERIES_DAYS }, (_, i) => {
    const cutoff = end - (SERIES_DAYS - 1 - i) * DAY;
    return dates.filter((d) => ms(d) <= cutoff).length;
  });
}

/** Quantidade de eventos por dia, nos últimos 14 dias. */
function daily(dates: string[], now: Date): number[] {
  const end = now.getTime();
  return Array.from({ length: SERIES_DAYS }, (_, i) => {
    const to = end - (SERIES_DAYS - 1 - i) * DAY;
    const from = to - DAY;
    return dates.filter((d) => ms(d) > from && ms(d) <= to).length;
  });
}

export function buildDashboard(input: DashboardInput) {
  const { projects, investigations, entries, findings, events, now } = input;
  const t = now.getTime();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const investigationById = new Map(investigations.map((i) => [i.id, i]));
  const findingByHypothesis = new Map(findings.map((f) => [f.hypothesisId, f]));
  const lastActivity = (pred: (e: DashboardEvent) => boolean) =>
    events.filter(pred).reduce<string | null>((max, e) => (!max || ms(e.createdAt) > ms(max) ? e.createdAt : max), null);

  const hypotheses = entries.filter((e) => e.kind === "HYPOTHESIS");
  const evidence = entries.filter((e) => e.kind === "EVIDENCE");
  const openHypotheses = hypotheses.filter((h) => !findingByHypothesis.has(h.id));
  // Hipótese com evidência ligada a ela (pela evidência ou pela própria hipótese) e ainda sem decisão.
  const withEvidence = openHypotheses.filter(
    (h) => evidence.some((e) => e.relatedIds.includes(h.id)) || h.relatedIds.some((id) => evidence.some((e) => e.id === id)),
  );

  const investigationRows = investigations.map((i) => {
    const own = entries.filter((e) => e.investigationId === i.id);
    const stage = findings.some((f) => f.investigationId === i.id)
      ? 4
      : own.some((e) => e.kind === "EVIDENCE")
        ? 3
        : own.some((e) => e.kind === "HYPOTHESIS")
          ? 2
          : own.some((e) => e.kind === "OBSERVATION")
            ? 1
            : 0;
    const project = projectById.get(i.projectId);
    return {
      id: i.id,
      projectId: i.projectId,
      projectName: project?.name ?? "",
      projectType: project?.type ?? "",
      environment: project?.environment ?? "",
      title: i.title,
      assetHost: i.assetHost,
      stage,
      stageLabel: STAGES[stage],
      lastActivityAt: lastActivity((e) => e.investigationId === i.id) ?? i.createdAt,
    };
  });
  investigationRows.sort((a, b) => ms(b.lastActivityAt) - ms(a.lastActivityAt));
  const idle = investigationRows.filter((i) => i.stage < 4 && t - ms(i.lastActivityAt) > IDLE_DAYS * DAY);

  const expiring = projects.filter((p) => p.authorizationExpiresAt && ms(p.authorizationExpiresAt) - t <= EXPIRING_DAYS * DAY);

  const priorities = [
    ...[...findings]
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
      .map((f) => ({
        kind: "finding" as const,
        id: f.id,
        investigationId: f.investigationId,
        projectId: investigationById.get(f.investigationId)?.projectId ?? "",
        title: f.title,
        assetHost: investigationById.get(f.investigationId)?.assetHost ?? "",
        severity: f.severity,
        confidence: null as number | null,
      })),
    ...[...openHypotheses]
      .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
      .map((h) => ({
        kind: "hypothesis" as const,
        id: h.id,
        investigationId: h.investigationId,
        projectId: investigationById.get(h.investigationId)?.projectId ?? "",
        title: h.title,
        assetHost: investigationById.get(h.investigationId)?.assetHost ?? "",
        severity: null as string | null,
        confidence: h.confidence ?? null,
      })),
  ].slice(0, 5);

  const projectRows = projects.map((p) => {
    const own = new Set(investigations.filter((i) => i.projectId === p.id).map((i) => i.id));
    const projectEvents = events.filter((e) => e.projectId === p.id);
    const last = lastActivity((e) => e.projectId === p.id) ?? p.createdAt;
    const expired = !!p.authorizationExpiresAt && ms(p.authorizationExpiresAt) <= t;
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      host: p.allowedHosts[0] ?? "",
      hostsInScope: p.allowedHosts.length,
      investigations: own.size,
      findings: findings.filter((f) => own.has(f.investigationId)).length,
      hypotheses: hypotheses.filter((h) => own.has(h.investigationId)).length,
      status: expired ? "expired" : t - ms(last) <= IDLE_DAYS * DAY ? "active" : "idle",
      lastActivityAt: last,
      activity: daily(projectEvents.map((e) => e.createdAt), now),
    };
  });
  projectRows.sort((a, b) => ms(b.lastActivityAt) - ms(a.lastActivityAt));

  const since = input.lastVisitAt ? ms(input.lastVisitAt) : null;
  const sinceEvents = since === null ? [] : events.filter((e) => ms(e.createdAt) > since);

  return {
    totals: {
      projects: projects.length,
      activeProjects: projectRows.filter((p) => p.status === "active").length,
      investigations: investigations.length,
      activeInvestigations: investigationRows.filter((i) => i.stage < 4 && t - ms(i.lastActivityAt) <= IDLE_DAYS * DAY).length,
      hypotheses: hypotheses.length,
      newHypotheses: hypotheses.filter((h) => t - ms(h.createdAt) <= IDLE_DAYS * DAY).length,
      findings: findings.length,
      highFindings: findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= SEVERITY_RANK["HIGH"]!).length,
    },
    series: {
      projects: cumulative(projects.map((p) => p.createdAt), now),
      investigations: cumulative(investigations.map((i) => i.createdAt), now),
      hypotheses: cumulative(hypotheses.map((h) => h.createdAt), now),
      findings: cumulative(findings.map((f) => f.createdAt), now),
    },
    attention: {
      hypothesesWithEvidence: withEvidence.length,
      idleInvestigations: idle.length,
      expiringAuthorizations: expiring.length,
      findingsToReport: findings.length,
    },
    investigations: investigationRows.slice(0, 4),
    priorities,
    projects: projectRows.slice(0, 4),
    recent: [...events]
      .sort((a, b) => b.id - a.id)
      .slice(0, 6)
      .map((e) => ({ ...e, projectName: projectById.get(e.projectId)?.name ?? "" })),
    sinceLastVisit:
      since === null
        ? null
        : {
            hypotheses: sinceEvents.filter((e) => e.kind === "hypothesis.created").length,
            investigationsUpdated: new Set(sinceEvents.map((e) => e.investigationId).filter(Boolean)).size,
            findings: sinceEvents.filter((e) => e.kind === "finding.confirmed").length,
            evidence: sinceEvents.filter((e) => e.kind === "evidence.created").length,
          },
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;
