// The few statistics the app uses to say whether a number means something (owner, 2026-10-20: «le tecniche usate non
// hanno fonti che ne dimostrano la validità»): one method per question, used everywhere, so every percentage on screen can
// carry its interval or «dati insufficienti». Wilson score interval for a proportion (Wilson 1927; recommended for small
// n by Brown, Cai & DasGupta 2001), Newcombe's hybrid score interval for a difference of two proportions (Newcombe 1998,
// method 10), and a seeded percentile bootstrap for a difference of means (Efron & Tibshirani 1993) — seeded so the same
// data always gives the same interval. A verdict is given only at fixed checkpoints of n (limits "peeking": Johari et
// al., KDD 2017). Pure; no I/O. Used by the evidence layer (brainmodel) and the renderer's stat tiles.

/** z for a two-sided 90% interval */
export const Z90 = 1.6448536269514722;
/** the n at which a verdict may be given (between them: «in raccolta»), per side */
export const CHECKPOINTS: readonly number[] = [20, 40, 80, 160];

/** The largest checkpoint at or below n (0 below the first): a side is judged on that many cases, so the verdict changes
 *  only when a side reaches the next checkpoint, never at every new case. */
export function atCheckpoint(n: number): number {
  let at = 0;
  for (const c of CHECKPOINTS) if (n >= c) at = c;
  return at;
}

export interface Interval { low: number; high: number }

/** Wilson score interval of k successes out of n; null for n = 0. */
export function wilson(k: number, n: number, z = Z90): Interval | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return { low: Math.max(0, mid - half), high: Math.min(1, mid + half) };
}

/** Newcombe's interval for p1 - p2 (k1/n1 minus k2/n2), from the two Wilson intervals; null when a side is empty. */
export function newcombe(k1: number, n1: number, k2: number, n2: number, z = Z90): Interval | null {
  const a = wilson(k1, n1, z), b = wilson(k2, n2, z);
  if (!a || !b) return null;
  const p1 = k1 / n1, p2 = k2 / n2, d = p1 - p2;
  return {
    low: d - Math.sqrt((p1 - a.low) ** 2 + (b.high - p2) ** 2),
    high: d + Math.sqrt((a.high - p1) ** 2 + (p2 - b.low) ** 2),
  };
}

/** A small seeded generator (mulberry32): the same data, the same interval. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap of mean(after) - mean(before), 90% by default; null when a side has fewer than 2 values. */
export function bootstrapDiff(before: readonly number[], after: readonly number[], opts: { rounds?: number; seed?: number; level?: number } = {}): Interval | null {
  if (before.length < 2 || after.length < 2) return null;
  const rounds = opts.rounds ?? 2000, next = rng(opts.seed ?? 1), level = opts.level ?? 0.9;
  const draw = (xs: readonly number[]): number => { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[Math.floor(next() * xs.length)]!; return s / xs.length; };
  const diffs = Array.from({ length: rounds }, () => draw(after) - draw(before)).sort((x, y) => x - y);
  const at = (q: number): number => diffs[Math.min(diffs.length - 1, Math.max(0, Math.floor(q * diffs.length)))]!;
  return { low: at((1 - level) / 2), high: at(1 - (1 - level) / 2) };
}

export type Verdict = 'raccolta' | 'aiuta' | 'nessun-effetto' | 'peggiora';

/** The verdict of a change on a metric, given its interval of after - before and the good direction; a verdict only at a
 *  checkpoint (both sides at least `minN`), «nessun-effetto» only when the interval sits inside ±margin. */
export function verdictOf(diff: Interval | null, n: { before: number; after: number }, direction: 'lower' | 'higher', margin = 0, minN = CHECKPOINTS[0]!): Verdict {
  if (!diff || n.before < minN || n.after < minN) return 'raccolta';
  const good = direction === 'lower' ? diff.high < 0 : diff.low > 0;
  const bad = direction === 'lower' ? diff.low > 0 : diff.high < 0;
  if (good) return 'aiuta';
  if (bad) return 'peggiora';
  return margin > 0 && diff.low > -margin && diff.high < margin ? 'nessun-effetto' : 'raccolta';
}

/** «k/n (IC 90% a–b%)» for a proportion, or «dati insufficienti (n/minN)» under minN. */
export function shareText(k: number, n: number, minN = 10): string {
  if (n < minN) return `dati insufficienti (${n}/${minN})`;
  const w = wilson(k, n)!;
  const pct = (x: number): number => Math.round(x * 100);
  return `${pct(k / n)}% · ${k}/${n} (IC 90% ${pct(w.low)}–${pct(w.high)}%)`;
}
