// LiveCost: the running turn's estimate from stream-json `usage` at the brain's per-model list prices
// (harness/models.json; Opus 5.5 without a brain), one count per API response, the real figure from get_usage on top,
// and a clean start after the result.
import { afterEach, describe, expect, it } from 'vitest';
import { LiveCost, priceUsage, setPriceTable } from '../../../src/main/chats/live-cost';
import type { ModelRegistry } from '../../../src/shared/contract';

const msg = (id: string, model: string, u: Record<string, unknown>) => ({ type: 'assistant', message: { id, model, usage: u } });
const price = (input: number, w5: number, w1: number, read: number, output: number) => ({ input, cacheWrite5m: w5, cacheWrite1h: w1, cacheRead: read, output });
const REG: ModelRegistry = {
  harnesses: { claude: { routing: 'auto' } }, defaultModel: 'claude-opus-5-5', modifiers: { usGeo: 1.1 },
  models: [
    { id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', aliases: ['opus'], routing: 'auto', efforts: [], defaultEffort: null, fastFactor: 2, price: price(4, 5, 8, 0.2, 20) },
    { id: 'claude-sonnet-5', harness: 'claude', provider: 'anthropic', routing: 'manual', efforts: [], defaultEffort: null, price: price(2, 2.5, 4, 0.2, 10) },
    { id: 'claude-haiku-5-5', harness: 'claude', provider: 'anthropic', routing: 'auto', efforts: [], defaultEffort: null, price: price(0.1, 0.125, 0.2, 0.01, 0.5),
      longPrompt: { over: 100000, price: price(0.5, 0.625, 1, 0.05, 2.5) } },
    { id: 'claude-haiku-4-5', harness: 'claude', provider: 'anthropic', routing: 'manual', efforts: [], defaultEffort: null, noGeo: true, price: price(1, 1.25, 2, 0.1, 5) },
  ],
};
// Opus 5.5 $/token
const IN = 4e-6, OUT = 20e-6;

afterEach(() => setPriceTable(() => null));

describe('LiveCost', () => {
  it('prices usage with the per-model list prices of the table', () => {
    const u = { input_tokens: 1000, cache_creation_input_tokens: 800, cache_read_input_tokens: 10000, output_tokens: 200 };
    // 1000×4 + 800×5 + 10000×0.2 + 200×20 = 14000 µ$ (the 5-minute write when usage has no split)
    expect(priceUsage('claude-opus-5-5', u, REG)).toBeCloseTo(0.014, 9);
    expect(priceUsage('claude-sonnet-5', u, REG)).toBeCloseTo((2000 + 2000 + 2000 + 2000) / 1e6, 9);
    expect(priceUsage('claude-haiku-4-5-20251001', u, REG)).toBeCloseTo((1000 + 1000 + 1000 + 1000) / 1e6, 9);
    expect(priceUsage('opus[1m]', u, REG)).toBeCloseTo(0.014, 9);
    expect(priceUsage('mystery-model', u, REG)).toBeCloseTo(0.014, 9); // unknown: the table's default model
    expect(priceUsage('claude-opus-5-5', u, null)).toBeCloseTo(0.014, 9); // no brain: Opus 5.5 list price
    expect(priceUsage('x', {}, REG)).toBe(0);
  });

  it('splits 5-minute and 1-hour cache writes, applies the long-prompt tier, fast mode and US geo', () => {
    const split = { cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 } };
    expect(priceUsage('claude-opus-5-5', split, REG)).toBeCloseTo((400 * 5 + 600 * 8) / 1e6, 9);
    expect(priceUsage('claude-haiku-5-5', { input_tokens: 100000 }, REG)).toBeCloseTo(100000 * 0.1 / 1e6, 9);
    expect(priceUsage('claude-haiku-5-5', { input_tokens: 100001 }, REG)).toBeCloseTo(100001 * 0.5 / 1e6, 9);
    expect(priceUsage('claude-opus-5-5', { output_tokens: 100, speed: 'fast' }, REG)).toBeCloseTo(100 * OUT * 2, 9);
    expect(priceUsage('claude-opus-5-5', { output_tokens: 100, inference_geo: 'us' }, REG)).toBeCloseTo(100 * OUT * 1.1, 9);
    expect(priceUsage('claude-haiku-4-5', { output_tokens: 100, inference_geo: 'us' }, REG)).toBeCloseTo(100 * 5e-6, 9);
  });

  it('reads the table wiring sets', () => {
    setPriceTable(() => REG);
    expect(priceUsage('claude-sonnet-5', { output_tokens: 1000 })).toBeCloseTo(0.01, 9);
  });

  it('counts a response once even when the CLI repeats it per content block, and adds only its growth', () => {
    const l = new LiveCost();
    expect(l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 10 }))).toBe(true);
    const first = l.usd();
    expect(l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 10 }))).toBe(false); // same block again
    expect(l.usd()).toBe(first);
    l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 100, output_tokens: 30 })); // a later block, more output
    expect(l.usd()).toBeCloseTo(100 * IN + 30 * OUT, 9);
    l.add(msg('m2', 'claude-opus-5-5', { input_tokens: 50 }));
    expect(l.usd()).toBeCloseTo(150 * IN + 30 * OUT, 9);
  });

  it('keeps the 1-hour split of a repeated response', () => {
    const l = new LiveCost();
    l.add(msg('m1', 'claude-opus-5-5', { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } }));
    l.add(msg('m1', 'claude-opus-5-5', { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 }, output_tokens: 10 }));
    expect(l.usd()).toBeCloseTo(100 * 8e-6 + 10 * OUT, 9);
  });

  it('ignores messages without usage or id', () => {
    const l = new LiveCost();
    expect(l.add({ type: 'assistant', message: { id: 'a' } })).toBe(false);
    expect(l.add({ type: 'assistant', message: { usage: { input_tokens: 5 } } })).toBe(false);
    expect(l.add({ type: 'assistant' })).toBe(false);
    expect(l.usd()).toBe(0);
  });

  it('settle() puts the real cost in place of the estimate; new tokens add on top; reset() starts over', () => {
    const l = new LiveCost();
    l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 1000 }));
    expect(l.settle(0.5)).toBe(true);
    expect(l.usd()).toBe(0.5);
    expect(l.settle(0.5)).toBe(false);
    expect(l.settle(Number.NaN)).toBe(false);
    l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 100 })); // growth of a known response only
    expect(l.usd()).toBeCloseTo(0.5 + 100 * OUT, 9);
    l.reset();
    expect(l.usd()).toBe(0);
    l.add(msg('m1', 'claude-opus-5-5', { input_tokens: 1000 })); // after a reset the same id counts again (new turn)
    expect(l.usd()).toBeCloseTo(1000 * IN, 9);
  });
});
