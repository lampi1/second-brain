// The auto-close rule (src/renderer/lib/autoclose.ts): who is a candidate, when it is due, what holds it, and the
// "Chiuse" order (the palette's group, Ctrl+K).
import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import { closeAt, closedChats, dueChats, type Hold } from '../../src/renderer/lib/autoclose';

const MIN = 60_000;
const chat = (p: Partial<ChatSummary> = {}): ChatSummary => ({
  id: 'c1', harness: 'claude', origin: 'app', title: 'Lavoro', cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], lastResult: { at: 1000, isError: false }, ...p,
});
const free: Hold = { queued: 0, draft: false, shown: false, browser: false, touchedAt: 0, asks: 0, running: false };

describe('auto-close rule', () => {
  it('a finished work chat closes after the delay from its result', () => {
    expect(closeAt(chat(), free, 5 * MIN)).toBe(1000 + 5 * MIN);
    expect(dueChats([chat()], () => free, 5 * MIN, 1000 + 5 * MIN - 1)).toEqual([]);
    expect(dueChats([chat()], () => free, 5 * MIN, 1000 + 5 * MIN).map(c => c.id)).toEqual(['c1']);
  });

  it('a background task that ended after the result restarts the clock (the CLI reads its report in a turn of its own)', () => {
    expect(closeAt(chat({ backgroundEndedAt: 50_000 }), free, 2 * MIN)).toBe(50_000 + 2 * MIN);
    expect(dueChats([chat({ backgroundEndedAt: 50_000 })], () => free, 2 * MIN, 1000 + 2 * MIN)).toEqual([]);
    expect(closeAt(chat({ backgroundEndedAt: 500 }), free, 2 * MIN)).toBe(1000 + 2 * MIN);
  });

  it('the user touching the tile restarts the clock', () => {
    expect(closeAt(chat(), { ...free, touchedAt: 9000 }, MIN)).toBe(9000 + MIN);
  });

  it('never: the Regia, delay 0, already closed, not idle, a request open, background tasks, an error, no result yet, a turn the user interrupted', () => {
    const no: Partial<ChatSummary>[] = [
      { isRegia: true }, { closedAt: 5 }, { state: 'running' }, { state: 'waiting' }, { state: 'error' }, { pending: 1 },
      { background: 2 }, { lastError: 'x' }, { lastResult: { at: 1, isError: true } }, { lastResult: undefined },
      { lastResult: { at: 1, isError: false, interrupted: true } }, // the user stopped it: he is on it
    ];
    for (const p of no) expect(closeAt(chat(p), free, MIN)).toBeNull();
    expect(closeAt(chat(), free, 0)).toBeNull();
  });

  it('a chat whose session ended closes too: restored at start-up (no result) from its last update, else from its result', () => {
    expect(closeAt(chat({ state: 'closed', lastResult: undefined, updatedAt: 500 }), free, MIN)).toBe(500 + MIN);
    expect(closeAt(chat({ state: 'closed', updatedAt: 500 }), free, MIN)).toBe(1000 + MIN);
    expect(closeAt(chat({ state: 'closed', lastResult: { at: 1, isError: false, interrupted: true } }), free, MIN)).toBeNull();
  });

  it('held by a queued message, a running Esegui, an unsent draft, the chat maximized / selected / in focus, or its browser in use', () => {
    for (const h of [{ queued: 1 }, { asks: 1 }, { running: true }, { draft: true }, { shown: true }, { browser: true }]) expect(closeAt(chat(), { ...free, ...h }, MIN)).toBeNull();
  });

  it('closed chats newest first', () => {
    const list = closedChats({ a: chat({ id: 'a', closedAt: 10 }), b: chat({ id: 'b' }), c: chat({ id: 'c', closedAt: 30 }) });
    expect(list.map(c => c.id)).toEqual(['c', 'a']);
  });
});
