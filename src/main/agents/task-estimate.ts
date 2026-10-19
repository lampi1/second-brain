// The task estimate (ADR 0087; owner, 2026-10-19: «l'orchestratore deve essere bravo a capire se può cavarsela in fretta
// anche con le stime per task simile»): how long and how much a request should take, from the agent runs of similar past
// tasks, and the path that follows: the Orchestrator answers a small question itself, starts ONE agent with no children
// for a quick single-part job, and plans a delegation tree only for work of several parts. Similar = same agent and same
// kind (the keyword classifier of brain/estimates.ts on the run's goal), else the same kind on any agent, else the same
// agent on any kind; the most recent MAX_SIMILAR of the first group with MIN_SIMILAR or more. Time = the run's execution
// time (waits for the user excluded), cost = its reported cost; the figure is the median, the range the middle half.
// Pure apart from a kind cache. Used by the task_estimate tool and app_create_chat's answer (appctl/tools.ts), by IPC
// agents:estimates (index.ts) for the strips, and by estimate-accuracy.ts's backtest.
import type { AgentRun } from '../../shared/agents';
import type { JobKind } from '../../shared/contract';
import { MAX_SIMILAR, MIN_SIMILAR, QUICK_MS, QUICK_USD, type EstimateActual, type EstimateBasis, type EstimateConfidence, type FastPath, type RunEstimateView, type TaskEstimate } from '../../shared/task-estimate';
import { classify, normalize } from '../brain/estimates';
import type { ToolDef } from '../appctl/tools';

/** A longer first-to-last span without a measured execution time is a run left open, not work. */
export const MAX_ELAPSED_MS = 8 * 3600_000;
/** Above this a single-part job is still one agent, but the Orchestrator is told it is long. */
export const LONG_MS = 45 * 60_000;
/** A request this short that asks a question is one the Orchestrator can answer itself. */
export const SELF_CHARS = 400;

interface Sample { endedAt: number; timeMs: number | null; costUsd: number | null }

/** The request without the app's own leading label line ("[Messaggio di un agente …]"), which says nothing of the task. */
export const requestText = (text: string): string => String(text ?? '').replace(/^\s*\[[^\]\n]{0,300}\]\s*/, '');

const kinds = new Map<string, { goal: string; kind: JobKind }>();
/** The classifier's kind of a run's goal (cached per run: the goal is frozen at the run's end). */
export function kindOfRun(r: Pick<AgentRun, 'runId' | 'goal'>): JobKind {
  const hit = kinds.get(r.runId);
  if (hit && hit.goal === r.goal) return hit.kind;
  const kind = classify(requestText(r.goal));
  if (kinds.size > 20_000) kinds.clear();
  kinds.set(r.runId, { goal: r.goal, kind });
  return kind;
}

/** What an ended run actually took; null when it is not a task to learn from (open, a one-shot job, nothing measured). */
export function actualOf(r: AgentRun): EstimateActual | null {
  if (r.endedAt === undefined || r.source === 'oneshot') return null;
  const elapsed = r.endedAt - r.startedAt;
  const timeMs = typeof r.executionMs === 'number' && r.executionMs > 0 ? r.executionMs
    : r.endReason === 'completed' && elapsed > 0 && elapsed <= MAX_ELAPSED_MS ? elapsed : null;
  const costUsd = typeof r.costUsd === 'number' && r.costUsd > 0 ? r.costUsd : null;
  return timeMs === null && costUsd === null ? null : { timeMs, costUsd };
}

/** The ended runs grouped the three ways a task can be similar, each group sorted by end time. */
export class SimilarIndex {
  private groups = new Map<string, Sample[]>();
  constructor(runs: readonly AgentRun[]) {
    for (const r of runs) {
      const a = actualOf(r);
      if (!a) continue;
      const kind = kindOfRun(r), s: Sample = { endedAt: r.endedAt!, ...a };
      for (const key of [`ak:${r.agentId}:${kind}`, `k:${kind}`, `a:${r.agentId}`]) {
        const g = this.groups.get(key);
        if (g) g.push(s); else this.groups.set(key, [s]);
      }
    }
    for (const g of this.groups.values()) g.sort((x, y) => x.endedAt - y.endedAt);
  }
  /** The most recent MAX_SIMILAR samples of a group that ended before `before`. */
  pick(key: string, before: number): Sample[] {
    const g = this.groups.get(key);
    if (!g) return [];
    let lo = 0, hi = g.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid]!.endedAt < before) lo = mid + 1; else hi = mid; }
    return g.slice(Math.max(0, lo - MAX_SIMILAR), lo);
  }
}

/** The q-quantile of sorted numbers (linear interpolation). */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}
const spread = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { mid: quantile(s, 0.5), low: quantile(s, 0.25), high: quantile(s, 0.75) }; };

const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/;
const JOINS = /;\s|\b(?:e poi|poi|inoltre|e anche|infine|and then|then|also|after that|finally|as well as)\b/g;
/** Independent parts of a request: the items of a list (two or more), else 1 + the joins between steps. At most 8. */
export function partsOf(text: string): number {
  const lines = String(text ?? '').split(/\r?\n/);
  const items = lines.filter(l => LIST_ITEM.test(l)).length;
  if (items >= 2) return Math.min(8, items);
  return Math.min(8, 1 + (normalize(text).match(JOINS)?.length ?? 0));
}

function confidenceOf(n: number, basis: EstimateBasis, s: { low: number; high: number } | null): EstimateConfidence {
  const tight = !s || !(s.low > 0) || s.high / s.low <= 3;
  const level = n >= 10 && tight ? 2 : n >= 5 ? 1 : 0;
  return (['low', 'medium', 'high'] as const)[Math.max(0, level - (basis === 'agent' ? 1 : 0))]!;
}

