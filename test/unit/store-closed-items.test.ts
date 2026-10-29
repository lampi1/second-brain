// Unit tests of how the renderer store holds closed chats' transcripts (src/renderer/store/state.ts, store.ts; "va a
// scatti a fine giornata", 2026-10-29): a chat that closes lets go of its items, the start loads only the open chats',
// a reopen (Riapri, an agent, «Annulla») gets them back, the ✕ close keeps them while its «Annulla» is on screen, a
// closed chat's late item does not pass for its transcript, and a chat that leaves the app purges what modules kept for it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary } from '@shared/contract';
import { initialState, reduce } from '../../src/renderer/store/state';

const handlers = new Map<string, (p: unknown) => void>();
const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({
  sb: { invoke: (...a: unknown[]) => invoke(...a), on: (ch: string, fn: (p: unknown) => void) => { handlers.set(ch, fn); return () => {}; } },
}));

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const msg = (id: string): ChatItem => ({ kind: 'assistant', id, at: 1, text: id, streaming: false });
const flush = () => new Promise(r => setTimeout(r, 0));

const { app, dispatch, startStore, closeChat, onChatRemoved, answer, attemptOf } = await import('../../src/renderer/store/store');
const { ui } = await import('../../src/renderer/store/ui');

describe('reducer: closed chats let go of their items', () => {
  const open = reduce(reduce(reduce(initialState, { type: 'init', chats: [chat('a')], pending: [], tabs: [], feed: [], usage: null, info: null }),
    { type: 'items', chatId: 'a', items: [msg('m1')] }), { type: 'chat:updated', chat: chat('a', { updatedAt: 2 }) });

  it('drops them when the chat closes, keeps them with keep (an undoable close)', () => {
    expect(open.items.a).toHaveLength(1);
    const closed = reduce(open, { type: 'chat:updated', chat: chat('a', { closedAt: 5, state: 'closed' }) });
    expect(closed.items.a).toBeUndefined();
    expect(closed.chats.a?.closedAt).toBe(5);
    expect(reduce(open, { type: 'chat:updated', chat: chat('a', { closedAt: 5 }), keep: true }).items.a).toHaveLength(1);
  });

  it('keeps items loaded on demand for a chat already closed (no reload loop on its next update)', () => {
    let s = reduce(open, { type: 'chat:updated', chat: chat('a', { closedAt: 5 }) });
    s = reduce(s, { type: 'items', chatId: 'a', items: [msg('m1')] });
    s = reduce(s, { type: 'chat:updated', chat: chat('a', { closedAt: 5, costUsd: 1 }) });
    expect(s.items.a).toHaveLength(1);
  });

  it('a closed chat with no items held ignores a late item (one item would pass for the whole transcript)', () => {
    const closed = reduce(open, { type: 'chat:updated', chat: chat('a', { closedAt: 5 }) });
    expect(reduce(closed, { type: 'chat:item', chatId: 'a', item: msg('m2') })).toBe(closed);
    const unknown = reduce(closed, { type: 'chat:item', chatId: 'new', item: msg('n1') });
    expect(unknown.items.new).toHaveLength(1); // a chat not known yet still collects its items
  });
});

describe('store: loads and reopens', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((ch: string, a?: { chatId?: string }) => Promise.resolve(
      ch === 'chat:list' ? [chat('a'), chat('b', { closedAt: 3, state: 'closed' })]
        : ch === 'chat:items' ? [msg(`${a?.chatId}-1`)]
          : ch === 'chat:archive' ? chat(a!.chatId!, { closedAt: 9, state: 'closed' })
            : ch === 'chat:reopen' ? chat(a!.chatId!, { state: 'idle' })
              : ch.endsWith(':list') || ch === 'chat:pending' || ch === 'chat:autoCloseGet' ? [] : null));
  });

  it('starts by loading only the open chats\' items', async () => {
    startStore();
    await vi.waitFor(() => expect(app.get().ready).toBe(true));
    await flush();
    const loads = invoke.mock.calls.filter(c => c[0] === 'chat:items').map(c => (c[1] as { chatId: string }).chatId);
    expect(loads).toEqual(['a']);
    expect(app.get().items.b).toBeUndefined();
  });

  it('a reopened chat loads its items again', async () => {
    dispatch({ type: 'chat:updated', chat: chat('c') });
    dispatch({ type: 'items', chatId: 'c', items: [msg('c-1')] });
    dispatch({ type: 'chat:updated', chat: chat('c', { closedAt: 4, state: 'closed' }) });
    expect(app.get().items.c).toBeUndefined();
    invoke.mockClear();
    dispatch({ type: 'chat:updated', chat: chat('c', { state: 'idle' }) });
    expect(invoke).toHaveBeenCalledWith('chat:items', expect.objectContaining({ chatId: 'c' }));
    await flush();
    expect(app.get().items.c?.map(i => i.id)).toEqual(['c-1']);
  });

  it('the ✕ close keeps the items while «Annulla» shows: the undo brings the transcript back at once', async () => {
    dispatch({ type: 'chat:updated', chat: chat('d') });
    dispatch({ type: 'items', chatId: 'd', items: [msg('d-1')] });
    closeChat('d');
    dispatch({ type: 'chat:updated', chat: chat('d', { closedAt: 9, state: 'closed' }) }); // main's own event
    await flush();
    expect(app.get().chats.d?.closedAt).toBe(9);
    expect(app.get().items.d).toHaveLength(1);
    const undo = ui.get().toasts.find(x => x.action)?.action;
    invoke.mockClear();
    undo!.run();
    await flush(); await flush();
    expect(app.get().chats.d?.closedAt).toBeUndefined();
    expect(app.get().items.d?.map(i => i.id)).toEqual(['d-1']);
    expect(invoke.mock.calls.some(c => c[0] === 'chat:items')).toBe(false);
  });
});

describe('store: a chat that leaves purges what was kept for it', () => {
  it('runs the modules\' hooks and forgets its failed-answer attempts', async () => {
    invoke.mockReset();
    dispatch({ type: 'chat:updated', chat: chat('e') });
    invoke.mockRejectedValueOnce(new Error('rete'));
    const req = { id: 'r1', chatId: 'e', type: 'permission' as const, tool: 'Bash', title: 't', detail: 'd', input: {}, at: 1 };
    await answer(req, { kind: 'permission', allow: true } as never);
    expect(attemptOf('e/r1')).toBe(1);
    const seen: string[] = [];
    const off = onChatRemoved(id => seen.push(id));
    dispatch({ type: 'chat:removed', chatId: 'e' });
    off();
    expect(seen).toEqual(['e']);
    expect(attemptOf('e/r1')).toBe(0);
  });
});
