// Live estimates of an agent run's time and cost for the Grindhouse strips (ChatTile.tsx; owner, 18/10: «stime di tempo
// e costo live nelle striscioline, che si capisca che non è il tempo e il costo della run»). The estimate is the median
// elapsed time and median cost of the agent's own ended runs (agents:metrics, AGENTS-DESIGN §5), shown only when it rests
// on at least MIN_RUNS of them; it is never the run's own figure, which the strip's facts already show. One shared read
// for every strip, refreshed every minute while something uses it. Pure part (estimateOf) pinned by
// test/unit/agent-estimates.test.ts.
import { useEffect, useState } from 'react';
import type { AgentMetrics, AgentRun } from '@shared/agents';
import { sb } from '../sb';

/** Fewer ended runs than this and the median says too little to call it an estimate. */
export const MIN_RUNS = 3;
const REFRESH_MS = 60_000;

export interface RunEstimate {
  /** median elapsed time of the agent's ended runs, ms (null: not enough runs) */
  timeMs: number | null; timeRuns: number;
  /** median cost per run, USD (null: not enough runs or no reported cost) */
  costUsd: number | null; costRuns: number;
  /** time left against the estimate, ms (0 once past it); null without a time estimate */
  leftMs: number | null;
  over: boolean;
}

/** The estimate for an open run, from its agent's metrics at `now`; null when the run ended or nothing is estimable. */
export function estimateOf(run: Pick<AgentRun, 'agentId' | 'startedAt' | 'endedAt'> | undefined, metrics: readonly AgentMetrics[] | null, now: number): RunEstimate | null {
  if (!run || run.endedAt !== undefined || !metrics) return null;
  const all = metrics.find(m => m.agentId === run.agentId)?.all;
  if (!all) return null;
  const time = all.timeToDone.elapsed, cost = all.costPerRun.median;
  const timeMs = time.value !== null && time.n >= MIN_RUNS ? time.value : null;
  const costUsd = cost.value !== null && cost.n >= MIN_RUNS ? cost.value : null;
  if (timeMs === null && costUsd === null) return null;
  const spent = Math.max(0, now - run.startedAt);
  return { timeMs, timeRuns: time.n, costUsd, costRuns: cost.n, leftMs: timeMs === null ? null : Math.max(0, timeMs - spent), over: timeMs !== null && spent > timeMs };
}

let cache: AgentMetrics[] | null = null, users = 0, timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const read = () => void sb.invoke('agents:metrics', undefined).then(value => { cache = value; listeners.forEach(f => f()); }, () => {});

/** Every agent's metrics, shared by all strips (null until the first read). */
export function useAgentMetricsAll(): AgentMetrics[] | null {
  const [value, setValue] = useState(cache);
  useEffect(() => {
    const update = () => setValue(cache);
    listeners.add(update);
    if (users++ === 0) { read(); timer = setInterval(read, REFRESH_MS); }
    return () => { listeners.delete(update); if (--users === 0 && timer) { clearInterval(timer); timer = null; } };
  }, []);
  return value;
}
