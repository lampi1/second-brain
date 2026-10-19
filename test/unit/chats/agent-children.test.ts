// Child telemetry: deduplication and honest coverage, plus actual Claude/ACP parser events without a live CLI.
// Replays and process exits must not invent completed children or a zero census; hooks are optional consumers only.
import { describe, expect, it } from 'vitest';
import type { ChildObservation } from '../../../src/shared/agents';
import { AgentChildrenReducer, sanitizeAgentChildren, sanitizeChildObservation } from '../../../src/main/chats/agent-children';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { AcpSession } from '../../../src/main/chats/acp';
import { BufferedSink } from '../../../src/main/chats/warm';
import { recSink, type RecSink } from './helpers';

const observation = (patch: Partial<ChildObservation> = {}): ChildObservation => ({
  key: 'agent:one', nativeId: 'one', toolCallId: null, parentNativeId: null, kind: 'agent', state: 'running',
  task: 'Review the change', observedAt: 10, source: 'live', ...patch,
});
const line = (session: { line(raw: string): void }, message: unknown): void => session.line(JSON.stringify(message));
function recording(initial?: unknown): { sink: RecSink; state: AgentChildrenReducer; events: ChildObservation[] } {
  const sink = recSink(), state = new AgentChildrenReducer(initial), events: ChildObservation[] = [];
  sink.children = row => { events.push(row); state.observe(row); };
  sink.childrenCoverage = coverage => { state.coverage(coverage); };
  return { sink, state, events };
}

