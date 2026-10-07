/** Rótulos e formatação em português, usados em todas as páginas. */

export const PROJECT_TYPE: Record<string, string> = {
  OWN_PROJECT: "Projeto próprio",
  AUTHORIZED_PROJECT: "Autorizado",
  BUG_BOUNTY: "Bug Bounty",
  LAB: "Laboratório",
  CTF: "CTF",
};

export const ENVIRONMENT: Record<string, string> = { PRODUCTION: "Produção", STAGING: "Staging", LOCAL: "Local" };

export const SEVERITY: Record<string, string> = { CRITICAL: "Crítica", HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa", INFORMATIONAL: "Info" };

/** "agora", "há 12 min", "há 3 h", "há 2 dias", "12 out". */
export function relativeTime(iso: string, now = new Date()): string {
  const diff = Math.max(0, now.getTime() - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "há 1 dia" : `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

/** "Segunda-feira, 6 de outubro". */
export function longDate(now = new Date()): string {
  const s = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
