// The one definition of "success" every figure of the app uses (ADR 0182): only verified verdicts count (the user's
// or a verified independent review's, run-verdict.ts VERIFIED_BASES; never the agent's own word, the Orchestrator's
// opinion or the silence proxy), a partial counts half, and below MIN_SUCCESS_SAMPLE verdicts there is no share, only
// the count ("troppo pochi"). Before, the Skill statistics took any verdict and wanted 10 (memory-stats.ts
// MIN_VERDICT), the run metrics weighed a partial 0.5 with no minimum, and the routing's per-kind counts took the
// brain's proxy too. Used by agents/run-metrics.ts, brainmodel/memory-stats.ts, brain/routing.ts agentStatsLine and
// the Agenti card and the role's versions (renderer AgentCatalogCard.tsx, AgentStudio.tsx). Pure: pinned by test/unit/shared/success.test.ts.
import type { AgentRun, AgentRunOutcome } from './agents';
import { verifiedVerdict } from './run-verdict';

/** Below this many verified verdicts a success share says nothing ("100%" from one, #159): show the count only. */
export const MIN_SUCCESS_SAMPLE = 5;

export type Verdict = Exclude<AgentRunOutcome['verdict'], 'unknown'>;
/** What one verdict is worth in a success share. */
export const VERDICT_WEIGHT: Readonly<Record<Verdict, number>> = { success: 1, partial: 0.5, fail: 0 };

/** A share and the verdicts it rests on; value null = no verdict. */
export interface SuccessShare { value: number | null; n: number }

/** The share of verdicts: successes plus half the partials, over all of them. */
export function successShare(verdicts: Iterable<Verdict>): SuccessShare {
  let n = 0, sum = 0;
  for (const v of verdicts) { n++; sum += VERDICT_WEIGHT[v]; }
  return { value: n ? sum / n : null, n };
}

/** A run's verdict when it counts for success (verified only), else null. */
export function countedVerdict(run: Parameters<typeof verifiedVerdict>[0]): Verdict | null {
  return verifiedVerdict(run, [], 0)?.verdict ?? null;
}

/** The success of runs, verified verdicts only. */
export function runsSuccess(runs: readonly Pick<AgentRun, 'endedAt' | 'report' | 'corrections' | 'counters' | 'outcome'>[]): SuccessShare {
  return successShare(runs.map(countedVerdict).filter((v): v is Verdict => v !== null));
}

/** The ± of a share at 90% (Wilson score interval, half its width): from 5 verdicts a share says "80% ± 26", never a
 *  bare "80%" that reads as a fact. Null below the sample or with no share. */
export function successMargin(s: SuccessShare, z = 1.645): number | null {
  if (s.value === null || s.n < MIN_SUCCESS_SAMPLE) return null;
  const p = s.value, n = s.n, z2 = z * z;
  return (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** true = enough verdicts for a share to be shown. */
export const enoughVerdicts = (s: Pick<SuccessShare, 'n'>): boolean => s.n >= MIN_SUCCESS_SAMPLE;
