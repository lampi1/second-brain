// Unit tests of the renderer's data reducer and selectors (src/renderer/store/state.ts): events merge without losing
// what arrived during the initial load, unchanged parts keep their references (per-tile re-render), pending stays
// oldest-first, queued messages flush when a chat becomes idle.
import { describe, expect, it } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { initialState, reduce, runningCount, toFlush, todayCost, type AppState } from '../../src/renderer/store/state';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1000, browserTabIds: [], ...p,
});
const req = (chatId: string, id: string, at: number): PendingRequest => ({ id, chatId, type: 'permission', tool: 'Bash', title: 't', detail: 'd', input: {}, at });
const say = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text });

const init = (s: AppState = initialState) => reduce(s, { type: 'init', chats: [chat('a'), chat('b')], pending: [], tabs: [], feed: [], usage: null, info: null });

describe('reduce', () => {
  it('cli:ready fills the CLI status into app:info, and waits for app:info when it comes first', () => {
    const cli = { claude: { found: true, path: 'c', version: '2', loggedIn: true }, cursor: { found: false, path: null, version: null, loggedIn: null } };
    expect(reduce(init(), { type: 'cli', cli }).info).toBeNull();
    const s = reduce(init(), { type: 'info', info: { version: '1', brainRoot: null, mcpUrl: 'u', cli: null, engines: [], systemLang: 'it' } });
    expect(reduce(s, { type: 'cli', cli }).info?.cli).toEqual(cli);
  });

  it('a Cursor chat with no cost of its own takes the Cursor ledger estimate for its session, and drops it when gone', () => {
    const cur = chat('c', { harness: 'cursor', sessionId: 's1', costKnown: false });
    const usage = (cursorChats: Record<string, number>) => ({ todayUsd: 0, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null, cursorChats });
    let s = reduce(init(), { type: 'chat:updated', chat: cur });
    s = reduce(s, { type: 'usage', usage: usage({ s1: 0.4 }) });
    expect(s.chats.c?.costLedgerUsd).toBe(0.4);
    const a = s.chats.a;
    s = reduce(s, { type: 'chat:updated', chat: { ...cur, lastText: 'x' } });
    expect(s.chats.c?.costLedgerUsd).toBe(0.4); // a chat update keeps it
    expect(s.chats.a).toBe(a);                   // other chats keep their reference
    s = reduce(s, { type: 'usage', usage: usage({}) });
    expect(s.chats.c?.costLedgerUsd).toBeUndefined();
  });

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

  // Ricomincia / Cambia motore: main moves the role and sends both updates; the store shows what main says
  it('the Orchestrator role moves only with main\'s update of the old one', () => {
    let s = reduce(init(), { type: 'chat:updated', chat: chat('a', { isOrchestrator: true }) });
    const bRef = s.chats.b;
    s = reduce(s, { type: 'chat:updated', chat: chat('n', { isOrchestrator: true, harness: 'cursor' }) });
    expect(Object.values(s.chats).filter(c => c.isOrchestrator).map(c => c.id).sort()).toEqual(['a', 'n']);
    s = reduce(s, { type: 'chat:updated', chat: chat('a', { isOrchestrator: false }) });
    expect(Object.values(s.chats).filter(c => c.isOrchestrator).map(c => c.id)).toEqual(['n']);
    expect(s.chats.b).toBe(bRef);
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
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q1', text: 'dopo' } });
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

  it('queue ignores blank text without images and repeated ids; unqueue removes by id; front puts it back first', () => {
    const img = { mimeType: 'image/png' as const, data: 'iVBORw0KGgo=' };
    let s = init();
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q0', text: '  ' } });
    expect(s.queued.a).toBeUndefined();
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q1', text: ' uno ' } });
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q2', text: 'uno' } }); // same text, another message
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q3', text: '', images: [img] } }); // images only
    expect(reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q1', text: 'x' } })).toBe(s);
    expect(s.queued.a?.map(m => [m.id, m.text])).toEqual([['q1', 'uno'], ['q2', 'uno'], ['q3', '']]);
    s = reduce(s, { type: 'unqueue', chatId: 'a', id: 'q1' });
    expect(s.queued.a?.map(m => m.id)).toEqual(['q2', 'q3']);
    expect(reduce(s, { type: 'unqueue', chatId: 'a', id: 'nope' })).toBe(s);
    s = reduce(s, { type: 'queue', chatId: 'a', msg: { id: 'q1', text: 'uno' }, front: true });
    expect(s.queued.a?.map(m => m.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('promote moves one queued message (by id) to the front, the others keep their order', () => {
    let s = init();
    for (const [id, text] of [['q1', 'uno'], ['q2', 'due'], ['q3', 'tre']] as const) s = reduce(s, { type: 'queue', chatId: 'a', msg: { id, text } });
    s = reduce(s, { type: 'promote', chatId: 'a', id: 'q3' });
    expect(s.queued.a?.map(m => m.text)).toEqual(['tre', 'uno', 'due']);
    const same = s;
    for (const id of ['q3', 'nope']) expect(reduce(same, { type: 'promote', chatId: 'a', id })).toBe(same); // already first, or gone
    expect(reduce(same, { type: 'promote', chatId: 'zz', id: 'q1' })).toBe(same);
  });
});

describe('selectors', () => {
  it('toFlush sends the first queued message only on the transition to idle with nothing pending', () => {
    const q = [{ id: 'q1', text: 'dopo' }];
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle' }), q)).toBe(q[0]);
    expect(toFlush(chat('a', { state: 'idle' }), chat('a', { state: 'idle' }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'waiting' }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle', pending: 1 }), q)).toBeNull();
    expect(toFlush(chat('a', { state: 'running' }), chat('a', { state: 'idle' }), [])).toBeNull();
  });

  it('runningCount and todayCost', () => {
    const chats = { a: chat('a', { state: 'running', costUsd: 1 }), b: chat('b', { state: 'starting', costUsd: 2 }), c: chat('c', { costUsd: 3 }) };
    expect(runningCount({ chats })).toBe(2);
    expect(todayCost({ chats, usage: null })).toBe(6);
    expect(todayCost({ chats, usage: { todayUsd: 38.2, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null } })).toBe(38.2);
  });
});

it('budgets raw tool output without evicting pending-question context or reordering late completions', () => {
  const tool = (id: string, at: number): ChatItem => ({ kind: 'tool', id, at, name: 'Bash', input: {}, summary: 'test', status: 'ok', output: 'x'.repeat(4000) });
  let s = reduce(init(), { type: 'items', chatId: 'a', items: [say('rationale', 'Report: https://example.test/report'), tool('older', 1), ...Array.from({ length: 150 }, (_, i) => tool(`later-${i}`, i + 2))] });
  expect(s.items.a).toHaveLength(152);
  const before = s.items.a!.map(row => row.id);
  s = reduce(s, { type: 'chat:item', chatId: 'a', item: { ...tool('older', 1), output: 'y'.repeat(600000) } as ChatItem, replace: true });
  expect(s.items.a!.map(row => row.id)).toEqual(before);
  expect(s.items.a![0]).toEqual(say('rationale', 'Report: https://example.test/report'));
  expect(JSON.stringify(s.items.a).length).toBeLessThan(600000);
});
