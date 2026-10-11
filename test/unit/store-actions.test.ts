// Unit tests of the renderer store actions with a fake bridge (src/renderer/store/store.ts): a failed send rolls back
// only its own optimistic copy (a newer chat:updated wins); a failed answer comes back answerable (attempt bumped),
// except when main says the request is no longer open.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, PendingRequest } from '@shared/contract';

const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...a), on: () => () => {} } }));

const { app, answer, attemptOf, dispatch, send } = await import('../../src/renderer/store/store');

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const req: PendingRequest = { id: 'r1', chatId: 'a', type: 'permission', tool: 'Bash', title: 't', detail: 'd', input: {}, at: 1 };
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
  dispatch({ type: 'init', chats: [chat('a')], pending: [], tabs: [], feed: [], usage: null, info: null });
  dispatch({ type: 'chat:updated', chat: chat('a') });
});

describe('send', () => {
  it('a failed send rolls back the optimistic state', async () => {
    invoke.mockRejectedValueOnce(new Error('rete'));
    expect(send('a', 'ciao')).toBe('sent');
    expect(app.get().chats.a?.state).toBe('running');
    await flush();
    expect(app.get().chats.a?.state).toBe('idle');
    expect(app.get().queued.a).toEqual(['ciao']);
  });

  it('a failed send never overwrites a newer chat:updated (e.g. the error main reported)', async () => {
    let reject: (e: Error) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    send('a', 'ciao');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'error', lastError: 'avvio non riuscito' }) });
    reject(new Error('rete'));
    await flush();
    expect(app.get().chats.a).toMatchObject({ state: 'error', lastError: 'avvio non riuscito' });
  });
});

describe('answer', () => {
  it('a failed answer brings the request back, answerable again (attempt bumped)', async () => {
    dispatch({ type: 'pending:added', req });
    invoke.mockRejectedValueOnce(new Error('rete'));
    const before = attemptOf('a/r1');
    expect(await answer(req, { kind: 'permission', allow: true })).toBe(false);
    expect(app.get().pending.some(p => p.id === 'r1')).toBe(true);
    expect(attemptOf('a/r1')).toBe(before + 1);
  });

  it('when main says it is no longer open, it stays gone', async () => {
    dispatch({ type: 'pending:added', req: { ...req, id: 'r2' } });
    invoke.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:answer': Error: Questa richiesta non è più aperta."));
    expect(await answer({ ...req, id: 'r2' }, { kind: 'permission', allow: true })).toBe(false);
    expect(app.get().pending.some(p => p.id === 'r2')).toBe(false);
  });

  it('a good answer resolves true and the request is gone', async () => {
    dispatch({ type: 'pending:added', req: { ...req, id: 'r3' } });
    invoke.mockResolvedValueOnce(undefined);
    expect(await answer({ ...req, id: 'r3' }, { kind: 'permission', allow: false })).toBe(true);
    expect(app.get().pending.some(p => p.id === 'r3')).toBe(false);
  });
});