describe('child observation reducer', () => {
  it('preserves the first observation through native correlation, completion and restore', () => {
    const state = new AgentChildrenReducer();
    state.observe(observation({ nativeId: null, toolCallId: 'spawn', observedAt: 10 }));
    state.observe(observation({ key: 'native', toolCallId: 'spawn', observedAt: 20 }));
    state.observe(observation({ key: 'native', toolCallId: 'spawn', state: 'completed', observedAt: 30 }));
    expect(new AgentChildrenReducer(state.snapshot()).snapshot().children[0]).toMatchObject({ startedAt: 10, observedAt: 30, state: 'completed' });
    expect(sanitizeChildObservation(observation({ startedAt: 50 }))?.startedAt).toBe(10);
    expect(sanitizeChildObservation(observation({ observedAt: Number.MAX_VALUE }))).toBeNull();
  });
  it('keeps observed agents separate from shell work and from an unavailable census', () => {
    const state = new AgentChildrenReducer();
    state.coverage('partial', 1);
    state.observe(observation());
    state.observe(observation({ key: 'shell:one', nativeId: 'shell', kind: 'shell' }));
    state.observe(observation({ key: 'unknown:one', nativeId: null, kind: 'unknown' }));
    expect(state.snapshot()).toMatchObject({ coverage: 'partial', active: null, total: null, observedActive: 1, observedTotal: 1 });
    const api = new AgentChildrenReducer();
    api.coverage('complete', 1); // only an adapter with an actual no-child capability/census may do this
    expect(api.snapshot()).toMatchObject({ active: 0, total: 0 });
  });
  it('is idempotent, scopes rows to a reducer and joins a tool correlation to its later native id', () => {
    const state = new AgentChildrenReducer();
    const tool = observation({ key: 'tool:spawn', nativeId: null, toolCallId: 'spawn' });
    expect(state.observe(tool)).toBe(true);
    expect(state.observe(tool)).toBe(false);
    state.observe(observation({ key: 'native:one', toolCallId: 'spawn', observedAt: 11 }));
    expect(state.snapshot().children).toHaveLength(1);
    expect(state.snapshot().children[0]).toMatchObject({ key: 'tool:spawn', nativeId: 'one', toolCallId: 'spawn' });
    state.observe(observation({ key: 'native:two', nativeId: 'two', toolCallId: 'spawn', observedAt: 12 }));
    expect(state.snapshot().observedTotal).toBe(2); // one tool may spawn several native agents
    expect(new AgentChildrenReducer().snapshot().observedTotal).toBe(0);
  });
  it('ignores stale events and historical replay, but permits a later live resumption of the same child', () => {
    const state = new AgentChildrenReducer();
    state.observe(observation({ state: 'completed', observedAt: 20 }));
    state.observe(observation({ observedAt: 19 }));
    state.observe(observation({ source: 'replay', observedAt: 30 }));
    expect(state.snapshot().children[0]?.state).toBe('completed');
    state.observe(observation({ observedAt: 31 }));
    expect(state.snapshot()).toMatchObject({ observedActive: 1, observedTotal: 1 });
    state.observe(observation({ state: 'failed', source: 'replay', observedAt: 32 }));
    expect(state.snapshot().children[0]?.state).toBe('running');
  });
  it('marks unresolved children unknown on exit and never revives ghost activity afterward', () => {
    const state = new AgentChildrenReducer();
    state.coverage('partial', 1);
    state.observe(observation());
    state.observe(observation({ key: 'done', nativeId: 'done', state: 'completed' }));
    state.end(50);
    expect(state.snapshot()).toMatchObject({ coverage: 'unknown', active: null, total: null, observedActive: 0, observedTotal: 2 });
    expect(state.snapshot().children.map(row => row.state)).toEqual(['unknown', 'completed']);
    expect(state.observe(observation({ observedAt: 51 }))).toBe(false);
    const resumed = new AgentChildrenReducer(state.snapshot());
    expect(resumed.observe(observation({ observedAt: 52 }))).toBe(true);
  });
  it('sanitizes persisted data and recomputes counts without sharing mutable references', () => {
    expect(sanitizeChildObservation({ ...observation(), observedAt: NaN })).toBeNull();
    expect(sanitizeChildObservation(observation({ key: 'a'.repeat(513) }))).toBeNull();
    expect(sanitizeChildObservation(observation({ nativeId: 'not\u0000an-id' }))?.nativeId).toBeNull();
    expect(sanitizeAgentChildren({ coverage: 'complete', active: 99, total: 99 })).toMatchObject({ coverage: 'unknown', active: null, total: null });
    const raw = { coverage: 'partial', children: [observation()], active: 99, total: 99 };
    const snapshot = sanitizeAgentChildren(raw);
    expect(snapshot).toMatchObject({ active: null, total: null, observedActive: 1, observedTotal: 1 });
    const state = new AgentChildrenReducer(snapshot);
    snapshot.children[0]!.state = 'failed';
    state.snapshot().children[0]!.state = 'stopped';
    expect(state.snapshot().children[0]?.state).toBe('running');
    expect(sanitizeChildObservation(observation({ task: '\u001b[31mReview\u0000the change' }))?.task).toBe('Review the change');
  });
  it('keeps the newest 20 finished commands, so hundreds of them never crowd out a later sub-agent', () => {
    const state = new AgentChildrenReducer();
    state.coverage('partial', 1);
    const shell = (i: number, patch: Partial<ChildObservation> = {}) =>
      observation({ key: `shell:${i}`, nativeId: `cmd${i}`, kind: 'shell', state: 'completed', observedAt: 100 + i, ...patch });
    state.observe(shell(-1, { state: 'running' }));
    for (let i = 0; i < 600; i++) state.observe(shell(i));
    expect(state.observe(observation({ key: 'agent:late', nativeId: 'late', observedAt: 1000 }))).toBe(true);
    const keys = state.snapshot().children.map(row => row.key);
    expect(keys).toContain('agent:late');
    expect(keys).toContain('shell:-1'); // a running command is never pruned
    expect(keys.filter(key => key.startsWith('shell:') && key !== 'shell:-1')).toEqual(Array.from({ length: 20 }, (_, i) => `shell:${580 + i}`));
    expect(state.snapshot().coverage).toBe('partial'); // dropping finished commands loses no agent
  });
  it('when full, drops the oldest finished agent with an unknown census, and refuses only when every row is unfinished', () => {
    const full = (finished: number) => {
      const state = new AgentChildrenReducer();
      state.coverage('complete', 1);
      for (let i = 0; i < 500; i++) state.observe(observation({ key: `agent:${i}`, nativeId: `a${i}`, state: i === finished ? 'completed' : 'running', observedAt: 10 + i }));
      return state;
    };
    const room = full(7);
    expect(room.observe(observation({ key: 'agent:new', nativeId: 'new', observedAt: 900 }))).toBe(true);
    const keys = room.snapshot().children.map(row => row.key);
    expect(keys).toContain('agent:new');
    expect(keys).not.toContain('agent:7');
    expect(room.snapshot()).toMatchObject({ coverage: 'unknown', total: null, observedTotal: 500 });
    const busy = full(-1);
    expect(busy.observe(observation({ key: 'agent:new', nativeId: 'new', observedAt: 900 }))).toBe(false);
    expect(busy.snapshot()).toMatchObject({ coverage: 'unknown', observedTotal: 500 });
  });
});

