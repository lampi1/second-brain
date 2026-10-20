// Pins agents/model-tier.ts: a tier's candidates (the user's pick first, then the registry's auto and manual models)
// and the cap at tierMax. No role switches model to be independent (ADR 0091).
import { describe, expect, it } from 'vitest';
import type { ModelRegistry, RegistryModel } from '../../../src/shared/contract';
import { cappedTier, tierCandidates, tierModel } from '../../../src/main/agents/model-tier';

const price = { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 };
const row = (id: string, tier: string, routing: 'auto' | 'manual' = 'auto'): RegistryModel => ({ id, harness: 'claude', provider: 'anthropic', routing, tier, price, efforts: [], defaultEffort: null });
const registry: ModelRegistry = { harnesses: {}, defaultModel: 'm-mid', models: [row('s-light', 'small'), row('m-mid-manual', 'mid', 'manual'), row('m-mid', 'mid'), row('h-top', 'high')] };

describe('model tiers', () => {
  it('lists a tier best first: the user pick, then auto, then manual', () => {
    expect(tierCandidates('claude', 'mid', registry, undefined)).toEqual(['m-mid', 'm-mid-manual']);
    expect(tierCandidates('claude', 'mid', registry, { claude: { mid: 'own' } })).toEqual(['own', 'm-mid', 'm-mid-manual']);
    expect(tierModel('cursor', 'mid', registry, undefined)).toBeNull();
  });
  it('gives Sentinel the same tier model as any role: no model switching for independence (ADR 0091)', () => {
    expect(tierModel('claude', 'top', registry, undefined)).toBe('h-top');
    expect(tierModel('claude', 'top', registry, { claude: { top: 'own-top' } })).toBe('own-top');
  });
  it('caps a tier at the maximum', () => {
    expect(cappedTier('top', 'mid')).toBe('mid');
    expect(cappedTier('light', 'mid')).toBe('light');
  });
});
