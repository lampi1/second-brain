// A small weekly trend chart for the Classificatori cards and their detail (dataviz rules: one axis, 2px lines, ≥8px
// dots with a surface ring, recessive hairline grid, palette slots in fixed order, a legend from two series up, a
// crosshair tooltip on hover, text in text tokens). Unlike brain/components/Charts.tsx LineChart it leaves a gap for a
// week without data (null), never a zero. compact = the card's sparkline-sized version (no axis labels, no legend).
// Colors are the --bx-cat-* tokens (brain.css), stepped for light and dark. Used by ClassifiersPage and ClassifierDetail.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { catColor } from '../../brain/lib/chart';

export interface TrendSeries { label: string; values: (number | null)[]; slot?: number }
interface Props {
  labels: string[];
  series: TrendSeries[];
  /** the axis top (default 1, a share) */
  max?: number;
  format: (v: number) => string;
  /** an extra tooltip line per point (e.g. "12 decisioni") */
  extra?: (i: number) => string | null;
  height?: number;
  compact?: boolean;
  label: string;
  testId?: string;
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setW(el.clientWidth);
    const ro = new ResizeObserver(() => { if (el.clientWidth) setW(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Runs of consecutive non-null points (a null breaks the line). */
export function runs(values: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => { if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push({ i, v }); });
  if (cur.length) out.push(cur);
  return out;
}

export function TrendChart({ labels, series, max = 1, format, extra, height, compact, label, testId }: Props) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const H = height ?? (compact ? 64 : 200);
  const left = compact ? 6 : 40, right = W - (compact ? 6 : 12), top = compact ? 8 : 12, bottom = compact ? 8 : 24, plotH = H - top - bottom;
  const n = labels.length, dx = n > 1 ? (right - left) / (n - 1) : 0;
  const X = (i: number) => left + i * dx, Y = (v: number) => top + plotH - (Math.min(v, max) / (max || 1)) * plotH;
  const grid = compact ? [0, max] : [0, max / 2, max];
  const any = series.some(s => s.values.some(v => v !== null));
  const tipX = hover !== null ? Math.min(Math.max(X(hover) + 10, 0), Math.max(0, W - 170)) : 0;
  return (
    <div className={`cls-trend ${compact ? 'compact' : ''}`} data-testid={testId}>
      {!compact && series.length > 1 && <div className="bx-legend" aria-hidden="true">{series.map((s, k) => <span key={k}><i style={{ background: catColor(s.slot ?? k) }} />{s.label}</span>)}</div>}
      <div ref={ref} className="cls-trend-plot" style={{ height: H }}>
        <svg width={W} height={H} role="img" aria-labelledby={`${id}t`} onMouseLeave={() => setHover(null)}>
          <title id={`${id}t`}>{label}</title>
          {grid.map((g, k) => <line key={k} className={k ? 'grid' : 'base'} x1={left} x2={right} y1={Math.round(Y(g)) + 0.5} y2={Math.round(Y(g)) + 0.5} />)}
          {!compact && grid.map((g, k) => <text key={`l${k}`} x={left - 6} y={Y(g) + 3.5} textAnchor="end">{format(g)}</text>)}
          {hover !== null && <line className="cross" x1={X(hover)} x2={X(hover)} y1={top} y2={top + plotH} />}
          {series.map((s, k) => {
            const col = catColor(s.slot ?? k);
            return <g key={k}>
              {runs(s.values).map((r, j) => r.length > 1
                ? <polyline key={j} points={r.map(p => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" style={{ stroke: col }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                : null)}
              {s.values.map((v, i) => (v === null ? null : (i === n - 1 || hover === i || runs(s.values).some(r => r.length === 1 && r[0]!.i === i))
                ? <circle key={i} className="dot" cx={X(i)} cy={Y(v)} r={4} style={{ fill: col }} /> : null))}
            </g>;
          })}
          {labels.map((l, i) => <g key={i}>
            <rect className="hit" x={X(i) - Math.max(dx, 14) / 2} y={0} width={Math.max(dx, 14)} height={H} onMouseMove={() => setHover(i)} />
            {!compact && (n <= 10 || i % 2 === 0) && <text x={X(i)} y={H - 6} textAnchor="middle">{l}</text>}
          </g>)}
        </svg>
        {!any && <span className="cls-trend-empty" aria-hidden="true" />}
        {hover !== null && <div className="cls-trend-tip" style={{ left: tipX }} role="presentation">
          <b>{labels[hover]}</b>
          {series.map((s, k) => <span key={k}><i style={{ background: catColor(s.slot ?? k) }} />{s.label}<em>{s.values[hover] === null || s.values[hover] === undefined ? '—' : format(s.values[hover]!)}</em></span>)}
          {extra?.(hover) && <small>{extra(hover)}</small>}
        </div>}
      </div>
    </div>
  );
}
