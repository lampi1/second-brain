// The ```chart block of an agent's reply (owner, 2026-10-22: «grafici e diagrammi … quando chiedo una spiegazione»): a
// small JSON spec the app draws as a chart (components/VisualBlock.tsx, Chart.js loaded on demand by lib/viz/chart.ts).
// The model's text is untrusted: only the fields below are read, every label is plain text (Chart.js draws it on a
// canvas, never as HTML), numbers must be finite, sizes are capped; anything else gives null and the block shows as
// code. The format the agents are told (main/agents/orchestrator-role.ts VISUALS_RULE):
//   {"type":"bar|line|pie","title":"…","labels":["a","b"],"series":[{"name":"…","data":[1,2]}]}
// plus the optional "stacked" / "horizontal" (bar) and "unit" (appended to the values). A Chart.js-style
// {"type", "data":{"labels","datasets":[{"label","data"}]}} is accepted too (models know it). Pure; unit-tested in
// test/unit/chart-spec.test.ts.

export type ChartKind = 'bar' | 'line' | 'pie' | 'doughnut';
export interface ChartSpec {
  type: ChartKind;
  title?: string;
  labels: string[];
  series: { name: string; data: number[] }[];
  stacked?: boolean;
  horizontal?: boolean;
  unit?: string;
}

export const MAX_SERIES = 8;
export const MAX_POINTS = 200;
const MAX_TEXT = 120;

const text = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : null;
const KINDS: Record<string, ChartKind> = { bar: 'bar', column: 'bar', columns: 'bar', line: 'line', area: 'line', pie: 'pie', doughnut: 'doughnut', donut: 'doughnut' };

/** The block's text → a checked spec, or null (not JSON, unknown type, no data, a value that is not a number). */
export function parseChartSpec(src: string): ChartSpec | null {
  let raw: unknown;
  try { raw = JSON.parse(src); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = KINDS[String(o.type ?? '').toLowerCase()];
  if (!type) return null;
  // Chart.js shape: data.labels + data.datasets[].label/data
  const d = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data as Record<string, unknown> : null;
  const labelsRaw = Array.isArray(o.labels) ? o.labels : Array.isArray(d?.labels) ? d.labels : null;
  const seriesRaw = Array.isArray(o.series) ? o.series : Array.isArray(d?.datasets) ? d.datasets : Array.isArray(o.data) ? [{ data: o.data }] : null;
  if (!labelsRaw || !seriesRaw || !labelsRaw.length || !seriesRaw.length) return null;
  if (labelsRaw.length > MAX_POINTS || seriesRaw.length > MAX_SERIES) return null;
  const labels = labelsRaw.map(l => text(l) ?? '');
  const series: ChartSpec['series'] = [];
  for (const [i, s] of seriesRaw.entries()) {
    if (!s || typeof s !== 'object') return null;
    const r = s as Record<string, unknown>;
    if (!Array.isArray(r.data) || r.data.length !== labels.length) return null;
    const data = r.data.map(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v));
    if (!data.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return null;
    series.push({ name: text(r.name ?? r.label) || `${i + 1}`, data });
  }
  // a pie shows one series: more would draw rings nobody reads
  if ((type === 'pie' || type === 'doughnut') && (series.length !== 1 || series[0]!.data.some(v => v < 0))) return null;
  const title = text(o.title ?? (o.options as { plugins?: { title?: { text?: unknown } } } | undefined)?.plugins?.title?.text);
  const unit = text(o.unit, 12);
  return {
    type, labels, series,
    ...(title ? { title } : {}),
    ...(unit ? { unit } : {}),
    ...(o.stacked === true && type === 'bar' ? { stacked: true } : {}),
    ...((o.horizontal === true || o.indexAxis === 'y') && type === 'bar' ? { horizontal: true } : {}),
  };
}

/** The spec as a plain table (the chart's accessible text and the "Dati" view): header row first. */
export function chartRows(s: ChartSpec): string[][] {
  return [['', ...s.series.map(x => x.name)], ...s.labels.map((l, i) => [l, ...s.series.map(x => String(x.data[i]))])];
}
