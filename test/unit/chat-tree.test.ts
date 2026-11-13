// The delegation tree of the chats (renderer/lib/chat-tree.ts): roots in the Orchestrator's order, children right after
// their parent, a folded parent hides its whole subtree, closed chats leave; the fold is kept in the prefs across a
// restart (store/ui.ts loadPrefs); a child's open request shows in its ancestors' chat (lib/child-requests.ts).
import { describe, expect, it } from 'vitest';
import { busyState, chatTree, childState, kidCounts, visibleTree } from '../../src/renderer/lib/chat-tree';
import { childRequestsFor, requestHost } from '../../src/renderer/lib/child-requests';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';

const c = (id: string, extra: Partial<ChatSummary> = {}) => ({ id, cwd: '/w/a', title: id, harness: 'claude', ...extra }) as ChatSummary;
const chats: Record<string, ChatSummary> = {
  r: c('r'), s1: c('s1', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1 } }),
  s2: c('s2', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1, result: { outcome: 'done', summary: 's', at: 2 } } }),
  g: c('g', { parentId: 's1' }), other: c('other', { cwd: '/w/b' }), gone: c('gone', { closedAt: 5, parentId: 'r' }),
};

describe('chatTree', () => {
  it('counts live background work after a turn ends, while preserving requests and final reports', () => {
    const child = c('child', { state: 'idle', pending: 0, background: 1 });
    expect(kidCounts([childState(child)])).toEqual({ run: 1, wait: 0, stuck: 0, done: 0 });
    expect(childState({ ...child, background: 0 })).toBe('stall');
    expect(childState({ ...child, background: 0, agentChildren: { coverage: 'complete', active: 1, total: 1, observedActive: 1, observedTotal: 1, observedAt: 1, children: [] } })).toBe('run');
    expect(childState({ ...child, background: 0, agentChildren: { coverage: 'partial', active: null, total: null, observedActive: 1, observedTotal: 1, observedAt: 1, children: [] } })).toBe('run');
    expect(childState({ ...child, pending: 1 })).toBe('wait');
    expect(childState({ ...child, state: 'error' })).toBe('err');
    expect(childState({ ...child, closedAt: 10 })).toBe('closed');
    // an engine that ended without a report is no closed chat (#354): the chat is open and still owes its result
    expect(childState({ ...child, background: 0, state: 'closed' })).toBe('stall');
    expect(childState({ ...child, delegation: chats.s2!.delegation })).toBe('done');
  });
  it('puts each child after its parent, depth first, and counts who still works', () => {
    const tree = chatTree(['r', 'other', 's1', 's2', 'g', 'gone'], chats);
    expect(tree.map(n => [n.id, n.depth])).toEqual([['r', 0], ['s1', 1], ['g', 2], ['s2', 1], ['other', 0]]);
    expect(tree[0]).toMatchObject({ children: ['s1', 's2'], working: 1 });
  });
  it('a folded parent hides its whole subtree; a child of a closed parent is a root', () => {
    const tree = chatTree(['r', 's1', 's2', 'g'], chats);
    expect(visibleTree(tree, { s1: true }).map(n => n.id)).toEqual(['r', 's1', 's2']);
    expect(visibleTree(tree, { r: true }).map(n => n.id)).toEqual(['r']);
    expect(chatTree(['s1', 'g'], { ...chats, r: c('r', { closedAt: 1 }) }).map(n => [n.id, n.depth])).toEqual([['s1', 0], ['g', 1]]);
  });
  it('the fold survives a restart (the saved prefs)', async () => {
    const { loadPrefs } = await import('../../src/renderer/store/ui');
    expect(loadPrefs(JSON.stringify({ treeCollapsed: { r: true, 'bad id!': true, x: 'no' } })).treeCollapsed).toEqual({ r: true });
  });
});

