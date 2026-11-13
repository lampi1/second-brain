// A fixed model registry for the unit tests of model choice (brain/routing.ts, the routed chats, the Orchestrator): the
// shape of a brain's harness/models.json (Claude auto, Cursor manual) with known ids, tiers, prices and efforts, so the
// tests read the same rows whatever the release template lists. It moved here from src/main/brain/routing-demo.ts
// when the app stopped carrying model ids in code (ADR 0256).
import type { ModelRegistry } from '../../src/shared/contract';

const p = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number) => ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output });
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const TEST_REGISTRY: ModelRegistry = {
  harnesses: { claude: { routing: 'auto' }, cursor: { routing: 'manual' }, api: { routing: 'manual' } },
  defaultModel: 'claude-opus-5-5', modifiers: { usGeo: 1.1, webSearchPerRequest: 0.01 },
  models: [
    { id: 'claude-fable-5-1', harness: 'claude', provider: 'anthropic', aliases: ['fable'], routing: 'auto', tier: 'top', price: p(10, 12.5, 20, 0.25, 50), efforts: [...ALL], defaultEffort: 'high', contextWindow: 1_000_000 },
    { id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', aliases: ['opus'], routing: 'auto', tier: 'strong', fastFactor: 2, price: p(4, 5, 8, 0.2, 20), efforts: [...ALL], defaultEffort: 'medium', contextWindow: 1_000_000 },
    { id: 'claude-sonnet-5-5', harness: 'claude', provider: 'anthropic', aliases: ['sonnet'], routing: 'auto', tier: 'mid', price: p(2, 2.5, 4, 0.1, 10), efforts: [...ALL], defaultEffort: 'high', contextWindow: 1_000_000 },
    { id: 'claude-haiku-5-5', harness: 'claude', provider: 'anthropic', aliases: ['haiku'], routing: 'auto', tier: 'fast', price: p(0.1, 0.125, 0.2, 0.01, 0.5), efforts: [...ALL], defaultEffort: 'medium', contextWindow: 1_000_000 },
    { id: 'claude-sonnet-4-6', harness: 'claude', provider: 'anthropic', routing: 'manual', tier: 'mid', price: p(3, 3.75, 6, 0.3, 15), efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', contextWindow: 1_000_000 },
    { id: 'grok-4.7', harness: 'cursor', provider: 'xai', routing: 'manual', price: p(3, 3, 3, 0.75, 15), efforts: [], defaultEffort: null },
  ],
};
