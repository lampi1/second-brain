// IPC agents:estimates (ADR 0087): what the Grindhouse strips and the Orchestrator's plan show, in one answer: the
// estimate of each run asked for (from the runs ended before it started) with its actual figures once ended, and the
// estimator's measured accuracy week by week. Runs = the run store plus the open chats' run mirrors (newer for an open
// run). The demo has no run history: demoEstimateRuns makes a deterministic one (eight weeks of six kinds of tasks whose
// spread narrows, so the accuracy visibly improves). Used by index.ts.
import type { AgentRun } from '../../shared/agents';
import type { RunEstimates } from '../../shared/task-estimate';
import { RUN_ID } from './runs';
import { runEstimates, SimilarIndex } from './task-estimate';
import { estimateAccuracy } from './estimate-accuracy';

export const RUN_IDS_MAX = 200;

/** The runIds the renderer asks for: valid run ids only, at most RUN_IDS_MAX. */
export function checkRunIds(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > RUN_IDS_MAX || !v.every(x => typeof x === 'string' && RUN_ID.test(x))) throw new Error(`runIds: up to ${RUN_IDS_MAX} run ids`);
  return [...new Set(v as string[])];
}

/** Store runs with the chats' mirrors laid over them (same runId: the mirror wins). */
export function mergeRuns(stored: readonly AgentRun[], mirrors: readonly (AgentRun | undefined)[]): AgentRun[] {
  const byId = new Map(stored.map(r => [r.runId, r]));
  for (const m of mirrors) if (m) byId.set(m.runId, m);
  return [...byId.values()];
}

export function estimatesState(runs: readonly AgentRun[], runIds: readonly string[], now: number): RunEstimates {
  const index = new SimilarIndex(runs);
  return { runs: runEstimates(runs, runIds, index), accuracy: estimateAccuracy(runs, now, undefined, index) };
}

// ── demo history ─────────────────────────────────────────────────────────────────────────────────────────────────────
const WEEK = 7 * 86400_000, MIN = 60_000;
const TEMPLATES: { agentId: string; goal: string; min: number; usd: number }[] = [
  { agentId: 'artisan', goal: 'Correggi il bug del totale ordine quando c\'è uno sconto', min: 22, usd: 0.9 },
  { agentId: 'artisan', goal: 'Aggiungi l\'export CSV alla pagina dei resi', min: 38, usd: 1.6 },
  { agentId: 'scout', goal: 'Cerca nei log gli errori 500 del checkout di ieri', min: 6, usd: 0.18 },
  { agentId: 'scout', goal: 'Quanti ordini sono rimasti in sospeso ieri?', min: 3, usd: 0.08 },
  { agentId: 'sentinel', goal: 'Esegui i test case dei rimborsi in ambiente di test', min: 18, usd: 0.6 },
  { agentId: 'sentinel', goal: 'Review della PR del fix totale ordine', min: 8, usd: 0.3 },
];

/** A small seeded generator (mulberry32): the same history on every start. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Eight weeks of ended runs before `now`: more tasks each week, a narrower spread each week. */
export function demoEstimateRuns(now: number): AgentRun[] {
  const rand = rng(87), out: AgentRun[] = [];
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
  let i = 0;
  for (let w = 0; w < 8; w++) {
    const sigma = 1.05 - 0.11 * w, per = 1 + (w >> 1);
    for (const tpl of TEMPLATES) for (let k = 0; k < per; k++) {
      const f = Math.exp(normal() * sigma);
      const exec = Math.round(tpl.min * f * MIN);
      const endedAt = Math.round(now - (8 - w) * WEEK + (0.1 + 0.85 * rand()) * WEEK);
      if (endedAt > now - 3600_000) continue;
      const startedAt = endedAt - exec - Math.round(rand() * 6 * MIN);
      out.push({
        runId: `r_${(0xd00000000000 + i++).toString(16)}`, chatId: `demo-past-${i}`, agentId: tpl.agentId, version: 1, goal: tpl.goal,
        startedBy: 'orchestrator', startedAt, endedAt, endReason: 'completed', executionMs: exec,
        costUsd: Math.round(tpl.usd * Math.pow(f, 0.8) * 1000) / 1000, tokens: null,
        counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
      });
    }
  }
  return out;
}
