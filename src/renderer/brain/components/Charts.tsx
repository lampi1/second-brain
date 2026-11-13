// Small SVG charts of the brain pages, drawn here (no chart library): vertical bars (one highlighted, e.g. today),
// horizontal bars (categorical: one palette color per named thing, or grouped series), stacked bars and lines. Each
// chart is a card with a title, an optional explain block, a legend when there is more than one series, a hover
// tooltip, CSV export and a "Dati" toggle that shows the numbers as a table (the accessible alternative; the SVG has
// a <title> and a <desc> with the key fact). Sizes follow the container (ResizeObserver). Used by Costi and
// Miglioramento; a chart given `discuss` ends with the discussion bar (Costi).
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t, locale } from '../../i18n';
import { catColor, labelStep, niceMax, niceScale, ticks, tickLabel } from '../lib/chart';
import { fmt } from '../lib/format';
import { fileSafe, stamp, toCsv } from '../lib/table';
import { Explain, type ExplainProps } from './States';
import { download, IconDownload } from './ui';
import { DiscussBar } from './Discuss';
import type { Quote } from '../lib/discuss';

export interface Series { label: string; values: number[]; color?: string }
/** discuss: the numbers the discussion bar quotes (ADR 0037); no bar without it */
interface Common { title: string; note?: ReactNode; name: string; money?: boolean; explain?: ExplainProps; testId?: string; discuss?: Quote }

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver(() => { if (el.clientWidth) setW(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface TipState { x: number; y: number; title: string; rows: { color: string; label: string; value: string }[] }
function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 290);
  return (
    <div className="bx-tip" style={{ left, top: tip.y + 14 }} role="presentation">
      <b>{tip.title}</b>
      {tip.rows.map((r, i) => <span className="row" key={i}><i style={{ background: r.color }} />{r.label}<span className="v">{r.value}</span></span>)}
    </div>
  );
}

const val = (v: number, money?: boolean) => (money ? fmt.usd(v) : v.toLocaleString(locale(), { maximumFractionDigits: 1 }));

function ChartCard({ title, note, explain, name, labels, series, money, legend, children, testId, discuss }: Common & { labels: string[]; series: Series[]; legend?: boolean; children: ReactNode }) {
  const [table, setTable] = useState(false);
  const csv = () => {
    const cols = [{ key: 'label', label: t('brainLib.charts.csvVoiceHeader') }, ...series.map((s, i) => ({ key: `s${i}`, label: s.label || title }))];
    const rows = labels.map((l, j) => Object.fromEntries([['label', l], ...series.map((s, i) => [`s${i}`, Math.round((s.values[j] ?? 0) * 100) / 100])]));
    download(`${fileSafe(name)}-${stamp()}.csv`, toCsv(cols, rows), 'text/csv');
  };
  return (
    <figure className="bx-chart bx-card" style={{ margin: 0 }} data-testid={testId ?? `bx-chart-${fileSafe(name)}`}>
      <div className="bx-chart-head">
        <div className="t"><h3>{title}</h3>{note && <span className="note">{note}</span>}</div>
        <button type="button" className="bx-btn ghost s" aria-pressed={table} onClick={() => setTable(t => !t)} title={t('brainLib.charts.dataToggleTitle')}>{t('brainLib.charts.dataToggle')}</button>
        <button type="button" className="bx-btn ghost s" onClick={csv} title={t('brainLib.charts.csvDownloadTitle')}><IconDownload /> CSV</button>
      </div>
      {explain && <Explain {...explain} />}
      {legend && series.length > 1 && (
        <div className="bx-legend" aria-hidden="true">{series.map((s, i) => <span key={i}><i style={{ background: s.color ?? catColor(i) }} />{s.label}</span>)}</div>
      )}
      {table ? (
        <div className="bx-scroll" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="bx-datatable">
            <thead><tr><th>{t('brainLib.charts.voiceLabel')}</th>{series.map((s, i) => <th key={i} className="num">{s.label || t('brainLib.charts.valueLabel')}</th>)}</tr></thead>
            <tbody>{labels.map((l, j) => <tr key={j}><td>{l}</td>{series.map((s, i) => <td key={i} className="num">{val(s.values[j] ?? 0, money)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
      {discuss && <DiscussBar topic={{ kind: 'quote', quote: discuss }} testId={`${testId ?? `bx-chart-${fileSafe(name)}`}-discuss`} />}
    </figure>
  );
}

function Axis({ max, money, left, right, top, plotH }: { max: number; money?: boolean; left: number; right: number; top: number; plotH: number }) {
  const t = ticks(max), { top: m, step } = niceScale(max);
  return (
    <g aria-hidden="true">
      {t.map((v, i) => {
        const y = top + plotH - (v / m) * plotH;
        return <g key={i}><line className={i ? 'grid' : 'base'} x1={left} x2={right} y1={Math.round(y) + 0.5} y2={Math.round(y) + 0.5} /><text x={left - 6} y={y + 3.5} textAnchor="end">{tickLabel(v, money, step)}</text></g>;
      })}
    </g>
  );
}
const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

/** Vertical bars, one series; `highlight` marks one bar (e.g. today) in the second palette color. */
export function BarChart({ labels, values, highlight, height = 190, ...c }: Common & { labels: string[]; values: number[]; highlight?: number; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const id = useId();
  const max = Math.max(0, ...values), m = niceMax(max);
  const left = c.money ? 50 : 34, right = W - 6, top = 14, bottom = 24, plotH = height - top - bottom;
  const band = (right - left) / Math.max(1, values.length), bw = Math.max(3, Math.min(40, band * 0.66));
  const step = labelStep(values.length, right - left, 62);
  const maxI = values.indexOf(max);
  const desc = values.length ? `${t('brainLib.charts.nValuesMax', { n: values.length, max: labels[maxI] ?? '', values: val(max, c.money) })}${highlight != null ? `; ${labels[highlight]}: ${val(values[highlight] ?? 0, c.money)}` : ''}.` : t('brainLib.charts.noData');
  return (
    <ChartCard {...c} labels={labels} series={[{ label: c.title, values }]}>
      <div ref={ref} className="bx-plot">
        <svg width={W} height={height} role="img" aria-labelledby={`${id}t ${id}d`} onMouseLeave={() => setTip(null)}>
          <title id={`${id}t`}>{c.title}</title><desc id={`${id}d`}>{desc}</desc>
          <Axis max={max} money={c.money} left={left} right={right} top={top} plotH={plotH} />
          {values.map((v, i) => {
            const h = (v / m) * plotH, x = left + i * band + (band - bw) / 2, y = top + plotH - h;
            const color = i === highlight ? catColor(1) : catColor(0);
            return (
              <g key={i}>
                <path className="bar" d={topRounded(x, y, bw, h, 3)} style={{ fill: color }} />
                {(i === highlight || i === maxI) && values.length <= 31 && h > 0 && <text className="v" x={x + bw / 2} y={y - 4} textAnchor="middle">{c.money ? `${Math.round(v)} $` : val(v)}</text>}
                <rect className="hit" x={left + i * band} y={top} width={band} height={plotH} onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, title: labels[i] ?? '', rows: [{ color, label: c.title, value: val(v, c.money) }] })} />
                {i % step === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle">{labels[i]}</text>}
              </g>
            );
          })}
        </svg>
        <Tip tip={tip} />
      </div>
    </ChartCard>
  );
}

/** Horizontal bars: one row per named thing. One series = categorical colors (palette order, grey past 8); several = grouped. */
export function HBarChart({ labels, series, categorical = true, ...c }: Common & { labels: string[]; series: Series[]; categorical?: boolean }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const id = useId();
  const n = series.length, barH = n > 1 ? 9 : 14, gap = n > 1 ? 2 : 0, rowH = n > 1 ? n * (barH + gap) + 12 : 26;
  const labelW = Math.min(210, Math.max(90, W * 0.34)), valW = c.money ? 64 : 44;
  const x0 = labelW + 10, x1 = W - valW, height = labels.length * rowH + 6;
  const max = Math.max(0, ...series.flatMap(s => s.values)), m = niceMax(max);
  const chars = Math.max(8, Math.floor(labelW / 6.6));
  const color = (si: number, li: number) => series[si]?.color ?? (n === 1 && categorical ? catColor(li) : catColor(si));
  const total = series[0]?.values.reduce((a, x) => a + x, 0) ?? 0;
  const desc = labels.length ? t('brainLib.charts.firstLabel', { n: labels.length, first: labels[0] ?? '', value: val(series[0]?.values[0] ?? 0, c.money) }) : t('brainLib.charts.noData');
  return (
    <ChartCard {...c} labels={labels} series={series} legend>
      <div ref={ref} className="bx-plot">
        <svg width={W} height={height} role="img" aria-labelledby={`${id}t ${id}d`} onMouseLeave={() => setTip(null)}>
          <title id={`${id}t`}>{c.title}</title><desc id={`${id}d`}>{desc}</desc>
          {labels.map((l, li) => {
            const y = li * rowH + 3;
            return (
              <g key={li}>
                <text className="lbl" x={labelW} y={y + rowH / 2 + 1} textAnchor="end" dominantBaseline="middle">{l.length > chars ? `${l.slice(0, chars - 1)}…` : l}<title>{l}</title></text>
                {series.map((s, si) => {
                  const v = s.values[li] ?? 0, w = Math.max(v > 0 ? 2 : 0, ((x1 - x0) * v) / m);
                  const by = n > 1 ? y + 6 + si * (barH + gap) : y + (rowH - barH) / 2;
                  return (
                    <g key={si}>
                      <rect className="bar" x={x0} y={by} width={w} height={barH} rx={3} style={{ fill: color(si, li) }} />
                      {(n === 1 || v > 0) && <text className={n === 1 ? 'v' : ''} x={x0 + w + 6} y={by + barH / 2 + 1} dominantBaseline="middle">{c.money ? fmt.usd(v) : val(v)}</text>}
                    </g>
                  );
                })}
                <rect className="hit" x={0} y={y} width={W} height={rowH} onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, title: l, rows: series.map((s, si) => ({ color: color(si, li), label: s.label, value: `${val(s.values[li] ?? 0, c.money)}${n === 1 && total ? ` · ${fmt.pct(s.values[li] ?? 0, total)}%` : ''}` })) })} />
              </g>
            );
          })}
        </svg>
        <Tip tip={tip} />
      </div>
    </ChartCard>
  );
}

/** Vertical stacked bars: one bar per label, one colored segment per series (legend on top). */
export function StackedBars({ labels, series, height = 220, ...c }: Common & { labels: string[]; series: Series[]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const id = useId();
  const totals = labels.map((_, j) => series.reduce((a, s) => a + (s.values[j] ?? 0), 0));
  const max = Math.max(0, ...totals), m = niceMax(max);
  const left = c.money ? 50 : 34, right = W - 6, top = 14, bottom = 24, plotH = height - top - bottom;
  const band = (right - left) / Math.max(1, labels.length), bw = Math.max(4, Math.min(44, band * 0.6));
  const step = labelStep(labels.length, right - left, 62);
  const desc = labels.length ? t('brainLib.charts.nBarsRange', { n: labels.length, from: val(totals[0] ?? 0), to: val(totals[totals.length - 1] ?? 0) }) : t('brainLib.charts.noData');
  return (
    <ChartCard {...c} labels={labels} series={series} legend>
      <div ref={ref} className="bx-plot">
        <svg width={W} height={height} role="img" aria-labelledby={`${id}t ${id}d`} onMouseLeave={() => setTip(null)}>
          <title id={`${id}t`}>{c.title}</title><desc id={`${id}d`}>{desc}</desc>
          <Axis max={max} money={c.money} left={left} right={right} top={top} plotH={plotH} />
          {labels.map((l, j) => {
            const x = left + j * band + (band - bw) / 2;
            let acc = 0;
            const segs = series.map((s, si) => {
              const v = s.values[j] ?? 0, h = (v / m) * plotH, y = top + plotH - ((acc + v) / m) * plotH;
              acc += v;
              return v > 0 ? <rect key={si} className="bar" x={x} y={y} width={bw} height={Math.max(0, h - (si < series.length - 1 ? 1 : 0))} rx={si === series.length - 1 ? 2 : 0} style={{ fill: s.color ?? catColor(si) }} /> : null;
            });
            return (
              <g key={j}>
                {segs}
                <text className="v" x={x + bw / 2} y={top + plotH - ((totals[j] ?? 0) / m) * plotH - 4} textAnchor="middle">{val(totals[j] ?? 0, c.money)}</text>
                <rect className="hit" x={left + j * band} y={top} width={band} height={plotH} onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, title: `${l} · ${val(totals[j] ?? 0, c.money)}`, rows: series.map((s, si) => ({ color: s.color ?? catColor(si), label: s.label, value: val(s.values[j] ?? 0, c.money) })).reverse() })} />
                {j % step === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle">{l}</text>}
              </g>
            );
          })}
        </svg>
        <Tip tip={tip} />
      </div>
    </ChartCard>
  );
}

/** Tiny bars for a tile (last one highlighted); an image with a label for screen readers. */
export function Sparkline({ values, labels, label, highlightLast = true, money }: { values: number[]; labels?: string[]; label: string; highlightLast?: boolean; money?: boolean }) {
  const max = Math.max(1e-9, ...values);
  return (
    <div className="bx-spark" role="img" aria-label={label}>
      {values.map((v, i) => <i key={i} className={highlightLast && i === values.length - 1 ? 'today' : ''} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={`${labels?.[i] ?? ''}: ${val(v, money)}`} />)}
    </div>
  );
}
