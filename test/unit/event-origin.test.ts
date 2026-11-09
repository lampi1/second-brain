// Memory producer integration: provider snapshots survive file parsing without retrospective attribution.
import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { normalizeEventOrigin } from '../../src/shared/event-origin';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const observed = { agentId: 'agent-a', sessionId: 'session-a', turnId: 'turn-a', engine: 'codex', modelObserved: 'observed-model', source: 'chat-provider-event', at: 1234 };

it('accepts only explicit event snapshots and keeps human separate', () => {
  expect(normalizeEventOrigin(JSON.stringify(observed))).toEqual({ kind: 'model', ...observed });
  expect(normalizeEventOrigin({ kind: 'human' })).toEqual({ kind: 'human' });
  for (const value of [undefined, '', '{}', { model: 'selected-profile' }, { ...observed, source: null }, { ...observed, at: Infinity }, { ...observed, modelObserved: null }]) expect(normalizeEventOrigin(value)).toBeUndefined();
});
