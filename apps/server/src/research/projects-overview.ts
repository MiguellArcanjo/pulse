import type { DashboardEvent, Entry, Finding, Investigation, Project } from "./schema.ts";

/**
 * Listagem de projetos: números e progresso calculados dos registros reais.
 *
 * Progresso = média das etapas das investigações do projeto (0 sem registros, 1 observação,
 * 2 hipótese, 3 evidência, 4 finding), em %. Sem investigações, o progresso é 0.
 * A série de 30 dias recalcula essa média como estava no fim de cada dia.
 */

const DAY = 86_400_000;
const SERIES_DAYS = 30;
const ms = (iso: string) => Date.parse(iso);

type Input = { projects: Project[]; investigations: Investigation[]; entries: Entry[]; findings: Finding[]; events: DashboardEvent[]; now: Date };

/** Etapa de uma investigação considerando só o que existia até `at`. */
function stageAt(inv: Investigation, entries: Entry[], findings: Finding[], at: number): number {
  const before = (iso: string) => ms(iso) <= at;
  if (findings.some((f) => f.investigationId === inv.id && before(f.createdAt))) return 4;
  const own = entries.filter((e) => e.investigationId === inv.id && before(e.createdAt));
  if (own.some((e) => e.kind === "EVIDENCE")) return 3;
  if (own.some((e) => e.kind === "HYPOTHESIS")) return 2;
  if (own.some((e) => e.kind === "OBSERVATION")) return 1;
  return 0;
}

function progressAt(invs: Investigation[], entries: Entry[], findings: Finding[], at: number): number | null {
  const existing = invs.filter((i) => ms(i.createdAt) <= at);
  if (existing.length === 0) return null;
  const sum = existing.reduce((acc, i) => acc + stageAt(i, entries, findings, at), 0);
  return Math.round((sum / (existing.length * 4)) * 100);
}

export function buildProjectsOverview({ projects, investigations, entries, findings, events, now }: Input) {
  const t = now.getTime();
  return projects.map((p) => {
    const invs = investigations.filter((i) => i.projectId === p.id);
    const ids = new Set(invs.map((i) => i.id));
    const own = entries.filter((e) => ids.has(e.investigationId));
    const ownFindings = findings.filter((f) => ids.has(f.investigationId));
    const projectEvents = events.filter((e) => e.projectId === p.id);
    const updatedAt = projectEvents.reduce((max, e) => (ms(e.createdAt) > ms(max) ? e.createdAt : max), p.updatedAt ?? p.createdAt);
    const series = Array.from({ length: SERIES_DAYS }, (_, k) => {
      const at = t - (SERIES_DAYS - 1 - k) * DAY;
      return { date: new Date(at).toISOString().slice(0, 10), progress: ms(p.createdAt) <= at ? progressAt(invs, own, ownFindings, at) : null };
    });
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      environment: p.environment,
      status: p.status,
      description: p.description ?? null,
      tags: p.tags ?? [],
      links: p.links ?? {},
      target: p.target ?? null,
      criticality: p.criticality ?? null,
      hosts: p.allowedHosts,
      assets: p.allowedHosts.length,
      investigations: invs.length,
      hypotheses: own.filter((e) => e.kind === "HYPOTHESIS").length,
      findings: ownFindings.length,
      progress: progressAt(invs, own, ownFindings, t) ?? 0,
      authorizationExpired: !!p.authorizationExpiresAt && ms(p.authorizationExpiresAt) <= t,
      createdAt: p.createdAt,
      updatedAt,
      series,
    };
  });
}

export type ProjectOverview = ReturnType<typeof buildProjectsOverview>[number];
