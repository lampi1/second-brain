// Demo agent runs (SB_DEMO=1): a made-up, deterministic history of ended runs per role, so the Agenti cards show a level,
// a performance % and their run metrics without any engine. Some roles are veterans, some are still "in rodaggio"
// (too few judged runs) and Pulse has none (the card's empty state). Used by DemoChats.runMetrics (demo.ts) only.
import type { AgentMetrics, AgentRun, AgentRunOutcome } from '../shared/agents';
import { runMetrics } from './agents/run-metrics';
import { standings, withStandings } from './agents/standing';

/** role → ended runs, share judged by the user, success odds, median minutes, median cost */
const PLAN: [string, number, number, number, number, number][] = [
  ['artisan', 61, 0.7, 0.86, 24, 1.35],
  ['strategist', 34, 0.6, 0.8, 12, 0.6],
  ['scout', 19, 0.55, 0.72, 9, 0.28],
  ['sentinel', 11, 0.7, 0.75, 7, 0.22],
  ['judge', 8, 0.4, 0.8, 4, 0.12],
  ['herald', 3, 1, 1, 3, 0.05],
  ['router', 2, 0, 1, 1, 0.01],
];

/** A small linear congruential generator: the same history at every start. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function demoAgentRuns(now: number): AgentRun[] {
  const rand = lcg(42), out: AgentRun[] = [];
  let id = 0;
  for (const [agentId, n, judged, odds, minutes, cost] of PLAN) {
    for (let i = 0; i < n; i++) {
      const endedAt = now - Math.round((i + 0.5) * (75 / n) * 86_400_000 * (0.6 + 0.8 * rand()));
      const dur = Math.round(minutes * 60_000 * (0.5 + rand()));
      const roll = rand(), verdict: AgentRunOutcome['verdict'] = roll < odds ? 'success' : roll < odds + (1 - odds) / 2 ? 'partial' : 'fail';
      const by = rand();
      const outcome: AgentRunOutcome | undefined = by < judged ? { verdict, basis: 'human', at: endedAt, by: 'user' }
        : by < judged + 0.25 ? { verdict, basis: 'orchestrator-opinion', at: endedAt, by: 'orchestrator' } : undefined;
      out.push({ runId: `r_${(++id).toString(16).padStart(12, '0')}`, chatId: `demo-run-${id}`, agentId, version: 1, goal: 'Demo', startedBy: 'orchestrator',
        startedAt: endedAt - dur, endedAt, endReason: 'completed', ...(outcome ? { outcome } : {}),
        ...(outcome ? {} : { report: { at: endedAt, outcome: verdict === 'success' ? 'done' : verdict === 'partial' ? 'partial' : 'blocked', verified: 'yes', summary: 'Demo' } as const }),
        counters: { questions: Math.floor(rand() * 2), permissions: Math.floor(rand() * 3), commands: Math.floor(rand() * 8), reopened: 0, contextPeak: null },
        costUsd: Math.round(cost * (0.5 + rand()) * 1000) / 1000, tokens: null, executionMs: Math.round(dur * 0.7) });
    }
  }
  return out;
}

/** The agents:metrics answer of the demo: the §5 metrics plus each card's standing. */
export function demoAgentMetrics(now: number): AgentMetrics[] {
  const runs = demoAgentRuns(now), standing = standings(runs, [], now);
  return withStandings(runMetrics(runs), standing);
}
