// The instant Stop and the queue behind it (ADR 0368, renderer/store/stopping.ts and store.ts): the chat shows stopped
// the moment Stop is pressed, main's late «running» does not bring the working state back, what the user types waits
// and goes once main ends the turn; a message to the Orchestrator busy on the app's own news interrupts that turn.
// Fake bridge, fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary } from '@shared/contract';
import { lowPriorityTurn, Stops, STOP_SHOWN_MS } from '../../src/renderer/store/stopping';

const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...a), on: () => () => {} } }));
const { app, dispatch, send, stop } = await import('../../src/renderer/store/store');
afterEach(() => { vi.useRealTimers(); });

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'opencode', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const user = (text: string, from?: string): ChatItem => ({ kind: 'user', id: `u-${text}`, at: 1, text, ...(from ? { from } : {}) });
/** lets the store's awaited bridge calls run (microtasks only, no timer) */
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('Stops', () => {
  it('shows a running chat stopped until main reports another state, and no longer than STOP_SHOWN_MS', () => {
    const s = new Stops();
    s.mark(chat('a', { state: 'running' }), 0);
    expect(s.view(chat('a', { state: 'running' }), 10)).toEqual({ chat: chat('a', { state: 'idle' }), settled: false });
    expect(s.active('a', 10)).toBe(true);
    expect(s.view(chat('a', { state: 'idle' }), 20)).toEqual({ chat: chat('a', { state: 'idle' }), settled: true });
    expect(s.active('a', 20)).toBe(false);
    s.mark(chat('b', { state: 'running' }), 0);
    expect(s.view(chat('b', { state: 'running' }), STOP_SHOWN_MS + 1)).toEqual({ chat: chat('b', { state: 'running' }), settled: false });
  });
  it('expires with main\'s last state for the chat, never before STOP_SHOWN_MS', () => {
    const s = new Stops();
    s.mark(chat('a', { state: 'running' }), 0);
    s.view(chat('a', { state: 'running', lastText: 'ultimo' }), 5);
    expect(s.expire('a', STOP_SHOWN_MS - 1)).toBeUndefined();
    expect(s.expire('a', STOP_SHOWN_MS)).toEqual(chat('a', { state: 'running', lastText: 'ultimo' }));
    expect(s.expire('a', STOP_SHOWN_MS + 1)).toBeUndefined();
  });
});

describe('lowPriorityTurn', () => {
  const orch = { isOrchestrator: true };
  it('is the Orchestrator\'s turn the app\'s own news started, never the user\'s or one already over', () => {
    expect(lowPriorityTurn(orch, [user('ciao'), { kind: 'result', id: 'r0', at: 1, costUsd: 0, durationMs: 1, turns: 1, isError: false }, user('[evento app] novità', 'App')])).toBe(true);
    expect(lowPriorityTurn(orch, [user('[evento app] novità', 'App'), { kind: 'assistant', id: 'a1', at: 2, text: 'leggo' }])).toBe(true);
    expect(lowPriorityTurn(orch, [user('[evento app]', 'App'), user('fai questo')])).toBe(false);
    expect(lowPriorityTurn(orch, [user('[evento app]', 'App'), { kind: 'result', id: 'r1', at: 3, costUsd: 0, durationMs: 1, turns: 1, isError: false }])).toBe(false);
    expect(lowPriorityTurn(orch, [user('report', 'Scout')])).toBe(false);
    expect(lowPriorityTurn(orch, undefined)).toBe(false);
    expect(lowPriorityTurn({ isOrchestrator: false }, [user('[evento app]', 'App')])).toBe(false);
  });
  it('a turn the user started is his even when the app\'s news joined it (main\'s turnFromUser)', () => {
    expect(lowPriorityTurn({ isOrchestrator: true, turnFromUser: true }, [user('fai il punto'), user('[evento app] novità', 'App')])).toBe(false);
  });
});