describe('childRequestsFor', () => {
  it('lists the open requests of the descendants, never the chat\'s own or a stranger\'s', () => {
    const p = (id: string, chatId: string) => ({ id, chatId, type: 'question', tool: 'AskUserQuestion', title: 't', detail: '', input: {}, at: 1 }) as PendingRequest;
    const out = childRequestsFor('r', chats, [p('a', 'r'), p('b', 's1'), p('c', 'g'), p('d', 'other')]);
    expect(out.map(x => x.req.id)).toEqual(['b', 'c']);
    expect(out[1]!.chat.id).toBe('g');
  });
});

describe('requestHost: each request renders once', () => {
  const chats = { o: { isOrchestrator: true }, r: { parentId: 'o', isOrchestrator: false }, s: { parentId: 'r', isOrchestrator: false }, g: { parentId: 's', isOrchestrator: false } } as const;
  const v = (expanded: Record<string, boolean>, focusMode: string | null = null, maximized: string | null = null) => ({ expanded, focusMode, maximized });
  it('only the Orchestrator hosts a deep descendant request, independently of the inspected view', () => {
    const all = ['o', 'r', 's', 'g'];
    const hosts = (view: ReturnType<typeof v>) => all.filter(id => requestHost('g', chats, view) === id);
    expect(hosts(v({}))).toEqual(['o']);
    expect(hosts(v({ r: true }))).toEqual(['o']);
    expect(hosts(v({ r: true, s: true }))).toEqual(['o']);
    expect(hosts(v({ r: true, s: true, g: true }))).toEqual(['o']);
    expect(hosts(v({ o: true }))).toEqual(['o']);
    // focus mode and a maximized chat: only that chat is on screen
    expect(hosts(v({ s: true }, 'r'))).toEqual(['o']);
    expect(hosts(v({ s: true }, null, 'chat:r'))).toEqual(['o']);
    expect(hosts(v({ s: true }, null, 'orchestrator'))).toEqual(['o']);
  });
  it('does not assign a hidden expanded descendant as host, but respects explicit focus', () => {
    const folded = { ...v({ r: true, s: true, g: true }), treeCollapsed: { s: true } };
    expect(requestHost('g', chats, folded)).toBe('o');
    expect(requestHost('g', chats, { ...folded, treeCollapsed: { r: true } })).toBe('o');
    expect(requestHost('g', chats, { ...folded, focusMode: 'g' })).toBe('o');
  });

});

describe('closed chats and the sidebar (#354)', () => {
  it('an archived chat leaves the tree, a reopened one comes back at its place', () => {
    const all = { a: c('a'), b: c('b', { closedAt: 7 }), d: c('d') };
    expect(chatTree(['a', 'b', 'd'], all).map(n => n.id)).toEqual(['a', 'd']);
    expect(chatTree(['a', 'b', 'd'], { ...all, b: c('b') }).map(n => n.id)).toEqual(['a', 'b', 'd']);
  });
});


describe('the sidebar dot of an idle chat still busy (the owner, 2026-11-10)', () => {
  it('is the busy one while an Esegui command, a background task, a subagent or a delegated chat runs', () => {
    expect(busyState('done', c('a'), false, 0)).toBe('done');
    expect(busyState('done', c('a'), true, 0)).toBe('run');
    expect(busyState('done', c('a'), false, 1)).toBe('run');
    expect(busyState('done', c('a', { background: 1 }), false, 0)).toBe('run');
    expect(busyState('done', c('a', { agentChildren: { coverage: 'partial', active: null, total: null, observedActive: 2, observedTotal: 2, observedAt: 1, children: [] } }), false, 0)).toBe('run');
    expect(busyState('stall', c('a', { delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1 } }), true, 0)).toBe('run');
    expect(busyState('queued', c('a', { background: 1 }), false, 0)).toBe('run');
    expect(busyState('done', c('a', { delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1, result: { outcome: 'done', summary: 's', at: 2 } } }), true, 0)).toBe('run');
    // waiting for the user and an error keep their own dot
    expect(busyState('wait', c('a'), true, 1)).toBe('wait');
    expect(busyState('err', c('a'), true, 0)).toBe('err');
  });
});
