// Prediction-powered inference for a role's success, and how far the automatic judge agrees with the user (ADR 0197).
// Why: the role's success counts only verified verdicts (shared/success.ts, ADR 0186), so most roles stay «troppo
// pochi» while the Sentinel's reviews and the receipts judge many more runs. Prediction-powered inference (Angelopoulos,
// Bates, Fannjiang, Jordan, Zrnic, «Prediction-powered inference», Science 382, 2023; the rectifier for LLM judges in
// Chen et al., ICML 2026) uses the automatic judgments of every run and corrects their bias with the runs the user also
// judged: θ̂ = mean(auto over the runs only the judge saw) + mean(human − auto over the runs with both), with a normal
// confidence interval from both variances. It is only as good as the pairs: below MIN_PAIRS runs with both there is no
// estimate. The agreement is the share of equal verdicts and Cohen's kappa (Cohen 1960), chance-corrected, with its n.
// Pure, no Node: used by main/agents/judge-agreement.ts, shown by the role page (AgentStudio.tsx). Pinned by
// test/unit/shared/ppi.test.ts.

/** Below this many runs judged by both the user and the automatic judge, no estimate (the same bar as success.ts). */
export const MIN_PAIRS = 5;

export interface PpiEstimate {
  /** the estimate and its interval, clipped to 0..1 */
  value: number; low: number; high: number;
  /** runs with both judgments (the rectifier's sample) and runs with the automatic one only */
  n: number; unlabeled: number;
  /** the automatic judges' mean over the unlabeled runs, and the rectifier mean(human − auto) */
  autoMean: number; rectifier: number;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
/** sample variance (n − 1); 0 for one value */
const variance = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};
const clip = (x: number): number => Math.min(1, Math.max(0, x));

/** The PPI mean (0..1 values): `auto` = automatic judgments of the runs the user did not judge; `pairs` = runs with both.
 *  With no unlabeled run it is the human mean (the rectifier over its own pairs). null under MIN_PAIRS pairs. z = 1.645:
 *  a 90% interval, as every interval of the app (success.ts successInterval). */
export function ppiMean(auto: readonly number[], pairs: readonly { human: number; auto: number }[], z = 1.645): PpiEstimate | null {
  if (pairs.length < MIN_PAIRS) return null;
  const diff = pairs.map(p => p.human - p.auto);
  const rectifier = mean(diff);
  if (!auto.length) {
    const h = pairs.map(p => p.human), m = mean(h), half = z * Math.sqrt(variance(h) / h.length);
    return { value: clip(m), low: clip(m - half), high: clip(m + half), n: pairs.length, unlabeled: 0, autoMean: mean(pairs.map(p => p.auto)), rectifier };
  }
  const autoMean = mean(auto), value = autoMean + rectifier;
  const half = z * Math.sqrt(variance(auto) / auto.length + variance(diff) / diff.length);
  return { value: clip(value), low: clip(value - half), high: clip(value + half), n: pairs.length, unlabeled: auto.length, autoMean, rectifier };
}

export interface Agreement {
  /** runs with both verdicts, and how many are equal */
  n: number; agree: number;
  /** agree / n; null with no pair */
  share: number | null;
  /** Cohen's kappa; null with no pair or when chance agreement is total (one category only) */
  kappa: number | null;
}
/** Agreement of two raters over categorical labels (success / partial / fail). */
export function agreementOf<T extends string>(pairs: readonly (readonly [T, T])[]): Agreement {
  const n = pairs.length;
  if (!n) return { n: 0, agree: 0, share: null, kappa: null };
  const agree = pairs.filter(([a, b]) => a === b).length, po = agree / n;
  const ca = new Map<T, number>(), cb = new Map<T, number>();
  for (const [a, b] of pairs) { ca.set(a, (ca.get(a) ?? 0) + 1); cb.set(b, (cb.get(b) ?? 0) + 1); }
  let pe = 0;
  for (const [k, x] of ca) pe += (x / n) * ((cb.get(k) ?? 0) / n);
  return { n, agree, share: po, kappa: pe >= 1 ? null : (po - pe) / (1 - pe) };
}

/** A role's automatic judges against the user (main/agents/judge-agreement.ts): the PPI estimate of its success (null
 *  under MIN_PAIRS), how many runs have both judgments, the automatic one only, the user's; and the Sentinel's review
 *  verdicts against the user's on the same runs. Retained runs only: pruned rollups keep no per-run judgments. */
export interface RoleJudges { ppi: PpiEstimate | null; pairs: number; autoOnly: number; human: number; sentinel: Agreement }
