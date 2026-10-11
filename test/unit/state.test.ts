// Unit tests of the renderer's data reducer and selectors (src/renderer/store/state.ts): events merge without losing
// what arrived during the initial load, unchanged parts keep their references (per-tile re-render), pending stays
// oldest-first, queued messages flush when a chat becomes idle, Corsie columns.
import { describe, expect, it } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { corsie, initialState, reduce, runningCount, toFlush, todayCost, type AppState } from '../../src/renderer/store/state';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1000, browserTabIds: [], ...p,
});
const req = (chatId: string, id: string, at: number): PendingRequest => ({ id, chatId, type: 'permission', tool: 'Bash', title: 't', detail: 'd', input: {}, at });
const say = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text });

const init = (s: AppState = initialState) => reduce(s, { type: 'init', chats: [chat('a'), chat('b')], pending: [], tabs: [], feed: [], usage: null, info: null });

describe('reduce', () => {
  it('init keeps chats that arrived by event during the load and marks ready', () => {
    const early = reduce(initialState, { type: 'chat:updated', chat: chat('z') });
    const s = init(early);
    expect(s.ready).toBe(true);
    expect(s.order).toEqual(['a', 'b', 'z']);
    expect(s.chats.z?.id).toBe('z');
  });

  it('chat:item appends, replaces by id, and leaves other chats untouched (same reference)', () => {
    let s = init();
    s = reduce(s, { type: 'chat:item', chatId: 'b', item: say('x', 'hello') });
    const bItems = s.items.b;
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: say('1', 'he') });
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: say('1', 'hello world'), replace: true });
    expect(s.items.a).toHaveLength(1);
    expect((s.items.a![0] as { text: string }).text).toBe('hello world');
    expect(s.items.b).toBe(bItems);
  });

  it('a real user item replaces its optimistic local copy', () => {
    let s = init();
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: { kind: 'user', id: 'local:1', at: 1, text: 'ciao' } });
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: { kind: 'user', id: 'u9', at: 2, text: 'ciao' } });
    expect(s.items.a!.map(i => i.id)).toEqual(['u9']);
  });

  it('items load merges with items that came by event (event versions win, order kept)', () => {
    let s = init();
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: say('2', 'newer') });
    s = reduce(s, { type: 'chat:item', chatId: 'a', item: say('3', 'after') });
    s = reduce(s, { type: 'items', chatId: 'a', items: [say('1', 'first'), say('2', 'older')] });
    expect(s.items.a!.map(i => i.id)).toEqual(['1', '2', '3']);
    expect((s.items.a![1] as { text: string }).text).toBe('newer');
  });

  it('chat:updated with identical data returns the same state (no re-render)', () => {
    const s = init();
    expect(reduce(s, { type: 'chat:updated', chat: chat('a') })).toBe(s);
  });

  it('pending stays oldest first, deduped, and resolves by chat + id', () => {
    let s = init();
    s = reduce(s, { type: 'pending:added', req: req('a', 'r2', 20) });
    s = reduce(s, { type: 'pending:added', req: req('b', 'r1', 10) });
    s = reduce(s, { type: 'pending:added', req: req('b', 'r1', 10) });
    expect(s.pending.map(p => p.id)).toEqual(['r1', 'r2']);
    s = reduce(s, { type: 'pending:resolved', chatId: 'a', requestId: 'r2' });
    expect(s.pending.map(p => p.id)).toEqual(['r1']);
    expect(reduce(s, { type: 'pending:resolved', chatId: 'a', requestId: 'nope' })).toBe(s);
  });

  it('chat:removed drops its items, pending and queue', () => {
    let s = init();
    s = reduce(s, { type: 'pending:added', req: req('a', 'r', 1) });
    s = reduce(s, { type: 'queue', chatId: 'a', text: 'dopo' });
    s = reduce(s, { type: 'chat:removed', chatId: 'a' });
    expect(s.order).toEqual(['b']);
    expect(s.pending).toHaveLength(0);
    expect(s.queued.a).toBeUndefined();
  });

  it('feed merges newest first without duplicates', () => {
    let s = init();
    const e = (id: string, at: number) => ({ id, at, kind: 'idea', label: 'Idea', priority: 'normal' as const, title: id, detail: '' });
    s = reduce(s, { type: 'feed:events', events: [e('a', 1), e('b', 3)] });
    s = reduce(s, { type: 'feed:events', events: [e('c', 2), e('a', 1)] });
    expect(s.feed.map(x => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('queue ignores blank text; unqueue removes by index', () => {
    let s = init();
    s = reduce(s, { type: 'queue', chatId: 'a', text: '  ' });
    expect(s.queued.a).toBeUndefined();
    s = reduce(s, { type: 'queue', chatId: 'a', text: 'uno' });
    s = reduce(s, { type: 'queue', chatId: 'a', text: 'due' });
    s = reduce(s, { type: 'unqueue', chatId: 'a', index: 0 });
    expect(s.queued.a).toEqual(['due']);
  });
});

describe('selectors', () => {
  it('toFlush sends the first queued message only on the transition to idle with nothing pending', () => {
    const q = ['dopo'];
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle' }), q)).toBe('dopo');
    expect(toFlush(chat('a', { state: 'idle' }), chat('a', { state: 'idle' }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'waiting' }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle', pending: 1 }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle' }), [])).toBeNull();
  });

  it('corsie: waiting by oldest request, working, finished today newest first; Regia excluded', () => {
    const now = new Date(2026, 9, 11, 12, 0).getTime();
    const s = {
      order: ['r', 'w1', 'w2', 'run', 'd1', 'd2', 'old'],
      chats: {
        r: chat('r', { isRegia: true, state: 'waiting' }),
        w1: chat('w1', { state: 'waiting', pending: 1 }),
        w2: chat('w2', { state: 'waiting', pending: 1 }),
        run: chat('run', { state: 'running' }),
        d1: chat('d1', { updatedAt: now - 3600_000 }),
        d2: chat('d2', { updatedAt: now - 60_000 }),
        old: chat('old', { updatedAt: now - 2 * 86400_000 }),
      },
      pending: [req('w2', 'x', 5), req('w1', 'y', 9)],
    };
    const c = corsie(s, now);
    expect(c.waiting.map(x => x.id)).toEqual(['w2', 'w1']);
    expect(c.working.map(x => x.id)).toEqual(['run']);
    expect(c.done.map(x => x.id)).toEqual(['d2', 'd1']);
    expect(c.older.map(x => x.id)).toEqual(['old']); // not today: kept, in "Precedenti"
  });

  it('runningCount and todayCost', () => {
    const chats = { a: chat('a', { state: 'running', costUsd: 1 }), b: chat('b', { state: 'starting', costUsd: 2 }), c: chat('c', { costUsd: 3 }) };
    expect(runningCount({ chats })).toBe(2);
    expect(todayCost({ chats, usage: null })).toBe(6);
    expect(todayCost({ chats, usage: { todayUsd: 38.2, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null } })).toBe(38.2);
  });
});