describe('provider child observations', () => {
  it('observes nested Claude Agent tools without leaking their transcript into the parent chat', async () => {
    const { sink, state } = recording();
    const session = new ClaudeSession({ chatId: 'parent', cwd: '.' }, sink);
    line(session, { type: 'assistant', parent_tool_use_id: 'outer', message: { id: 'nested', content: [{ type: 'tool_use', id: 'inner', name: 'Task', input: { description: 'Nested review', run_in_background: false } }] } });
    expect(state.snapshot().children[0]).toMatchObject({ task: 'Nested review', state: 'running' });
    line(session, { type: 'user', parent_tool_use_id: 'outer', message: { content: [{ type: 'tool_result', tool_use_id: 'inner', content: 'Finished' }] } });
    expect(state.snapshot().children[0]?.state).toBe('completed');
    expect(sink.items.size).toBe(0);
    await session.close();
  });
  it('keeps a Claude background launch running after acknowledgment and retains its final state', async () => {
    const { sink, state } = recording();
    const session = new ClaudeSession({ chatId: 'parent', cwd: '.' }, sink);
    line(session, { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: { description: 'Review', run_in_background: true, subagent_type: 'indagine' } }] } });
    line(session, { type: 'system', subtype: 'task_started', task_id: 'native', tool_use_id: 'spawn', task_type: 'local_agent', description: 'Review' });
    expect(state.snapshot().children[0]).toMatchObject({ nativeId: 'native', agentType: 'indagine' }); // the agent it runs as (#69)
    const startedAt = state.snapshot().children[0]?.startedAt;
    line(session, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'spawn', content: 'Async agent launched successfully.' }] } });
    expect(state.snapshot().children).toHaveLength(1);
    expect(state.snapshot().children[0]?.state).toBe('running');
    line(session, { type: 'system', subtype: 'task_notification', task_id: 'native', status: 'failed' });
    expect(state.snapshot().children[0]).toMatchObject({ state: 'failed', startedAt });
    await session.close();
    expect(state.snapshot().children[0]?.state).toBe('failed');
  });
  it('settles a rejected Claude background Agent tool instead of leaving a running ghost', async () => {
    const { sink, state } = recording();
    const session = new ClaudeSession({ chatId: 'parent', cwd: '.' }, sink);
    line(session, { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: { description: 'Review', run_in_background: true } }] } });
    line(session, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'spawn', is_error: true, content: 'Launch failed' }] } });
    expect(state.snapshot().children[0]?.state).toBe('failed');
    await session.close();
  });
  it('extracts Claude agent/shell lifecycle, tool identity and SendMessage resumption', async () => {
    const { sink, state } = recording();
    const session = new ClaudeSession({ chatId: 'parent', cwd: '.', sessionId: 'parent-session' }, sink);
    const system = (fields: Record<string, unknown>) => line(session, { type: 'system', ...fields });
    line(session, { type: 'assistant', parent_tool_use_id: null, message: { id: 'm', content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: { description: 'Review', run_in_background: true } }] } });
    system({ subtype: 'task_started', task_id: 'native', tool_use_id: 'spawn', task_type: 'local_agent', description: 'Review' });
    system({ subtype: 'task_started', task_id: 'shell', tool_use_id: 'bash', task_type: 'local_bash', description: 'npm test' });
    expect(state.snapshot()).toMatchObject({ coverage: 'partial', active: null, total: null, observedActive: 1, observedTotal: 1 });
    expect(state.snapshot().children.find(row => row.nativeId === 'native')).toMatchObject({ toolCallId: 'spawn', parentNativeId: null });
    system({ subtype: 'task_notification', task_id: 'native', status: 'completed' });
    line(session, { type: 'assistant', parent_tool_use_id: null, message: { id: 'send', content: [{ type: 'tool_use', id: 'resume', name: 'SendMessage', input: { to: 'native' } }] } });
    line(session, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'resume', content: 'resumed' }] }, tool_use_result: { success: true, resumedAgentId: 'native' } });
    expect(state.snapshot()).toMatchObject({ observedActive: 1, observedTotal: 1 });
    system({ subtype: 'task_updated', task_id: 'native', patch: { status: 'paused' } });
    expect(state.snapshot().children.find(row => row.nativeId === 'native')?.state).toBe('waiting');
    await session.close();
    expect(state.snapshot()).toMatchObject({ coverage: 'unknown', observedActive: 0 });
    expect(state.snapshot().children.find(row => row.nativeId === 'native')?.state).toBe('unknown');
  });
  it('collects ACP task metadata without hooks and does not count ordinary shell tools as agents', async () => {
    const { sink, state } = recording();
    const session = new AcpSession({ engineId: 'cursor', label: 'Cursor', args: [], chatId: 'parent', cwd: '.', subagentHooks: false }, sink);
    const update = (u: Record<string, unknown>) => line(session, { method: 'session/update', params: { update: u } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'agent', status: 'pending', kind: 'other', rawInput: { _toolName: 'task', description: 'Review', subagentType: 'reviewer' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'shell', status: 'in_progress', kind: 'execute', rawInput: { _toolName: 'shell', command: 'npm test' } });
    line(session, { method: 'cursor/task', params: { toolCallId: 'agent', description: 'Review the change', model: 'model' } });
    expect(state.snapshot()).toMatchObject({ coverage: 'partial', active: null, total: null, observedActive: 1, observedTotal: 1 });
    expect(state.snapshot().children[0]).toMatchObject({ nativeId: null, parentNativeId: null, toolCallId: 'agent', task: 'Review the change', state: 'waiting', agentType: 'reviewer' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'agent', status: 'completed' });
    await session.close();
    expect(state.snapshot()).toMatchObject({ coverage: 'unknown', observedActive: 0 });
    expect(state.snapshot().children[0]?.state).toBe('completed');
  });
  it('extracts hidden ACP replay without reactivating a settled live task', async () => {
    const { sink, state } = recording();
    const session = new AcpSession({ engineId: 'cursor', label: 'Cursor', args: [], chatId: 'parent', cwd: '.', showReplay: false }, sink);
    const update = (status: string) => line(session, { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'agent', status, rawInput: { _toolName: 'task', description: 'Review' } } } });
    update('completed');
    (session as unknown as { loading: boolean }).loading = true;
    update('in_progress');
    (session as unknown as { loading: boolean }).loading = false;
    line(session, { method: 'cursor/task', params: { toolCallId: 'agent', description: 'Metadata only' } });
    expect(state.snapshot().children[0]?.state).toBe('completed');
    await session.close();
    const replay = recording();
    const loaded = new AcpSession({ engineId: 'cursor', label: 'Cursor', args: [], chatId: 'restored', cwd: '.', showReplay: false }, replay.sink);
    (loaded as unknown as { loading: boolean }).loading = true;
    line(loaded, { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'historical', status: 'completed', rawInput: { _toolName: 'task', description: 'Historical review' } } } });
    expect(replay.state.snapshot().children[0]).toMatchObject({ source: 'replay', state: 'completed' });
    expect(replay.sink.items.size).toBe(0);
    await loaded.close();
  });
  it('buffers child observations and coverage until a warm session is adopted', () => {
    const buffered = new BufferedSink();
    buffered.childrenCoverage('partial');
    buffered.children(observation());
    const { sink, state, events } = recording();
    buffered.attach(sink);
    expect(events).toHaveLength(1);
    expect(state.snapshot()).toMatchObject({ coverage: 'partial', observedActive: 1 });
    buffered.children(observation({ state: 'completed', observedAt: 11 }));
    expect(state.snapshot().observedActive).toBe(0);
  });
  it('does not revive persisted terminal ACP evidence through live descriptive metadata after replay', async () => {
    const initial = { coverage: 'unknown', children: [observation({ key: 'acp:tool:agent', nativeId: null, toolCallId: 'agent', state: 'completed', observedAt: 1 })] };
    const { sink, state } = recording(initial);
    const session = new AcpSession({ engineId: 'cursor', label: 'Cursor', args: [], chatId: 'parent', cwd: '.', showReplay: false }, sink);
    (session as unknown as { loading: boolean }).loading = true;
    line(session, { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'agent', status: 'in_progress', rawInput: { _toolName: 'task', description: 'Old launch' } } } });
    (session as unknown as { loading: boolean }).loading = false;
    line(session, { method: 'cursor/task', params: { toolCallId: 'agent', description: 'Historical metadata' } });
    expect(state.snapshot().children[0]?.state).toBe('completed');
    expect(state.snapshot().observedActive).toBe(0);
    await session.close();
  });
});
