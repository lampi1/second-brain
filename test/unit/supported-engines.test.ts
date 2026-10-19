// Retirement regressions: saved settings/setup remain readable and unsupported engines leave UI choices.
import { expect, it } from 'vitest';
import { fromSaved } from '../../src/main/brain/config';
import { checkSetup } from '../../src/main/agents/setup';
import { brainEngine, engineInfos, engineOf } from '../../src/main/engines/registry';
import { engines } from '../../src/modules/ai-first/model';
import { pickable } from '../../src/renderer/lib/routing';
import { DEMO_REGISTRY } from '../../src/main/brain/routing-demo';

it('shows only the three supported platforms in setup and account choices', () => {
  expect(engineInfos().map(e => e.id).sort()).toEqual(['claude', 'codex', 'cursor']);
  expect([...engines].sort()).toEqual(['claude', 'codex', 'cursor']);
  expect(engineOf('kimi')).toBeNull();
  expect(brainEngine('kimi', { kind: 'acp', label: 'Kimi', command: 'kimi' })).toMatch(/ignorata/);
});
it('drops retired switches and falls back from a retired Orchestrator engine', () => {
  const value = fromSaved({ engineOn: { kimi: true, claude: true }, engines: { kimi: true }, orchestratorChats: { harness: 'kimi' } });
  expect(value.engineOn.kimi).toBeUndefined(); expect(value.engines.kimi).toBeUndefined();
  expect(value.orchestratorChats.harness).toBe('claude');
});
it('preserves preferences but restarts engine choice for a retired guide', () => {
  const value = checkSetup({ step: 2, work: '', goals: 'Keep my goals', tools: '', style: 'balanced', agentIds: [], guide: { stage: 'guided', engine: 'kimi', chatId: 'old-chat' } });
  expect(value.guide).toEqual({ stage: 'choosing' }); expect(value.goals).toBe('Keep my goals');
});
it('does not reoffer retired routing models even when a saved row names them', () => {
  const old = { ...DEMO_REGISTRY.models[0]!, id: 'retired', harness: 'kimi' };
  expect(pickable({ ...DEMO_REGISTRY, models: [old] }, ['retired'])).toEqual([]);
});
