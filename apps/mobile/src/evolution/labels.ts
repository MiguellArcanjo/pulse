import type { EvolutionEvent } from "@morph/client";
import type { AppSpec } from "@morph/protocol";
import { accents } from "../design/tokens";

/** Título curto de cada evento (mockup 10: "Treinos foi criado", "App iniciado"). */
export function eventTitle(e: EvolutionEvent, spec: AppSpec | undefined): string {
  const tool = e.target ? (spec?.tools.find((t) => t.id === e.target)?.name ?? e.target) : null;
  switch (e.kind) {
    case "app_started":
      return "App iniciado";
    case "tool_created":
      return tool ? `${tool} foi criado` : "Ferramenta criada";
    case "tool_modified":
      return tool ? `${tool} mudou` : "Ferramenta alterada";
    case "reorganized":
      return tool ? `${tool} reorganizado` : "App reorganizado";
    case "archived":
      return tool ? `${tool} arquivado` : "Algo foi arquivado";
    case "restored":
      return "Mudança desfeita";
  }
}

/** Cor da bolinha da linha do tempo, por tipo de evento. */
export function eventColor(e: EvolutionEvent): string {
  switch (e.kind) {
    case "app_started":
    case "tool_created":
      return accents.green.main;
    case "tool_modified":
      return accents.violet.main;
    case "reorganized":
      return accents.blue.main;
    case "archived":
      return accents.gray.main;
    case "restored":
      return accents.orange.main;
  }
}

/** "Hoje", "3 dias atrás", "1 semana atrás", "1 mês atrás". */
export function relativeTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return `${days} dias atrás`;
  if (days < 30) return Math.floor(days / 7) === 1 ? "1 semana atrás" : `${Math.floor(days / 7)} semanas atrás`;
  if (days < 365) return Math.floor(days / 30) === 1 ? "1 mês atrás" : `${Math.floor(days / 30)} meses atrás`;
  return Math.floor(days / 365) === 1 ? "1 ano atrás" : `${Math.floor(days / 365)} anos atrás`;
}

export const PERIODS = [
  { id: "week", label: "Semana", days: 7 },
  { id: "month", label: "Mês", days: 30 },
  { id: "year", label: "Ano", days: 365 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export function withinPeriod(iso: string, period: PeriodId, now: Date): boolean {
  const days = PERIODS.find((p) => p.id === period)?.days ?? 30;
  return now.getTime() - new Date(iso).getTime() <= days * 86_400_000;
}
