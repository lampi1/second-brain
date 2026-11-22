// The user's own model pick for one run (src/main/agents/discovery.ts userModelOf, ADR 0296; the thinking-level suffix
// of ADR 0332): an exact id or name, the engine found from the lists, an unknown id refused, and Antigravity's own ids
// (gemini-4-neon-high, as `agy models` prints them) taken as the bare listed model with that effort.
import { describe, expect, it } from 'vitest';
import type { AgentModelChoice } from '../../../src/shared/agents';
import { userModelOf } from '../../../src/main/agents/discovery';

const choice = (engine: string, models: AgentModelChoice['models']): AgentModelChoice =>
  ({ engine, label: engine, enabled: true, trusted: true, effort: true, models, source: 'observed' } as AgentModelChoice);
const MODELS = [
  choice('claude', [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }]),
  choice('antigravity', [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)', efforts: [] }, { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }]),
];

describe('userModelOf', () => {
  it('takes an exact id or name and finds its engine', () => {
    expect(userModelOf({ model: 'claude-opus-5-5' }, MODELS, 'claude')).toEqual({ engine: 'claude', model: 'claude-opus-5-5' });
    expect(userModelOf({ model: 'Gemini 4 Neon', effort: 'high' }, MODELS, 'claude')).toEqual({ engine: 'antigravity', model: 'gemini-4-neon', effort: 'high' });
  });

  it('reads an id with a thinking-level suffix as the bare model with that effort', () => {
    expect(userModelOf({ engine: 'antigravity', model: 'gemini-4-neon-high' }, MODELS, 'claude')).toEqual({ engine: 'antigravity', model: 'gemini-4-neon', effort: 'high' });
    expect(userModelOf({ model: 'gemini-4-neon-xhigh', effort: 'xhigh' }, MODELS, 'claude')).toEqual({ engine: 'antigravity', model: 'gemini-4-neon', effort: 'xhigh' });
    // efforts unknown (a list read from a chat's session): the suffix is taken
    expect(userModelOf({ model: 'gemini-3.8-flash-low' }, MODELS, 'claude')).toEqual({ engine: 'antigravity', model: 'gemini-3.8-flash', effort: 'low' });
  });

  it('refuses a suffix the model does not take, a contradicting effort and an unknown model', () => {
    expect(() => userModelOf({ model: 'gemini-4-neon-max' }, MODELS, 'claude')).toThrow(/not in any engine/);
    expect(() => userModelOf({ model: 'gemini-pro-orchestrator-neon-high' }, MODELS, 'claude')).toThrow(/not in any engine/);
    expect(() => userModelOf({ model: 'gemini-4-neon-high', effort: 'low' }, MODELS, 'claude')).toThrow(/contradicts/);
    expect(() => userModelOf({ engine: 'claude', model: 'gemini-4-neon-high' }, MODELS, 'claude')).toThrow(/claude's model list/);
    expect(() => userModelOf({ model: 'gemini-9' }, MODELS, 'claude')).toThrow(/not in any engine/);
  });
});
