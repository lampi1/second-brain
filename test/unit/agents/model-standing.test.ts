// A role's results by model (ADR 0284, agents/standing.ts ModelStanding): the level stays the role's, the performance
// is the model's and starts from the role's own; a run whose engine reported tokens but no cost is priced at list
// price (agents/list-price.ts) and marked as an estimate; a model with no price stays without a cost.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import type { ModelRegistry } from '../../../src/shared/contract';
import { MODEL_MIN_EVALUATED, MODEL_PRIOR_WEIGHT, estimate, listCost, standings } from '../../../src/main/agents/standing';
import { tokenPriceOf } from '../../../src/main/agents/list-price';

const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${String(++seq).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: 'artisan', version: 1, goal: 'x',
  startedBy: 'user', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed',
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 1, tokens: null, ...over });
const human = (verdict: 'success' | 'partial' | 'fail') => ({ verdict, basis: 'human' as const, at: NOW, by: 'user' });
const of = (runs: AgentRun[], priceOf = tokenPriceOf(() => null)) => standings(runs, [], NOW, null, priceOf).get('artisan')!;
const registry = { models: [{ id: 'gpt-6-astra', harness: 'codex', price: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 0.2, output: 10 } }] } as unknown as ModelRegistry;

describe('standing by model', () => {
  it('one row per model, most runs first; a run without a model is in the role\'s figures only', () => {
    const s = of([run({ model: 'claude-opus-5-5' }), run({ model: 'claude-opus-5-5' }), run({ model: 'openai/gpt-6-astra' }), run()]);
    expect(s.runs).toBe(4);
    expect(s.models!.map(m => [m.model, m.runs])).toEqual([['claude-opus-5-5', 2], ['openai/gpt-6-astra', 1]]);
  });

  it('a model\'s performance starts from the role\'s own, not from 50%, and shows after fewer verdicts', () => {
    const good = Array.from({ length: 12 }, () => run({ model: 'claude-opus-5-5', outcome: human('success') }));
    const fresh = Array.from({ length: MODEL_MIN_EVALUATED }, () => run({ model: 'claude-fable-5-2', outcome: human('fail') }));
    const s = of([...good, ...fresh]);
    const row = s.models!.find(m => m.model === 'claude-fable-5-2')!;
    expect(row.evaluated).toBe(MODEL_MIN_EVALUATED);
    expect(row.performance).not.toBeNull();
    // three fails over a prior at the role's level: lower than the role, higher than the same fails over 50%
    expect(row.performance!).toBeLessThan(s.performance!);
    expect(row.performance!).toBeGreaterThan(estimate(0, row.evaluated, { mean: 0.5, weight: MODEL_PRIOR_WEIGHT }).mean);
    const two = of([...good, ...fresh.slice(0, MODEL_MIN_EVALUATED - 1)]).models!.find(m => m.model === 'claude-fable-5-2')!;
    expect(two.performance).toBeNull(); // «in rodaggio»
  });

  it('the cost of a success counts every run of the model, failed ones too', () => {
    const s = of([run({ model: 'm', costUsd: 2, outcome: human('success') }), run({ model: 'm', costUsd: 4, outcome: human('fail') })]);
    expect(s.models![0]).toMatchObject({ runs: 2, wins: 1, costPerWin: 6, costEstimated: false, unpriced: 0 });
  });

  it('tokens without a cost are priced at list price, whatever engine ran the model, and marked as an estimate', () => {
    const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 100_000 };
    expect(listCost(tokens, { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 })).toBe(3);
    const s = of([run({ model: 'openai/gpt-6-astra', costUsd: null, tokens, outcome: human('success') })], tokenPriceOf(() => registry));
    expect(s.models![0]).toMatchObject({ costPerWin: 3, costEstimated: true, unpriced: 0 });
  });

  it('a model with no list price keeps its runs without a cost: never a silent 0', () => {
    const tokens = { input: 1000, cacheRead: 0, cacheWrite: 0, output: 10 };
    const s = of([run({ model: 'acme/unknown-1', costUsd: null, tokens, outcome: human('success') })], tokenPriceOf(() => registry));
    expect(s.models![0]).toMatchObject({ costPerWin: null, unpriced: 1 });
  });

  it('a list price is found by the model\'s own name: provider prefix, context suffix, dots or dashes', () => {
    const price = tokenPriceOf(() => registry);
    expect(price('openai/gpt-6-astra')).toMatchObject({ input: 2, output: 10, cacheWrite: 2.5 });
    expect(price('gpt-6.astra[1m]')).toMatchObject({ input: 2 });
    expect(price('claude-sonnet-5.5')).toMatchObject({ input: 2, output: 10 }); // from the kept list prices
    expect(price('acme/unknown-1')).toBeNull();
  });

  it('the working time is the median of the model\'s runs', () => {
    const s = of([1, 5, 9].map(min => run({ model: 'm', executionMs: min * 60_000 })));
    expect(s.models![0]!.medianMs).toBe(5 * 60_000);
  });
});
