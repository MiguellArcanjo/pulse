import { useId } from "react";

/** Anel de progresso (0–100). */
export function ProgressRing({ value, size = 64 }: { value: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring" aria-label={`${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1b2438" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#ring-grad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#4f63ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="ring-text">
        {value}
        <tspan className="ring-pct">%</tspan>
      </text>
    </svg>
  );
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Gráfico de área do progresso diário (0–100%). Dias sem valor (projeto ou investigações
 * ainda inexistentes) não são desenhados: a linha começa quando existe dado real.
 */
export function ProgressChart({ series }: { series: { date: string; progress: number | null }[] }) {
  const id = useId();
  const W = 380;
  const H = 150;
  const left = 34;
  const bottom = 20;
  const plotW = W - left - 6;
  const plotH = H - bottom - 8;
  const x = (i: number) => left + (i / (series.length - 1)) * plotW;
  const y = (v: number) => 8 + plotH - (v / 100) * plotH;
  const points = series.map((s, i) => (s.progress === null ? null : ([x(i), y(s.progress), i] as const))).filter((p) => p !== null);
  const line = points.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points.at(-1);
  const area = first && last ? `${line} L${last[0].toFixed(1)},${y(0)} L${first[0].toFixed(1)},${y(0)} Z` : "";
  const label = (date: string, i: number) => (i === series.length - 1 ? "Hoje" : `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`);
  const ticks = [0, 7, 14, 21, series.length - 1];
  return (
    <svg className="progress-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progresso nos últimos 30 dias">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5b6cff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5b6cff" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={left} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#1b2436" strokeDasharray="3 4" />
          <text x={left - 6} y={y(v)} textAnchor="end" dominantBaseline="central" className="axis">
            {v}%
          </text>
        </g>
      ))}
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} className="axis">
          {series[i] ? label(series[i].date, i) : ""}
        </text>
      ))}
      {points.length > 0 && (
        <>
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke="#6d7cff" strokeWidth="2" strokeLinejoin="round" />
          {points
            .filter(([, , i], k) => k === points.length - 1 || i % 4 === 0)
            .map(([px, py, i]) => (
              <circle key={i} cx={px} cy={py} r="3.2" fill="#8b9cff" stroke="#0e1422" strokeWidth="1.5" />
            ))}
        </>
      )}
      {points.length === 0 && (
        <text x={left + plotW / 2} y={8 + plotH / 2} textAnchor="middle" className="axis">
          Sem investigações ainda
        </text>
      )}
    </svg>
  );
}
