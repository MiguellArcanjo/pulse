import { useId } from "react";

const W = 200;
const H = 40;
const SLOTS = 60;

/**
 * Área + linha das últimas amostras. `max` fixo (ex.: 100 para %) ou
 * automático (maior valor da série) para grandezas sem teto, como rede.
 */
export function Sparkline({ values, max }: { values: number[]; max?: number }) {
  const id = useId();
  if (values.length < 2) return <div className="spark" />;

  const top = max ?? Math.max(...values, 1);
  const step = W / (SLOTS - 1);
  const offset = W - (values.length - 1) * step;
  const pts = values.map((v, i) => {
    const x = offset + i * step;
    const y = H - 2 - (Math.min(v, top) / top) * (H - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${pts[0][0].toFixed(1)},${H} L${line.replace(/ /g, " L")} L${W},${H} Z`;

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--spark)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--spark)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" />
    </svg>
  );
}
