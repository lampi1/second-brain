// How good the task estimate is (ADR 0087; owner, 2026-10-19: «il progresso dei classificatori nelle
// stime»): a backtest of the same estimator (task-estimate.ts) on every ended run of the last weeks, each one estimated
// only from the runs that had ended before it started, as it would have been shown then. Per week: how many runs had an
// estimate, the share whose real time (the job's elapsed time, ADR 0182) fell between half and double it, the median relative error, and the share
// resting on the most specific match (same agent and same kind: it grows as the classifier sees more tasks). A small
// module of its own so the Classificatori page can read the series too (IPC agents:estimates returns
// it as `accuracy`). Pure. Used by index.ts (agents:estimates).
import type { AgentRun } from '../../shared/agents';
import type { AccuracyPoint, EstimateAccuracy } from '../../shared/task-estimate';
import { actualOf, estimateTask, held, quantile, SimilarIndex } from './task-estimate';

export const ACCURACY_WEEKS = 8;
const WEEK = 7 * 86400_000;

/** Monday 00:00 local time of the week holding `t`. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function estimateAccuracy(runs: readonly AgentRun[], now: number, weeks = ACCURACY_WEEKS, index = new SimilarIndex(runs)): EstimateAccuracy {
  const first = weekStart(now) - (weeks - 1) * WEEK;
  const buckets = new Map<number, { hits: number; n: number; errs: number[]; specific: number }>();
  for (let w = 0; w < weeks; w++) buckets.set(weekStart(first + w * WEEK + 3 * 86400_000), { hits: 0, n: 0, errs: [], specific: 0 });
  for (const r of runs) {
    if (r.endedAt === undefined || r.endedAt < first || r.endedAt > now) continue;
    const actual = index.actual(r.runId) ?? actualOf(r);
    if (actual?.timeMs == null) continue;
    const e = estimateTask(index, { text: r.goal, agentId: r.agentId, before: r.startedAt });
    if (e.timeMs === null || !(e.timeMs > 0)) continue;
    const b = buckets.get(weekStart(r.endedAt));
    if (!b) continue;
    b.n++;
    if (held(e.timeMs, actual.timeMs)) b.hits++;
    b.errs.push(Math.abs(actual.timeMs - e.timeMs) / e.timeMs);
    if (e.basis === 'agent-kind') b.specific++;
  }
  const points: AccuracyPoint[] = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([at, b]) => ({
    weekStart: at, n: b.n,
    hitRate: b.n ? b.hits / b.n : null,
    medianErr: b.n ? Math.round(quantile([...b.errs].sort((x, y) => x - y), 0.5) * 1000) / 1000 : null,
    specificShare: b.n ? b.specific / b.n : null,
  }));
  const withData = points.filter(p => p.hitRate !== null);
  const n = withData.reduce((s, p) => s + p.n, 0);
  const hits = Math.round(points.reduce((s, p) => s + (p.hitRate ?? 0) * p.n, 0));
  // the count within ×2 out of n, no trend (ADR 0101: last week − first week, whatever their n, read as progress)
  return { points, n, hits, hitRate: n ? hits / n : null };
}
