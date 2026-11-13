// A role's automatic judges against the user (ADR 0197): per role, the prediction-powered estimate of its success
// (shared/ppi.ts) from every automatic judgment of its runs (the newest Sentinel review verdict on the run, else the
// receipts' decision: receipts.ts receiptDecision) corrected by the runs the user also judged (his 👍/👎, basis human),
// and the Sentinel's agreement with him on the same runs (share and Cohen's kappa). Zero tokens, retained runs only:
// pruned rollups keep counts, not per-run judgments, so a long history is estimated on its kept part (said on the page).
// Used by run-metrics.ts runMetrics (the all-versions row's `judges`); unit tests in test/unit/agents/judge-agreement.test.ts.
import type { AgentRun } from '../../shared/agents';
import { agreementOf, ppiMean, type RoleJudges } from '../../shared/ppi';
import { VERDICT_WEIGHT, type Verdict } from '../../shared/success';
import { receiptDecision } from './receipts';
import { counts, earnIndex, gradableReview, type EarnIndex } from './standing';

/** The user's own verdict on a run, or null. */
const humanOf = (r: AgentRun): Verdict | null => r.outcome?.basis === 'human' && r.outcome.verdict !== 'unknown' ? r.outcome.verdict : null;
/** The newest completed Sentinel review's verdict on a run, or null. */
export function reviewOf(r: AgentRun, ix: EarnIndex): Verdict | null {
  const last = (ix.reviews.get(r.runId) ?? []).filter(gradableReview).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  return last?.report?.verdict ?? null;
}
/** The receipts' decision on a completed run, whatever its recorded outcome (the user's verdict does not hide it here). */
const receiptsOf = (r: AgentRun): Verdict | null => r.endReason === 'completed' && r.receipts?.verdict ? receiptDecision(r)?.verdict ?? null : null;

/** Per role id, its judges over the runs given (ended, counted, not themselves reviews). */
export function roleJudges(runs: readonly AgentRun[], ix: EarnIndex = earnIndex(runs)): Map<string, RoleJudges> {
  const by = new Map<string, { auto: number[]; pairs: { human: number; auto: number }[]; human: number; sentinel: [Verdict, Verdict][] }>();
  for (const r of runs) {
    if (!counts(r) || r.reviewOf) continue;
    const human = humanOf(r), review = reviewOf(r, ix), auto = review ?? receiptsOf(r);
    if (!human && !auto) continue;
    const b = by.get(r.agentId) ?? { auto: [], pairs: [], human: 0, sentinel: [] };
    if (human) b.human++;
    if (auto && human) b.pairs.push({ human: VERDICT_WEIGHT[human], auto: VERDICT_WEIGHT[auto] });
    else if (auto) b.auto.push(VERDICT_WEIGHT[auto]);
    if (review && human) b.sentinel.push([review, human]);
    by.set(r.agentId, b);
  }
  return new Map([...by].map(([id, b]) => [id, { ppi: ppiMean(b.auto, b.pairs), pairs: b.pairs.length, autoOnly: b.auto.length, human: b.human, sentinel: agreementOf(b.sentinel) }]));
}
