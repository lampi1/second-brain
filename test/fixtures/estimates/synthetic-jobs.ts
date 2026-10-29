// Synthetic job history for the task estimate's replay (ADR 0182). Not real data: built so that the old estimator (the
// median execution time of similar runs) against what the user waited (the job's elapsed time) gives the ratios measured
// on 10 days of the owner's runs (actual/estimate p25 1.03, p50 2.01, p75 4.21): each kind of job waits a different share
// of its time (a fix runs straight, a feature and a QA job wait twice their work, a research job about four times),
// with some noise. Deterministic (seeded). Used by test/unit/agents/estimate-replay.test.ts.
import type { AgentRun } from '../../../src/shared/agents';

const MIN = 60_000, DAY = 86_400_000;
/** kind → goal, the agent, its median execution minutes and how many times that it waits in all */
const KINDS = [
  { goal: (i: number) => `Correggi il bug ${i} del totale`, agentId: 'artisan', exec: 4, wait: 1.0 },
  { goal: (i: number) => `Aggiungi la funzione ${i} al carrello`, agentId: 'artisan', exec: 8, wait: 2.0 },
  { goal: (i: number) => `Esegui i test case ${i} in staging`, agentId: 'sentinel', exec: 5, wait: 2.0 },
  { goal: (i: number) => `Analizza i log ${i} del server`, agentId: 'scout', exec: 3, wait: 4.2 },
] as const;

/** a third of the jobs run straight, a third wait twice their work, a third about four times */
const ORDER = [0, 1, 3, 0, 2, 3, 0, 1, 3] as const;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** `n` root jobs over 10 days from `start` (ORDER), plus a costed child for each feature job. */
export function syntheticJobs(n = 240, start = Date.UTC(2026, 9, 20), seed = 182): AgentRun[] {
  const rnd = prng(seed), normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const runs: AgentRun[] = [];
  let seq = 0;
  const id = () => `r_${(0xb00000000000 + seq++).toString(16)}`;
  for (let i = 0; i < n; i++) {
    const k = KINDS[ORDER[i % ORDER.length]!]!;
    const execMs = Math.round(k.exec * MIN * Math.exp(0.25 * normal()));
    const elapsed = Math.round(execMs * k.wait * Math.exp(0.3 * normal()));
    const startedAt = start + Math.round((i / n) * 10 * DAY), runId = id();
    const costUsd = Math.round(0.4 * k.exec * Math.exp(0.3 * normal()) * 100) / 100;
    runs.push({ runId, chatId: `c_${runId}`, agentId: k.agentId, version: 1, goal: k.goal(i), startedBy: 'orchestrator', startedAt, endedAt: startedAt + elapsed,
      endReason: 'completed', executionMs: execMs, costUsd, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } } as AgentRun);
    if (k.wait === 2.0 && k.agentId === 'artisan') {
      const kid = id();
      runs.push({ runId: kid, chatId: `c_${kid}`, agentId: 'scout', version: 1, goal: `Scrivi la nota ${i}`, startedBy: 'parent', parentRunId: runId, startedAt: startedAt + MIN,
        endedAt: startedAt + 3 * MIN, endReason: 'completed', executionMs: 2 * MIN, costUsd: 0.2, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } } as AgentRun);
    }
  }
  return runs;
}