const mins = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

export interface EstimateInput {
  /** the request or the run's goal */
  text: string;
  /** the agent (catalog role) that would run it; omitted = any agent */
  agentId?: string;
  /** only runs ended before this time (a run's own start, for the strips and the backtest) */
  before?: number;
}

/** The estimate of one request from the index. */
export function estimateTask(index: SimilarIndex, input: EstimateInput): TaskEstimate {
  const text = requestText(input.text);
  const kind = classify(text), before = input.before ?? Infinity;
  const tiers: [EstimateBasis, string][] = input.agentId
    ? [['agent-kind', `ak:${input.agentId}:${kind}`], ['kind', `k:${kind}`], ['agent', `a:${input.agentId}`]]
    : [['kind', `k:${kind}`]];
  let basis: EstimateBasis | null = null, samples: Sample[] = [];
  for (const [b, key] of tiers) {
    const s = index.pick(key, before);
    if (s.length >= MIN_SIMILAR) { basis = b; samples = s; break; }
  }
  const times = samples.map(s => s.timeMs).filter((v): v is number => v !== null);
  const costs = samples.map(s => s.costUsd).filter((v): v is number => v !== null);
  const t = times.length >= MIN_SIMILAR ? spread(times) : null, c = costs.length >= MIN_SIMILAR ? spread(costs) : null;
  const parts = partsOf(text);
  const timeMs = t ? Math.round(t.mid) : null, costUsd = c ? Math.round(c.mid * 1000) / 1000 : null;
  const quick = timeMs !== null && timeMs <= QUICK_MS && (costUsd === null || costUsd <= QUICK_USD);
  const shortQuestion = kind === 'question' && text.trim().length <= SELF_CHARS;
  const path: FastPath = parts >= 3 || (parts === 2 && !quick) ? 'tree' : shortQuestion && parts === 1 && (quick || timeMs === null) ? 'self' : 'one-agent';
  const figure = timeMs !== null ? `similar tasks took ~${mins(timeMs)} (median of ${samples.length})` : basis ? `${samples.length} similar tasks, no measured time` : `fewer than ${MIN_SIMILAR} similar tasks, no figure`;
  const why = path === 'self'
    ? `A short question, ${parts} part; ${figure}: answer it yourself, without starting a chat.`
    : path === 'one-agent'
      ? `${parts === 1 ? 'One part' : 'Two small parts'}; ${figure}${timeMs !== null && timeMs > LONG_MS ? ' (long: tell the user)' : ''}: start ONE agent with app_create_chat and tell it to do the work itself, without agent_delegate.`
      : `${parts} independent parts; ${figure}: plan it (a strategist, or one chat per part in parallel).`;
  return {
    kind, basis, n: samples.length,
    timeMs, timeLowMs: t ? Math.round(t.low) : null, timeHighMs: t ? Math.round(t.high) : null,
    costUsd, costLowUsd: c ? Math.round(c.low * 1000) / 1000 : null, costHighUsd: c ? Math.round(c.high * 1000) / 1000 : null,
    confidence: basis ? confidenceOf(samples.length, basis, t) : null, parts, quick, path, why,
  };
}

/** Half to double: a real time inside it is an estimate that held (the strips' ✓). */
export const held = (estimateMs: number, actualMs: number): boolean => actualMs >= estimateMs / 2 && actualMs <= estimateMs * 2;

/** The strips' view of some runs: each one's estimate from the runs ended before it started, and its actual once ended. */
export function runEstimates(runs: readonly AgentRun[], runIds: readonly string[], index = new SimilarIndex(runs)): Record<string, RunEstimateView> {
  const want = new Set(runIds), out: Record<string, RunEstimateView> = {};
  for (const r of runs) {
    if (!want.has(r.runId) || r.source === 'oneshot') continue;
    const estimate = estimateTask(index, { text: r.goal, agentId: r.agentId, before: r.startedAt });
    const actual = actualOf(r);
    const hit = estimate.timeMs !== null && actual?.timeMs != null ? held(estimate.timeMs, actual.timeMs) : null;
    out[r.runId] = { runId: r.runId, estimate: estimate.basis ? estimate : null, actual, hit };
  }
  return out;
}

/** task_estimate for the Orchestrator: numbers only, never another run's content. */
export function estimateTool(runs: () => readonly AgentRun[]): ToolDef {
  return {
    name: 'task_estimate',
    description: 'Before you start work, estimate a request from similar past tasks (same agent and kind first): median work time, cost, the middle-half range, how many similar tasks it rests on (n), confidence, the independent parts it has, and the path: "self" = a short question you answer yourself; "one-agent" = start ONE chat with app_create_chat that does it alone (no agent_delegate children); "tree" = several parts, plan them. Numbers only, never a run\'s content.',
    inputSchema: { type: 'object', required: ['request'], additionalProperties: false, properties: {
      request: { type: 'string', description: 'the user\'s request, as you would give it to the agent' },
      agentId: { type: 'string', description: 'optional: the role that would run it (agent_catalog); omitted = any agent' },
    } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: a => {
      const request = typeof a.request === 'string' ? a.request.trim() : '';
      if (!request || request.length > 8000) throw new Error('task_estimate: request = 1 to 8000 characters.');
      if (a.agentId !== undefined && (typeof a.agentId !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(a.agentId))) throw new Error('task_estimate: agentId = a role id from agent_catalog.');
      return estimateTask(new SimilarIndex(runs()), { text: request, ...(a.agentId ? { agentId: a.agentId as string } : {}) });
    },
  };
}
