// Child-strip selection: never hide unresolved activity; retain terminal evidence and original start times.
import { describe, expect, it } from 'vitest';
import type { ChildObservation } from '../../src/shared/agents';
import { AgentChildrenReducer } from '../../src/main/chats/agent-children';
import { childRows, childTone } from '../../src/renderer/lib/agent-children';

const row = (key: string, state: ChildObservation['state'], at: number): ChildObservation => ({
  key, nativeId: key, toolCallId: null, parentNativeId: null, kind: 'agent', state, task: key,
  observedAt: at, startedAt: 1, source: 'live',
});
describe('child strip selection', () => {
  it('shows every running, waiting and unresolved row, with older terminal rows accessible', () => {
    const state = new AgentChildrenReducer();
    for (let i = 0; i < 7; i++) state.observe(row(`done-${i}`, 'completed', 10 + i));
    for (const status of ['running', 'waiting', 'unknown'] as const) for (let i = 0; i < 6; i++) state.observe(row(`${status}-${i}`, status, 20));
    const folded = childRows(state.snapshot());
    expect(folded.rows).toHaveLength(21);
    expect(folded.hiddenEnded).toBe(4);
    expect(folded.rows.filter(r => r.state === 'unknown')).toHaveLength(6);
    expect(folded.rows.filter(r => r.state === 'completed').map(r => r.key)).toEqual(['done-4', 'done-5', 'done-6']);
    expect(childRows(state.snapshot(), true).rows).toHaveLength(25);
    expect(childRows(undefined).rows).toEqual([]);
  });
  it('falls back to observation time for old saved rows and gives all states an explicit tone', () => {
    const state = new AgentChildrenReducer();
    state.observe({ ...row('old', 'stopped', 40), startedAt: undefined });
    expect(childRows(state.snapshot()).rows[0]).toMatchObject({ startedAt: 40, active: false });
    expect(['running', 'waiting', 'completed', 'failed', 'stopped', 'unknown'].map(s => childTone(s as ChildObservation['state']))).toEqual(['run', 'wait', 'done', 'err', 'off', 'off']);
  });
});
