// FIFO queue entry and deliberate navigation: paused queues restart at the oldest request, not stale DOM focus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkThread } from '@shared/workflows';
import type { PendingRequest } from '@shared/contract';
const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...args: unknown[]) => invoke(...args), on: () => () => {} } }));
const { app } = await import('../../src/renderer/store/store');
const { initialState, reduce } = await import('../../src/renderer/store/state');
const { ui, callQuestions, parkQuestions } = await import('../../src/renderer/store/ui');
const { nextThing } = await import('../../src/renderer/actions');
const { openQueue } = await import('../../src/renderer/lib/later');
const { workflowState, durableAskKeys } = await import('../../src/renderer/store/workflows');
const { answerLater, requestPostponed } = await import('../../src/renderer/lib/later');
const requests: PendingRequest[] = ['A', 'B', 'C'].map((id, i) => ({ id, chatId: 'chat', type: 'permission', tool: 'Bash', title: id, detail: '', input: {}, at: i + 1 }));
const key = (id: string) => `chat/${id}`;
/** the request card that has the keyboard (Ctrl+J goes on from it) */
const focusOn = (id: string) => vi.stubGlobal('document', { activeElement: { closest: () => ({ getAttribute: () => key(id) }) } });
beforeEach(() => {
  invoke.mockReset().mockImplementation((channel: string, value?: { on: boolean }) => Promise.resolve(channel === 'later:set' ? value : channel === 'work:list' ? workflowState.get().rows : channel === 'work:lessons' ? workflowState.get().lessons : undefined));
  workflowState.set({ rows: [], lessons: [], error: null, lessonError: null });
  let state = initialState;
  for (const req of requests) state = reduce(state, { type: 'pending:added', req });
  app.set(state);
  ui.set(s => ({ ...s, later: true, hidden: [], qwin: { open: false, first: null, call: 0, shown: false } }));
  focusOn('A');
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
  it('opens a paused queue at A despite an old focus on B', () => {
    focusOn('B'); nextThing();
    expect(displayed()).toBe(key('A'));
  });
  it('topbar queue open and park clear a prior targeted selection', () => {
    callQuestions(key('C')); parkQuestions();
    expect(ui.get().qwin).toMatchObject({ open: false, first: null });
    openQueue(null);
    expect(displayed()).toBe(key('A'));
  });
  it('still cycles A to B to C once the queue is open and preserves targeted opening', () => {
    openQueue(null); focusOn('A'); nextThing();
    expect(displayed()).toBe(key('B'));
    focusOn('B'); nextThing();
    expect(displayed()).toBe(key('C'));
    focusOn('C'); nextThing();
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

it('Ctrl+J and the topbar reopen a postponed durable proposal when no native request remains', () => {
  app.set(initialState);
  workflowState.set({ rows: [{ id: 'thread', version: 1, status: 'approval', updatedAt: 1, proposal: { id: 'p', text: 'Scoped action' } } as WorkThread], lessons: [], error: null, lessonError: null });
  const proposal = durableAskKeys()[0]!;
  answerLater(proposal);
  expect(requestPostponed(proposal)).toBe(true);
  nextThing();
  expect(ui.get().qwin.open).toBe(true);
  expect(requestPostponed(proposal)).toBe(false);
  expect(invoke.mock.calls.some(([channel]) => channel === 'morning:get')).toBe(false);
});
