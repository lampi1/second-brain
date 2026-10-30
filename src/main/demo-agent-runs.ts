// Demo agent runs (SB_DEMO=1): a made-up, deterministic history of ended runs per role, so the Agenti cards show a level,
// a performance % and their run metrics without any engine. Some roles are veterans, some are still "in rodaggio"
// (too few judged runs). The runs carry what sizes a job (turns, working
// time, the Artisan's changed files in its receipts, ADR 0130, 0131), so the XP differs by job; the Artisan's runs the
// user did not judge are decided by their receipts (checks passed after the last change), also under an Orchestrator's
// opinion; some Strategist runs carry a plan the user approved and a delegated Scout; two tasks were handed to another
// role (a decision signal against the Orchestrator); Flash has a few weeks of answer outcomes (flash-outcomes.ts).
// Used by DemoChats.runMetrics (demo.ts), demo-wiring.ts and the levels diagnostic (`npm run levels -- --demo`).
import type { AgentMetrics, AgentRun, AgentRunOutcome, AgentRunReceipts } from '../shared/agents';
import { runMetrics } from './agents/run-metrics';
import { standings, withStandings } from './agents/standing';
import { emptyFlashLog, type FlashLog, type FlashVerdict, type FlashWhy } from './agents/flash-outcomes';

/** the frozen demo's clock (demo.ts FROZEN_EPOCH): 2026-10-11 10:30 Rome */
export const DEMO_NOW = Date.UTC(2026, 9, 11, 8, 30, 0);

/** role → ended runs, share judged by the user, success odds, median minutes, median cost */
const PLAN: [string, number, number, number, number, number][] = [
  ['artisan', 61, 0.55, 0.86, 24, 1.35],
  ['strategist', 34, 0.6, 0.8, 12, 0.6],
  ['scout', 19, 0.55, 0.72, 9, 0.28],
  ['sentinel', 11, 0.7, 0.75, 7, 0.22],
  ['herald', 3, 1, 1, 3, 0.05],
];

/** A small linear congruential generator: the same history at every start. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** an Artisan's receipts: `files` changed, the repo's tests run after the last change with `exit` */
function receipts(files: number, endedAt: number, exit: number): AgentRunReceipts {
  const names = Array.from({ length: Math.min(files, 15) }, (_, i) => `src/module-${i + 1}.ts`);
  return { commands: [{ cmd: 'npm test', exit, at: endedAt - 60_000, check: true }], more: 0, files: names, filesMore: Math.max(0, files - 15), filesKnown: true, filesGap: false,
    testsTouched: false, codeTouched: true, lastChangeAt: endedAt - 120_000, commits: 0, prs: 0, verdict: { result: exit === 0 ? 'pass' : 'fail', reason: exit === 0 ? 'checks-passed' : 'check-failed', at: endedAt } };
}

