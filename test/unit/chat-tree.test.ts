// The delegation tree of the chats (renderer/lib/chat-tree.ts): roots in the Orchestrator's order, children right after
// their parent, a folded parent hides its whole subtree, closed chats leave; the fold is kept in the prefs across a
// restart (store/ui.ts loadPrefs); a child's open request shows in its ancestors' chat (lib/child-requests.ts).
import { describe, expect, it } from 'vitest';
import { chatTree, visibleTree } from '../../src/renderer/lib/chat-tree';
import { childRequestsFor, requestHost } from '../../src/renderer/lib/child-requests';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';

const c = (id: string, extra: Partial<ChatSummary> = {}) => ({ id, cwd: '/w/a', title: id, harness: 'claude', ...extra }) as ChatSummary;
const chats: Record<string, ChatSummary> = {
  r: c('r'), s1: c('s1', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1 } }),
  s2: c('s2', { parentId: 'r', delegation: { role: 'scout', goal: 'g', doneWhen: ['x'], at: 1, result: { outcome: 'done', summary: 's', at: 2 } } }),
  g: c('g', { parentId: 's1' }), other: c('other', { cwd: '/w/b' }), gone: c('gone', { closedAt: 5, parentId: 'r' }),
};

describe('chatTree', () => {
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
  it('the asker when its own chat is open, else its nearest open ancestor, else its own card; never the Orchestrator', () => {
    const all = ['o', 'r', 's', 'g'];
    const hosts = (view: ReturnType<typeof v>) => all.filter(id => requestHost('g', chats, view) === id);
    expect(hosts(v({}))).toEqual(['g']);
    expect(hosts(v({ r: true }))).toEqual(['r']);
    expect(hosts(v({ r: true, s: true }))).toEqual(['s']);
    expect(hosts(v({ r: true, s: true, g: true }))).toEqual(['g']);
    expect(hosts(v({ o: true }))).toEqual(['g']);
    // focus mode and a maximized chat: only that chat is on screen
    expect(hosts(v({ s: true }, 'r'))).toEqual(['r']);
    expect(hosts(v({ s: true }, null, 'chat:r'))).toEqual(['r']);
    expect(hosts(v({ s: true }, null, 'orchestrator'))).toEqual(['s']);
  });
});

