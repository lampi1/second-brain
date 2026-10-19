// The shapes of the task estimate (ADR 0087): how long and how much a request should take, read from the agent runs
// of similar past tasks (same agent and same kind first), with how many tasks it rests on, how sure it is, how many
// parts the request has and the path that follows (the Orchestrator answers itself, starts one agent, or plans a tree).
// Also the estimate's measured accuracy week by week (a backtest of the same estimator on the past runs). Computed in
// main (src/main/agents/task-estimate.ts, estimate-accuracy.ts); read by the Grindhouse strips and the Orchestrator's plan
// (renderer lib/run-estimates.ts) over IPC agents:estimates, and by the Orchestrator through the task_estimate tool.
import type { JobKind } from './contract';

/** Which past runs the estimate rests on: same agent and same kind, same kind on any agent, the same agent on any kind. */
export type EstimateBasis = 'agent-kind' | 'kind' | 'agent';
export type EstimateConfidence = 'high' | 'medium' | 'low';
/** self = the Orchestrator answers itself; one-agent = one chat, no children; tree = a plan of several parts */
export type FastPath = 'self' | 'one-agent' | 'tree';

export interface TaskEstimate {
  /** the keyword classifier's kind of the request (brain/estimates.ts classify) */
  kind: JobKind;
  /** null = fewer than MIN_SIMILAR similar tasks: no figure, only the parts and the path */
  basis: EstimateBasis | null;
  /** similar ended tasks the figures rest on */
  n: number;
  /** median work time (the run's execution time, waits excluded), ms; low/high = the middle half of the similar tasks */
  timeMs: number | null; timeLowMs: number | null; timeHighMs: number | null;
  /** median cost, USD (tasks with a reported cost only) */
  costUsd: number | null; costLowUsd: number | null; costHighUsd: number | null;
  confidence: EstimateConfidence | null;
  /** independent parts read from the request (a list, "poi", "inoltre", ";") */
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
  /** all the weeks together */
  n: number; hitRate: number | null;
  /** last week with data minus the first one, in points of hitRate (0..1); null with fewer than two weeks */
  trend: number | null;
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
