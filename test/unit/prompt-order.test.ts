// FIFO queue entry and deliberate navigation: paused queues restart at the oldest request, not stale DOM focus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingRequest } from '@shared/contract';
const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...args: unknown[]) => invoke(...args), on: () => () => {} } }));
const { app } = await import('../../src/renderer/store/store');
const { initialState, reduce } = await import('../../src/renderer/store/state');
const { ui, callQuestions, parkQuestions } = await import('../../src/renderer/store/ui');
const { nextThing } = await import('../../src/renderer/actions');
const { openQueue } = await import('../../src/renderer/lib/later');
const requests: PendingRequest[] = ['A', 'B', 'C'].map((id, i) => ({ id, chatId: 'chat', type: 'permission', tool: 'Bash', title: id, detail: '', input: {}, at: i + 1 }));
const key = (id: string) => `chat/${id}`;
beforeEach(() => {
  invoke.mockReset().mockImplementation((channel: string, value?: { on: boolean }) => Promise.resolve(channel === 'later:set' ? value : undefined));
  let state = initialState;
  for (const req of requests) state = reduce(state, { type: 'pending:added', req });
  app.set(state);
  ui.set(s => ({ ...s, later: true, hidden: [], qwin: { open: false, first: null, call: 0, shown: false } }));
  vi.stubGlobal('document', { activeElement: { closest: () => ({ getAttribute: () => key('A') }) } });
});
afterEach(() => { vi.unstubAllGlobals(); });
const displayed = () => ui.get().qwin.first ?? `${app.get().pending[0]?.chatId}/${app.get().pending[0]?.id}`;
describe('request queue FIFO', () => {
  it('opens paused A/B/C at A despite old focus on A', () => {
    nextThing();
    expect(ui.get().qwin.open).toBe(true);
    expect(displayed()).toBe(key('A'));
    expect(app.get().pending.map(p => p.id)).toEqual(['A', 'B', 'C']);
  });
  it('opens a paused queue at A despite an old layer navigation origin B', () => {
    nextThing(key('B'));
    expect(displayed()).toBe(key('A'));
  });
  it('topbar queue open and park clear a prior targeted selection', () => {
    callQuestions(key('C')); parkQuestions();
    expect(ui.get().qwin).toMatchObject({ open: false, first: null });
    openQueue(null);
    expect(displayed()).toBe(key('A'));
  });
  it('still cycles A to B to C once the queue is open and preserves targeted opening', () => {
    openQueue(null); nextThing(key('A'));
    expect(displayed()).toBe(key('B'));
    nextThing(key('B'));
    expect(displayed()).toBe(key('C'));
    nextThing(key('C'));
    expect(displayed()).toBe(key('A'));
    openQueue(key('C'));
    expect(displayed()).toBe(key('C'));
  });
  it('keeps oldest-first order when the initial snapshot arrives out of order', () => {
    app.set(reduce(initialState, { type: 'init', chats: [], pending: [...requests].reverse(), tabs: [], feed: [], usage: null, info: null }));
    openQueue(null);
    expect(displayed()).toBe(key('A'));
    expect(app.get().pending.map(p => p.id)).toEqual(['A', 'B', 'C']);
  });
});
