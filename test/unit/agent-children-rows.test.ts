// Child-strip selection: never hide unresolved activity; ended children leave at once; original start times kept.
import { describe, expect, it } from 'vitest';
import type { ChildObservation } from '../../src/shared/agents';
import { AgentChildrenReducer } from '../../src/main/chats/agent-children';
import { childRows, childTone } from '../../src/renderer/lib/agent-children';

const row = (key: string, state: ChildObservation['state'], at: number): ChildObservation => ({
  key, nativeId: key, toolCallId: null, parentNativeId: null, kind: 'agent', state, task: key,
  observedAt: at, startedAt: 1, source: 'live',
});
describe('child strip selection', () => {
  it('shows every running, waiting and unresolved row and drops the ended ones', () => {
    const state = new AgentChildrenReducer();
    for (let i = 0; i < 7; i++) state.observe(row(`done-${i}`, 'completed', 10 + i));
    for (const status of ['running', 'waiting', 'unknown'] as const) for (let i = 0; i < 6; i++) state.observe(row(`${status}-${i}`, status, 20));
    const shown = childRows(state.snapshot());
    expect(shown.rows).toHaveLength(18);
    expect(shown.ended).toBe(7);
    expect(shown.rows.filter(r => r.state === 'unknown')).toHaveLength(6);
    expect(shown.rows.filter(r => r.state === 'completed')).toEqual([]);
    expect(childRows(undefined).rows).toEqual([]);
  });
  it('falls back to observation time for old saved rows and gives all states an explicit tone', () => {
    const state = new AgentChildrenReducer();
    state.observe({ ...row('old', 'unknown', 40), startedAt: undefined });
    expect(childRows(state.snapshot()).rows[0]).toMatchObject({ startedAt: 40, active: false });
    expect(['running', 'waiting', 'completed', 'failed', 'stopped', 'unknown'].map(s => childTone(s as ChildObservation['state']))).toEqual(['run', 'wait', 'done', 'err', 'off', 'off']);
  });
});
