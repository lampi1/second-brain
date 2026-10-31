// Retirement regressions: saved settings/setup remain readable and unsupported engines leave UI choices.
import { expect, it } from 'vitest';
import { fromSaved } from '../../src/main/brain/config';
import { checkSetup } from '../../src/main/agents/setup';
import { brainEngine, engineInfos, engineOf } from '../../src/main/engines/registry';
import { engines } from '../../src/modules/ai-first/model';

it('shows the supported engines in Settings (OpenCode too, ADR 0216) and only the three main ones in setup', () => {
  expect(engineInfos().map(e => e.id).sort()).toEqual(['claude', 'codex', 'cursor', 'opencode']);
  expect(engineOf('opencode')).toMatchObject({ kind: 'acp', command: 'opencode', args: ['acp'], login: ['auth', 'login'], defaultOn: false, modelOption: true, trusted: true });
  expect(brainEngine('opencode', { kind: 'acp', label: 'Altro', command: 'evil' })).toMatch(/incorporato/);
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
