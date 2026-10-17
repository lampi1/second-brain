import { describe, expect, it } from 'vitest';
import { codexChildren } from '../../../src/main/chats/codex-children';
import { AgentChildrenReducer } from '../../../src/main/chats/agent-children';

describe('Codex observed provider children', () => {
  it('uses native thread ids and spawn parent, never tool completion as child completion', () => {
    const rows = codexChildren({ type: 'collabAgentToolCall', id: 'call', tool: 'spawnAgent', senderThreadId: 'parent', receiverThreadIds: ['child', 'child'], status: 'completed', agentsStates: { child: { status: 'running' } }, prompt: 'Review changes' }, 'live', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nativeId: 'child', parentNativeId: 'parent', toolCallId: 'call', state: 'running' });
    expect(codexChildren({ type: 'collabAgentToolCall', id: 'call', tool: 'spawnAgent', receiverThreadIds: ['unknown'], status: 'completed', agentsStates: {} }, 'live', 11)[0]?.state).toBe('unknown');
  });
  it('keeps historical rows from reviving completed children and never fabricates a census', () => {
    const reducer = new AgentChildrenReducer(); reducer.coverage('partial');
    for (const row of codexChildren({ type: 'subAgentActivity', id: 'event', agentThreadId: 'child', kind: 'completed' }, 'live', 20)) reducer.observe(row);
    for (const row of codexChildren({ type: 'subAgentActivity', id: 'old', agentThreadId: 'child', kind: 'started' }, 'replay', 30)) reducer.observe(row);
    expect(reducer.snapshot()).toMatchObject({ active: null, total: null, observedActive: 0, observedTotal: 1 });
    expect(reducer.snapshot().children[0]?.state).toBe('completed');
  });
  it('ignores generic tools and malformed ids; interaction alone does not prove working state', () => {
    expect(codexChildren({ type: 'commandExecution', id: 'tool' }, 'live', 0)).toEqual([]);
    expect(codexChildren({ type: 'subAgentActivity', id: 'tool' }, 'live', 0)).toEqual([]);
    expect(codexChildren({ type: 'subAgentActivity', id: 'tool', agentThreadId: 'child', kind: 'interacted' }, 'live', 0)[0]).toMatchObject({ state: 'unknown', parentNativeId: null });
  });
});
