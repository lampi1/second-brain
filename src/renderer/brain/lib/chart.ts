// Chart math for the brain's small SVG charts (components/Charts.tsx): a "nice" axis maximum and its ticks, the
// categorical palette (fixed order, never cycled: past 8 categories the rest is grey "altro"), top-N with the rest
// summed, label thinning so x labels never collide. Pure; unit-tested in test/unit/brain-ui/chart.test.ts.

/** A round axis: the smallest 1/2/2.5/5 × 10^n step that covers max in at most maxTicks intervals, and its top. */
export function niceScale(max: number, maxTicks = 5): { top: number; step: number } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, step: 0.25 };
  for (let p = 10 ** Math.floor(Math.log10(max / maxTicks)); p < 1e15; p *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * p, n = Math.ceil(max / step - 1e-9);
      if (n <= maxTicks) return { top: n * step, step };
    }
  }
  return { top: max, step: max };
}
/** The axis top for max. */
export const niceMax = (max: number): number => niceScale(max).top;
/** The ticks from 0 to niceMax(max), on round steps (0, 10, 20 … never 12,5). */
export function ticks(max: number): number[] {
  const { top, step } = niceScale(max);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}
const decimals = (x: number): number => (Number.isInteger(x) ? 0 : Math.min(2, (String(Math.round(x * 1e6) / 1e6).split('.')[1] ?? '').length));
/** A tick's text with as many decimals as its step needs (12,5 stays 12,5; 1.250 becomes 1,25k). */
export function tickLabel(v: number, money = false, step = 1): string {
  const s = Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('it-IT', { maximumFractionDigits: decimals(step / 1000) })}k` : v.toLocaleString('it-IT', { maximumFractionDigits: decimals(step) });
  return money ? `${s} $` : s;
}

export const PALETTE_SIZE = 8;
/** CSS color of the i-th category (0-based): --cat-1..8, then the grey of "altro". */
export const catColor = (i: number): string => (i < PALETTE_SIZE ? `var(--bx-cat-${i + 1})` : 'var(--bx-cat-other)');

/** The first n entries by value, plus one "altro" with the sum of the rest. */
export function topN(entries: [string, number][], n: number, other = 'altro'): [string, number][] {
  const s = [...entries].sort((a, b) => b[1] - a[1]);
  if (s.length <= n) return s;
  return [...s.slice(0, n), [other, s.slice(n).reduce((a, x) => a + x[1], 0)]];
}

/** Show every k-th x label so labels (each ~charW px wide) fit in width. */
export function labelStep(count: number, width: number, charW = 46): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / charW))));
}

/** Entries of a {key: {usd}} object by usd, biggest first, zeros and the "<synthetic>" model left out. */
export function moneyEntries(o: Record<string, { usd: number }>): [string, number][] {
  return Object.entries(o).filter(([k, v]) => k !== '<synthetic>' && v.usd > 0).map(([k, v]) => [k, v.usd] as [string, number]).sort((a, b) => b[1] - a[1]);
}
