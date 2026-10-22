// Macro tasks (issue #160): the work the user asked for, one row each, with the cost of everything it started. A macro
// task is a top-level run (no parentRunId: the Orchestrator's, the user's or the app's own) together with the follow-ups
// of the same task (same taskId); its cost is its own plus every descendant's (children, grandchildren, independent
// reviews, reworks, continuations), unknown ("n/d") as soon as one part is unknown. Pure: main serves it ('runs:macro'),
// the Fatto page groups it by day. Zero tokens, nothing read outside the run store.
import type { AgentRun } from './agents';

export type MacroOutcome = 'done' | 'partial' | 'blocked' | 'running' | 'closed';
export interface MacroTask {
  /** the first run of the task (its id is the task's) */
  id: string;
  chatId: string;
  agentId: string;
  goal: string;
  startedAt: number;
  /** the last run's end; absent while one of its runs is still open */
  endedAt?: number;
  outcome: MacroOutcome;
  /** own + descendants' cost in USD; null = some part is unknown (an engine that reports no usage) */
  costUsd: number | null;
  /** how many runs it counts (its own and its descendants') */
  runs: number;
}

/** The runs that hang under a run: delegated children, reviews and reworks of it, and continuations. */
function childrenIndex(runs: readonly AgentRun[]): Map<string, AgentRun[]> {
  const by = new Map<string, AgentRun[]>();
  const add = (parent: string | undefined, r: AgentRun) => { if (parent && parent !== r.runId) (by.get(parent) ?? by.set(parent, []).get(parent)!).push(r); };
  for (const r of runs) { add(r.parentRunId, r); add(r.reviewOf, r); add(r.reworkOf, r); add(r.continuedFrom, r); }
  return by;
}

const outcomeOf = (last: AgentRun, open: boolean): MacroOutcome => open ? 'running' : last.report?.outcome ?? (last.outcome?.verdict === 'success' ? 'done' : last.outcome?.verdict === 'partial' ? 'partial' : last.outcome?.verdict === 'fail' ? 'blocked' : 'closed');

/** Every macro task started at or after `since`, newest first. A run whose parent is not in the store (pruned) is a
 *  root of its own; a cycle in the links is walked once. */
export function macroTasks(runs: readonly AgentRun[], since = 0): MacroTask[] {
  const ids = new Set(runs.map(r => r.runId));
  const kids = childrenIndex(runs);
  const linked = (r: AgentRun) => [r.parentRunId, r.reviewOf, r.reworkOf, r.continuedFrom].some(p => p && p !== r.runId && ids.has(p));
  // roots grouped by task: a follow-up of the Orchestrator's assignment is the same macro task
  const groups = new Map<string, AgentRun[]>();
  for (const r of runs) {
    if (r.source === 'oneshot' || linked(r)) continue;
    const key = r.taskId && ids.has(r.taskId) ? r.taskId : r.runId;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  // a follow-up (continuedFrom, reworkOf a root) is reached from its root, never a root of its own
  const out: MacroTask[] = [];
  for (const roots of groups.values()) {
    roots.sort((a, b) => a.startedAt - b.startedAt);
    const first = roots[0]!;
    if (first.startedAt < since) continue;
    const seen = new Set<string>(), stack = [...roots];
    let cost: number | null = 0, open = false, last = first, endedAt = 0;
    while (stack.length) {
      const r = stack.pop()!;
      if (seen.has(r.runId)) continue;
      seen.add(r.runId);
      cost = cost === null || r.costUsd === null ? null : cost + r.costUsd;
      if (r.endedAt === undefined) open = true; else endedAt = Math.max(endedAt, r.endedAt);
      // the outcome is the latest run in the root's own chat (its follow-ups), not a child's
      if (r.chatId === first.chatId && r.startedAt >= last.startedAt) last = r;
      for (const k of kids.get(r.runId) ?? []) stack.push(k);
    }
    out.push({ id: first.runId, chatId: last.chatId, agentId: first.agentId, goal: first.goal, startedAt: first.startedAt,
      ...(open ? {} : { endedAt }), outcome: outcomeOf(last, open), costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6, runs: seen.size });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** The local day (YYYY-MM-DD) a macro task sits on: its start, also when it spans midnight. */
export const macroDay = (t: Pick<MacroTask, 'startedAt'>): string => {
  const d = new Date(t.startedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A day's total: the sum of its tasks, null when any is unknown. */
export const dayTotal = (tasks: readonly MacroTask[]): number | null =>
  tasks.reduce<number | null>((s, t) => s === null || t.costUsd === null ? null : s + t.costUsd, 0);