export function demoAgentRuns(now: number): AgentRun[] {
  const rand = lcg(42), out: AgentRun[] = [];
  let id = 0;
  const next = () => `r_${(++id).toString(16).padStart(12, '0')}`;
  for (const [agentId, n, judged, odds, minutes, cost] of PLAN) {
    for (let i = 0; i < n; i++) {
      const endedAt = now - Math.round((i + 0.5) * (75 / n) * 86_400_000 * (0.6 + 0.8 * rand()));
      const dur = Math.round(minutes * 60_000 * (0.5 + rand()));
      const roll = rand(), verdict: AgentRunOutcome['verdict'] = roll < odds ? 'success' : roll < odds + (1 - odds) / 2 ? 'partial' : 'fail';
      const by = rand(), turns = 1 + Math.floor(rand() * (minutes / 3));
      const outcome: AgentRunOutcome | undefined = by < judged ? { verdict, basis: 'human', at: endedAt, by: 'user' }
        : by < judged + 0.25 ? { verdict, basis: 'orchestrator-opinion', at: endedAt, by: 'orchestrator' } : undefined;
      const artisan = agentId === 'artisan', report = !outcome || (artisan && outcome.basis !== 'human');
      const runId = next();
      out.push({ runId, chatId: `demo-run-${id}`, agentId, version: 1, goal: 'Demo', startedBy: 'orchestrator',
        startedAt: endedAt - dur, endedAt, endReason: 'completed', turns, ...(outcome ? { outcome } : {}),
        ...(report ? { report: { at: endedAt, outcome: verdict === 'success' ? 'done' : verdict === 'partial' ? 'partial' : 'blocked', verified: 'yes', summary: 'Demo', via: 'agent_report' } as const } : {}),
        // the Artisan's code work: its receipts (a failed check where the job did not succeed)
        ...(artisan ? { receipts: receipts(1 + Math.floor(rand() * 12), endedAt, verdict === 'success' ? 0 : 1) } : {}),
        // a third of the Strategist's jobs went through a plan with the user (approved as proposed, or after one change)
        ...(agentId === 'strategist' && i % 3 === 0 ? { plan: { proposals: 1 + (i % 2), changes: i % 2, approvedAt: endedAt - dur + 60_000 } } : {}),
        corrections: { tagged: 0, afterReport: 0 },
        counters: { questions: Math.floor(rand() * 2), permissions: Math.floor(rand() * 3), commands: Math.floor(rand() * 8), reopened: 0, contextPeak: null },
        costUsd: Math.round(cost * (0.5 + rand()) * 1000) / 1000, tokens: null, executionMs: Math.round(dur * 0.7) });
      // the Strategist's planned jobs delegated a Scout, whose full report reached it in time: the chain (ADR 0125)
      const parent = out[out.length - 1]!;
      if (agentId === 'strategist' && i % 3 === 0) {
        out.push({ runId: next(), chatId: `demo-run-${id}`, agentId: 'scout', version: 1, goal: 'Demo', startedBy: 'parent', parentRunId: runId,
          startedAt: parent.startedAt + 60_000, endedAt: parent.endedAt! - 60_000, endReason: 'completed', turns: 3,
          report: { at: parent.endedAt! - 60_000, outcome: 'done', verified: 'yes', summary: 'Demo', via: 'agent_report' }, corrections: { tagged: 0, afterReport: 0 },
          counters: { questions: 0, permissions: 0, commands: 2, reopened: 0, contextPeak: null }, costUsd: 0.2, tokens: null, executionMs: 240_000 });
      }
    }
  }
  // two tasks the Orchestrator handed to another role (a Scout's research redone as an Artisan's job)
  const scouts = out.filter(r => r.agentId === 'scout' && !r.parentRunId).slice(0, 2);
  for (const s of scouts) {
    out.push({ runId: next(), chatId: `demo-run-${id}`, agentId: 'artisan', version: 1, goal: 'Demo', startedBy: 'orchestrator', reworkOf: s.runId,
      startedAt: s.endedAt! + 3600_000, endedAt: s.endedAt! + 7200_000, endReason: 'completed', turns: 6,
      outcome: { verdict: 'success', basis: 'human', at: s.endedAt! + 7200_000, by: 'user' }, corrections: { tagged: 0, afterReport: 0 },
      counters: { questions: 0, permissions: 1, commands: 4, reopened: 0, contextPeak: null }, costUsd: 1.1, tokens: null, executionMs: 2_400_000 });
  }
  return out;
}

/** Flash's answers over the last weeks: most held, a few corrected, asked again or handed to the Orchestrator. */
export function demoFlashLog(now: number): FlashLog {
  const rand = lcg(7), log = emptyFlashLog();
  for (let i = 0; i < 60; i++) {
    const at = now - Math.round((i + 0.5) * 0.4 * 86_400_000 * (0.6 + 0.8 * rand())), roll = rand();
    const [verdict, why]: [FlashVerdict, FlashWhy] = roll < 0.82 ? ['success', 'held'] : roll < 0.88 ? ['fail', 'corrected'] : roll < 0.93 ? ['fail', 'reasked'] : ['partial', 'handed'];
    log.done.unshift({ at, verdict, why });
    log.total[verdict]++;
  }
  return log;
}

/** The agents:metrics answer of the demo: the §5 metrics plus each card's standing. */
export function demoAgentMetrics(now: number): AgentMetrics[] {
  const runs = demoAgentRuns(now), standing = standings(runs, [], now, demoFlashLog(now));
  return withStandings(runMetrics(runs, { now }), standing);
}
