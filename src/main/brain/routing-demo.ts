// The model registry of the demo (SB_DEMO=1): like the brain's harness/models.json (Claude auto, Cursor manual), so
// the tiers, the prices and app_create_chat behave as with a brain, with no files and no tokens. The demo's routing
// table left with the real one (ADR 0210). Used by demo.ts and the unit tests of brain/routing.ts.
import type { ModelRegistry } from '../../shared/contract';

const p = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number) => ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output });
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEMO_REGISTRY: ModelRegistry = {
  harnesses: { claude: { routing: 'auto' }, cursor: { routing: 'manual' }, api: { routing: 'manual' } },
  defaultModel: 'claude-opus-5-5', modifiers: { usGeo: 1.1, webSearchPerRequest: 0.01 },
  models: [
    { id: 'claude-fable-5-1', harness: 'claude', provider: 'anthropic', aliases: ['fable'], routing: 'auto', tier: 'top', price: p(10, 12.5, 20, 0.25, 50), efforts: [...ALL], defaultEffort: 'high' },
    { id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', aliases: ['opus'], routing: 'auto', tier: 'strong', fastFactor: 2, price: p(4, 5, 8, 0.2, 20), efforts: [...ALL], defaultEffort: 'medium' },
    { id: 'claude-sonnet-5-5', harness: 'claude', provider: 'anthropic', aliases: ['sonnet'], routing: 'auto', tier: 'mid', price: p(2, 2.5, 4, 0.1, 10), efforts: [...ALL], defaultEffort: 'high' },
    { id: 'claude-haiku-5-5', harness: 'claude', provider: 'anthropic', aliases: ['haiku'], routing: 'auto', tier: 'fast', price: p(0.1, 0.125, 0.2, 0.01, 0.5), efforts: [...ALL], defaultEffort: 'medium' },
    { id: 'grok-4.7', harness: 'cursor', provider: 'xai', routing: 'manual', price: p(3, 3, 3, 0.75, 15), efforts: [], defaultEffort: null },
  ],
};
