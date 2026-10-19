// Pins agents/model-tier.ts: a tier's candidates (the user's pick first, then the registry's auto and manual models)
// and an independent role's model, which moves to a higher tier to avoid its parent's model but never above tierMax.
import { describe, expect, it } from 'vitest';
import type { ModelRegistry, RegistryModel } from '../../../src/shared/contract';
import { cappedTier, independentModel, tierCandidates, tierModel } from '../../../src/main/agents/model-tier';

const price = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 };
const row = (id: string, tier: string, routing: 'auto' | 'manual' = 'auto'): RegistryModel => ({ id, harness: 'claude', provider: 'anthropic', routing, tier, price, efforts: [], defaultEffort: null });
const registry: ModelRegistry = { harnesses: {}, defaultModel: 'm-mid', models: [row('s-light', 'small'), row('m-mid-manual', 'mid', 'manual'), row('m-mid', 'mid'), row('h-top', 'high')] };

describe('model tiers', () => {
  it('lists a tier best first: the user pick, then auto, then manual', () => {
    expect(tierCandidates('claude', 'mid', registry, undefined)).toEqual(['m-mid', 'm-mid-manual']);
    expect(tierCandidates('claude', 'mid', registry, { claude: { mid: 'own' } })).toEqual(['own', 'm-mid', 'm-mid-manual']);
    expect(tierModel('cursor', 'mid', registry, undefined)).toBeNull();
  });
  it('an independent role takes another model of its tier, else one higher', () => {
    expect(independentModel('claude', 'mid', 'm-mid', registry, undefined, 'top')).toEqual({ model: 'm-mid-manual', independent: true });
    const one = { ...registry, models: [row('s-light', 'small'), row('m-mid', 'mid'), row('h-top', 'high')] };
    expect(independentModel('claude', 'mid', 'm-mid', one, undefined, 'top')).toEqual({ model: 'h-top', independent: true });
    expect(independentModel('claude', 'mid', null, one, undefined, 'top')).toEqual({ model: 'm-mid', independent: true });
  });
  it('never moves above tierMax: it shares the model instead', () => {
    const one = { ...registry, models: [row('s-light', 'small'), row('m-mid', 'mid'), row('h-top', 'high')] };
    expect(independentModel('claude', 'mid', 'm-mid', one, undefined, 'mid')).toEqual({ model: 'm-mid', independent: false });
    expect(independentModel('claude', 'light', 's-light', one, undefined, 'mid')).toEqual({ model: 'm-mid', independent: true });
    // no ceiling given = the tier itself
    expect(independentModel('claude', 'light', 's-light', one, undefined)).toEqual({ model: 's-light', independent: false });
  });
  it('caps a tier at the maximum', () => {
    expect(cappedTier('top', 'mid')).toBe('mid');
    expect(cappedTier('light', 'mid')).toBe('light');
  });
});
