import { toDate, type Resolved } from "./query.ts";

/**
 * Texto final de um valor, em português do Brasil. Feito à mão (sem Intl) para dar o
 * mesmo resultado no Node dos testes e no Hermes do iPhone.
 */

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function formatNumber(value: number, decimals = 2): string {
  const fixed = Math.abs(value).toFixed(decimals).replace(/\.?0+$/, "");
  const [int = "0", frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

/** 12400 → "12,4 mil"; com unidade kg, vira toneladas: "12,4 t". */
function compact(value: number, unit: string | undefined): string {
  if (unit === "kg" && Math.abs(value) >= 1000) return `${formatNumber(value / 1000, 1)} t`;
  const suffix = unit ? ` ${unit}` : "";
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)} mi${suffix}`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(value / 1000, 1)} mil${suffix}`;
  return `${formatNumber(value, 1)}${suffix}`;
}

/** Minutos → "45 min", "1h", "1h 20min". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}min`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDate(value: string, now: Date, withYear = false): string {
  const d = toDate(value);
  if (!d) return value;
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withYear || d.getFullYear() !== now.getFullYear() ? `${base} ${d.getFullYear()}` : base;
}

/** "Hoje", "Ontem", "3 dias atrás", "2 semanas atrás"; mais antigo vira data. */
export function formatRelativeDate(value: string, now: Date): string {
  const d = toDate(value);
  if (!d) return value;
  if (sameDay(d, now)) return "Hoje";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 1) return "Ontem";
  if (days === -1) return "Amanhã";
  if (days > 1 && days < 7) return `${days} dias atrás`;
  if (days >= 7 && days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? "1 semana atrás" : `${w} semanas atrás`;
  }
  return formatDate(value, now);
}

export function formatResolved(r: Resolved, now: Date): string {
  switch (r.kind) {
    case "empty":
      return "—";
    case "text":
      return r.text;
    case "boolean":
      return r.value ? "Sim" : "Não";
    case "percent": {
      const pct = Math.round(r.value * 100);
      return `${pct > 0 ? "+" : ""}${formatNumber(pct, 0)}%`;
    }
    case "date":
      return r.format === "relative_date" ? formatRelativeDate(r.value, now) : formatDate(r.value, now);
    case "number": {
      if (r.format === "duration") return formatDuration(r.value);
      if (r.format === "percent") return `${formatNumber(r.value * 100, 0)}%`;
      if (r.format === "compact") return compact(r.value, r.unit);
      return `${formatNumber(r.value)}${r.unit ? ` ${r.unit}` : ""}`;
    }
    case "join":
      return r.parts
        .map((p) => formatResolved(p, now))
        .filter((t) => t !== "—")
        .join(r.separator);
  }
}
