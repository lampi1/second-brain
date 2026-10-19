// Child-strip selection: never hide unresolved activity; ended children leave at once; original start times kept.
import { describe, expect, it } from 'vitest';
import type { ChildObservation } from '../../src/shared/agents';
import { AgentChildrenReducer } from '../../src/main/chats/agent-children';
import { childAgent, childRows, childTone, waitsOnChildren } from '../../src/renderer/lib/agent-children';
import { stateInfo } from '../../src/renderer/lib/format';

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
  it('keeps the engine agent type across updates and matches it to an app agent by id or name (#69)', () => {
    const state = new AgentChildrenReducer();
    state.observe({ ...row('a', 'running', 10), toolCallId: 't1', nativeId: null, agentType: 'indagine' });
    state.observe({ ...row('native', 'running', 20), toolCallId: 't1', nativeId: 'n1' }); // a later event without the type
    const [shown] = childRows(state.snapshot()).rows;
    expect(shown!.agentType).toBe('indagine');
    const profiles = [{ id: 'indagine', name: 'Indagine' }, { id: 'ops', name: 'Lettura operativa' }];
    expect(childAgent('indagine', profiles)?.name).toBe('Indagine');
    expect(childAgent('  Lettura   Operativa ', profiles)?.id).toBe('ops');
    expect(childAgent('general-purpose', profiles)).toBeNull();
    expect(childAgent(null, profiles)).toBeNull();
    expect(childAgent('indagine', undefined)).toBeNull();
    // a control character or an over-long type is not kept
    const odd = new AgentChildrenReducer();
    odd.observe({ ...row('x', 'running', 10), agentType: 'bad\u0007type' });
    odd.observe({ ...row('y', 'running', 10), agentType: 'a'.repeat(121) });
    expect(odd.snapshot().children.map(c => c.agentType)).toEqual([undefined, undefined]);
  });
  it('a parent whose turn is over reads "in attesa" while a sub-agent works, "finito" once none does (#69)', () => {
    const children = (states: ChildObservation['state'][], kind: ChildObservation['kind'] = 'agent') => {
      const r = new AgentChildrenReducer();
      states.forEach((s, i) => r.observe({ ...row(`c${i}`, s, 10), kind }));
      return r.snapshot();
    };
    const idle = { state: 'idle' as const, pending: 0, isOrchestrator: false };
    expect(waitsOnChildren(children(['running', 'completed']))).toBe(true);
    expect(stateInfo({ ...idle, agentChildren: children(['running']) })).toEqual({ label: 'in attesa', tone: 'run' });
    expect(stateInfo({ ...idle, agentChildren: children(['waiting']) }).label).toBe('in attesa');
    expect(stateInfo({ ...idle, agentChildren: children(['completed', 'failed']) }).label).toBe('finito');
    expect(stateInfo({ ...idle, agentChildren: children(['running'], 'shell') }).label).toBe('finito'); // a command is not a sub-agent
    expect(stateInfo(idle).label).toBe('finito');
    // a turn still running or waiting on the user keeps its own state
    expect(stateInfo({ ...idle, state: 'running', agentChildren: children(['running']) }).label).toBe('al lavoro');
    expect(stateInfo({ ...idle, pending: 1, agentChildren: children(['running']) }).label).toBe('ti aspetta');
  });
});
