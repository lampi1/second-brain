// The kind of work by examples, the pure part (ADR 0197): nearest centroid over sentence embeddings with abstention.
// Why: the word rule (shared/work-concepts.ts taskOf) only knows its lexicon, so a request phrased in other words is
// «altro». A few labelled examples per class and a sentence encoder already make a usable classifier (SetFit, Tunstall
// et al. 2022, https://arxiv.org/abs/2209.11055: few-shot classification on sentence embeddings, no prompts); here
// without fine-tuning: one centroid (the normalised mean) per kind from the user's own runs, the nearest wins, and
// below a similarity threshold the answer is «altro». The labels are the word rule's own kinds on runs with a verified
// outcome, so the test measures agreement with the word rule, never the truth (said on the card). The split is by run
// id (a stable hash): 20% test, 20% calibration of the threshold, 60% training; the final centroids use training and
// calibration, the test is never seen. Pure, no IO: used by kind-model.ts; tests in test/unit/brainmodel/kind-centroids.test.ts.

export const ALTRO = 'altro';
/** Below this many examples a kind gets no centroid (the word rule keeps deciding it). */
export const MIN_PER_KIND = 5;

export interface Example { id: string; kind: string; vec: Float32Array }

/** 0..99 from a run id (FNV-1a): the same run always lands in the same part. */
export function bucketOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % 100;
}
export type Part = 'test' | 'calibration' | 'train';
export const partOf = (id: string): Part => { const b = bucketOf(id); return b < 20 ? 'test' : b < 40 ? 'calibration' : 'train'; };

const dot = (a: Float32Array, b: Float32Array): number => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i]! * b[i]!; return s; };
const normalise = (v: Float32Array): Float32Array => { const n = Math.sqrt(dot(v, v)); if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n; return v; };

/** One normalised mean per kind with at least `min` examples («altro» never has one: it is the abstention). */
export function centroids(examples: readonly Example[], min = MIN_PER_KIND): Map<string, Float32Array> {
  const by = new Map<string, Example[]>();
  for (const e of examples) if (e.kind !== ALTRO) by.set(e.kind, [...(by.get(e.kind) ?? []), e]);
  const out = new Map<string, Float32Array>();
  for (const [k, es] of by) {
    if (es.length < min) continue;
    const c = new Float32Array(es[0]!.vec.length);
    for (const e of es) for (let i = 0; i < c.length; i++) c[i]! += e.vec[i] ?? 0;
    out.set(k, normalise(c));
  }
  return out;
}

/** The nearest centroid and its cosine (the vectors are normalised); null with no centroid. */
export function nearest(vec: Float32Array, cs: ReadonlyMap<string, Float32Array>): { kind: string; sim: number } | null {
  let best: { kind: string; sim: number } | null = null;
  for (const [kind, c] of cs) { const sim = dot(vec, c); if (!best || sim > best.sim) best = { kind, sim }; }
  return best;
}

/** The kind, or «altro» below the threshold. */
export function predict(vec: Float32Array, cs: ReadonlyMap<string, Float32Array>, threshold: number): string {
  const n = nearest(vec, cs);
  return n && n.sim >= threshold ? n.kind : ALTRO;
}

/** The label to compare with: a kind without a centroid counts as «altro» (the classifier cannot name it). */
const target = (kind: string, cs: ReadonlyMap<string, Float32Array>): string => (cs.has(kind) ? kind : ALTRO);

/** The threshold that agrees most with the labels on `cal` (abstaining is right on «altro»); ties go to the lower one
 *  (fewer abstentions). Candidates: 0 and every observed similarity. null with no calibration example. */
export function calibrate(cal: readonly Example[], cs: ReadonlyMap<string, Float32Array>): number | null {
  if (!cal.length || !cs.size) return null;
  const scored = cal.map(e => ({ want: target(e.kind, cs), near: nearest(e.vec, cs)! }));
  const candidates = [...new Set([0, ...scored.map(s => s.near.sim)])].sort((a, b) => a - b);
  let best = 0, hits = -1;
  for (const t of candidates) {
    const h = scored.filter(s => (s.near.sim >= t ? s.near.kind : ALTRO) === s.want).length;
    if (h > hits) { hits = h; best = t; }
  }
  return best;
}

export interface Evaluation { n: number; agree: number; labels: string[]; matrix: number[][]; altroProposed: { n: number; of: number } }
/** The confusion matrix on `test`: rows = the label (a kind without a centroid is «altro»), columns = the prediction. */
export function evaluate(test: readonly Example[], cs: ReadonlyMap<string, Float32Array>, threshold: number): Evaluation {
  const labels = [...[...cs.keys()].sort(), ALTRO], at = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  let agree = 0, altro = 0, proposed = 0;
  for (const e of test) {
    const want = target(e.kind, cs), got = predict(e.vec, cs, threshold);
    matrix[at.get(want)!]![at.get(got)!]!++;
    if (want === got) agree++;
    if (e.kind === ALTRO) { altro++; if (got !== ALTRO) proposed++; }
  }
  return { n: test.length, agree, labels, matrix, altroProposed: { n: proposed, of: altro } };
}

/** The whole recipe: split by run id, calibrate on the calibration part with training centroids, then the final
 *  centroids on training + calibration, tested on the test part. null = under MIN_PER_KIND examples for two kinds. */
export function trainAndTest(examples: readonly Example[], min = MIN_PER_KIND): { centroids: Map<string, Float32Array>; threshold: number; test: Evaluation } | null {
  const test = examples.filter(e => partOf(e.id) === 'test'), cal = examples.filter(e => partOf(e.id) === 'calibration'), train = examples.filter(e => partOf(e.id) === 'train');
  const first = centroids(train, min);
  const final = centroids([...train, ...cal], min);
  if (final.size < 2) return null;
  // too few in the training part alone for a centroid: calibrate against the final ones (said in the ADR: a small history)
  const threshold = calibrate(cal, first.size >= 2 ? first : final) ?? 0;
  return { centroids: final, threshold, test: evaluate(test, final, threshold) };
}