describe('Stop in the store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset(); invoke.mockResolvedValue(undefined);
    dispatch({ type: 'init', chats: [chat('a'), chat('o', { isOrchestrator: true, harness: 'claude' })], pending: [], tabs: [], feed: [], usage: null, info: null });
    for (const id of ['a', 'o']) for (const m of app.get().queued[id] ?? []) dispatch({ type: 'unqueue', chatId: id, id: m.id });
  });

  it('shows stopped at once; a message typed meanwhile waits and goes when main ends the turn', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    void stop('a');
    expect(app.get().chats.a?.state).toBe('idle');
    expect(invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'a' });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running', lastText: 'still closing' }) });
    expect(app.get().chats.a?.state).toBe('idle'); // the turn still ending never shows as working again
    expect(send('a', 'il prossimo')).toBe('queued');
    expect(invoke).not.toHaveBeenCalledWith('chat:send', expect.anything());
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(invoke).toHaveBeenCalledWith('chat:send', { chatId: 'a', text: 'il prossimo' });
    await flush();
  });

  it('a stop that settles, or that main refuses, leaves no timer behind', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    const before = vi.getTimerCount();
    void stop('a');
    expect(vi.getTimerCount()).toBe(before + 1); // the STOP_SHOWN_MS fallback
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(vi.getTimerCount()).toBe(before);
    await flush();
    // refused: its fallback timer is cancelled (the failure's toast may start timers of its own)
    const set = vi.spyOn(globalThis, 'setTimeout'), cleared = vi.spyOn(globalThis, 'clearTimeout');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    invoke.mockRejectedValueOnce(new Error('Stop non riuscito'));
    const p = stop('a');
    const fallback = set.mock.results[set.mock.calls.findIndex(c => c[1] === STOP_SHOWN_MS + 1)]?.value;
    expect(fallback).toBeDefined();
    await p;
    expect(cleared).toHaveBeenCalledWith(fallback);
    set.mockRestore(); cleared.mockRestore();
  });

  it('a stop main refuses gives the chat its state back', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    invoke.mockRejectedValueOnce(new Error('Stop non riuscito'));
    await stop('a');
    expect(app.get().chats.a?.state).toBe('running');
  });

  it('a message to the Orchestrator busy on the app\'s news interrupts that turn and goes first', async () => {
    dispatch({ type: 'items', chatId: 'o', items: [user('[evento app] novità dalle chat', 'App')] });
    dispatch({ type: 'chat:updated', chat: chat('o', { isOrchestrator: true, harness: 'claude', state: 'running' }) });
    expect(send('o', 'fermati e guarda questo')).toBe('queued');
    await flush();
    expect(invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'o', keepQueued: true });
    dispatch({ type: 'chat:updated', chat: chat('o', { isOrchestrator: true, harness: 'claude', state: 'idle' }) });
    expect(invoke).toHaveBeenLastCalledWith('chat:send', expect.objectContaining({ chatId: 'o', text: 'fermati e guarda questo' }));
  });

  it('the Orchestrator busy on the user\'s own request is not interrupted', async () => {
    dispatch({ type: 'items', chatId: 'o2', items: [user('fai il punto')] });
    dispatch({ type: 'chat:updated', chat: chat('o2', { isOrchestrator: true, harness: 'claude', state: 'running' }) });
    expect(send('o2', 'e poi questo')).toBe('queued');
    await flush();
    expect(invoke).not.toHaveBeenCalledWith('chat:stop', expect.anything());
  });

  it('the queue goes when the stop settles on an idle equal to the one shown (the reducer sees nothing new)', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    void stop('a');
    expect(send('a', 'dopo lo stop')).toBe('queued');
    dispatch({ type: 'chat:updated', chat: { ...app.get().chats.a! } }); // main's idle, field for field the shown one
    expect(invoke).toHaveBeenCalledWith('chat:send', { chatId: 'a', text: 'dopo lo stop' });
    await flush();
  });

  it('no update from main within STOP_SHOWN_MS: its last state (running) shows again, and its later idle lets the queue go', () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    void stop('a');
    expect(send('a', 'in coda')).toBe('queued');
    vi.advanceTimersByTime(STOP_SHOWN_MS + 1);
    expect(app.get().chats.a?.state).toBe('running'); // main never said otherwise: the queue waits for its idle
    expect(invoke).not.toHaveBeenCalledWith('chat:send', expect.anything());
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(invoke).toHaveBeenCalledWith('chat:send', { chatId: 'a', text: 'in coda' });
  });

  it('a message during the user\'s own Orchestrator turn that the app\'s news joined does not interrupt it', async () => {
    dispatch({ type: 'items', chatId: 'o3', items: [user('fai il punto'), user('[evento app] novità', 'App')] });
    dispatch({ type: 'chat:updated', chat: chat('o3', { isOrchestrator: true, harness: 'claude', state: 'running', turnFromUser: true }) });
    expect(send('o3', 'e poi questo')).toBe('queued');
    await flush();
    expect(invoke).not.toHaveBeenCalledWith('chat:stop', expect.anything());
  });
});
