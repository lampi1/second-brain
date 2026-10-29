// The shapes of the task estimate (ADR 0087): how long and how much a request should take, read from the agent runs
// of similar past tasks (same agent and same kind first), with how many tasks it rests on, how sure it is, how many
// parts the request has and the path that follows (the Orchestrator answers itself, starts one agent, or plans a tree).
// Also the estimate's measured accuracy week by week (a backtest of the same estimator on the past runs). Computed in
// main (src/main/agents/task-estimate.ts, estimate-accuracy.ts); read by the Grindhouse strips and the Orchestrator's plan
// (renderer lib/run-estimates.ts) over IPC agents:estimates, and by the Orchestrator through the task_estimate tool.
import type { TaskKind } from './contract';

/** Which past runs the estimate rests on: same agent and same kind, same kind on any agent, the same agent on any kind. */
export type EstimateBasis = 'agent-kind' | 'kind' | 'agent';
export type EstimateConfidence = 'high' | 'medium' | 'low';
/** self = the Orchestrator answers itself; one-agent = one chat, no children; tree = a plan of several parts */
export type FastPath = 'self' | 'one-agent' | 'tree';

export interface TaskEstimate {
  /** the request's kind of work (shared/work-concepts.ts taskOf, the one taxonomy: ADR 0182) */
  kind: TaskKind;
  /** null = fewer than MIN_SIMILAR similar tasks: no figure, only the parts and the path */
  basis: EstimateBasis | null;
  /** similar ended tasks the figures rest on */
  n: number;
  /** median time of the similar jobs (each one's elapsed time, start to end, ADR 0182), calibrated by the kind's past
   *  actual/estimate ratio, ms; low/high = the middle half */
  timeMs: number | null; timeLowMs: number | null; timeHighMs: number | null;
  /** median cost of the similar jobs' trees (their delegated children too), USD, calibrated the same way */
  costUsd: number | null; costLowUsd: number | null; costHighUsd: number | null;
  /** from the spread of the similar jobs' actuals (ADR 0182), never from how many there are */
  confidence: EstimateConfidence | null;
  /** independent parts read from the request (a list; a join followed by an imperative; a pasted block = one part) */
  parts: number;
  quick: boolean;
  path: FastPath;
  /** one English sentence for the Orchestrator: why this path */
  why: string;
}

export interface EstimateActual { timeMs: number | null; costUsd: number | null }

/** One run as the strips show it: the estimate made from the runs ended before it started, and, once it ended, its actual
 *  figures and whether the time fell inside half to double the estimate. */
export interface RunEstimateView {
  runId: string;
  estimate: TaskEstimate | null;
  actual: EstimateActual | null;
  /** null = no estimate or no actual time */
  hit: boolean | null;
}

export interface AccuracyPoint {
  /** Monday 00:00 (local) of the week, ms */
  weekStart: number;
  /** ended runs of that week that had an estimate */
  n: number;
  /** share whose real time fell between half and double the estimate (0..1) */
  hitRate: number | null;
  /** median |real − estimate| / estimate, 0..∞ */
  medianErr: number | null;
  /** share of the estimates that rested on the same agent and the same kind (the most specific match) */
  specificShare: number | null;
}

export interface EstimateAccuracy {
  points: AccuracyPoint[];
  /** all the weeks together: n estimated runs, `hits` of them within ×2 (real time between half and double) */
  n: number; hits: number; hitRate: number | null;
  // no trend: "last week minus the first", whatever the n of each week, was noise shown as progress (ADR 0101)
}

export interface RunEstimates {
  runs: Record<string, RunEstimateView>;
  accuracy: EstimateAccuracy;
}

/** The thresholds, shared so the "?" explanations quote the same numbers the code uses. */
export const MIN_SIMILAR = 3;
export const MAX_SIMILAR = 30;
export const QUICK_MS = 10 * 60_000;
export const QUICK_USD = 0.5;

/** The line the app adds under a user's message to the Orchestrator (ChatManager deliverNow): the estimate it would
 *  get from task_estimate, so its first model call can act on it instead of calling the tool (one model round trip
 *  less per request). The chat view never shows it: the item keeps the user's text, a transcript re-read drops it. */
export const ESTIMATE_LINE_TAG = '[app estimate';
export const estimateLine = (e: Pick<TaskEstimate, 'path' | 'why'>): string => `${ESTIMATE_LINE_TAG} · path "${e.path}"] ${e.why}`;
/** The user's text without the app's estimate line. */
export const withoutEstimateLine = (text: string): string => text.replace(/\n*\[app estimate · path "[a-z-]+"\][^\n]*$/, '');
