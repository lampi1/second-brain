// Unit tests of "Mandato" (ADR 0038): which blocks are a text to send (lib/sendable.ts), the short line the chat gets
// (first line only, cut, token-like words masked), the notes split off a user message and folded (lib/foreign.ts), and
// the store's notes (store/store.ts): Mandato told after the undo window, at once when the chat is idle, with its next
// turn when it works; Copiato only with the user's next message; Annulla tells nothing; Non serve tells the chat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { blockKey, firstWords, isSendable, noteLine, splitNotes, UNDO_MS } from '../../src/renderer/lib/sendable';
import { foreignOf } from '../../src/renderer/lib/foreign';

const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...a), on: () => () => {} } }));
const { app, dismissCommand, dispatch, markCopied, markSent, send, undoSent, unqueue } = await import('../../src/renderer/store/store');
const { markOf } = await import('../../src/renderer/lib/marks');

describe('sendable', () => {
  it('a text block: no language or a text tag; never shell, sql or code', () => {
    for (const l of ['', 'text', 'Markdown', 'plaintext', 'mail', 'teams', ' md ']) expect(isSendable(l)).toBe(true);
    for (const l of ['powershell', 'bash', 'sql', 'json', 'ts', 'cmd']) expect(isSendable(l)).toBe(false);
  });

  it('the line is the first non-empty line, cut to ~60 chars, long token-like words masked', () => {
    expect(firstWords('\n\n  Ciao Marco,\nla password è x')).toBe('Ciao Marco,');
    const long = firstWords('Gentile cliente, le confermo che il rimborso della fattura 2026/118 è stato emesso oggi');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(firstWords('token: Zx9Qk2Lm7Wv4Rt8Yp3Nb6Hc1Jd5Fg0Sa')).toBe('token: […]');
    expect(firstWords('PR https://git.example.com/org/p/_git/r/pull/4242?_a=files&x=y')).toBe('PR https://git.example.com/org/p/_git/r/pull/4242');
    expect(noteLine('sent', 'Ciao Marco,\nresto')).toBe('[Mandato] Ciao Marco,');
    expect(noteLine('dismissed', 'npm test')).toBe('[Non serve] npm test');
  });

  it('notes at the end of a message come apart; a message of notes only folds as "Fatto da te"', () => {
    expect(splitNotes('ok vai\n\n[Copiato] Ciao Marco,')).toEqual({ text: 'ok vai', notes: ['[Copiato] Ciao Marco,'] });
    expect(splitNotes('[Mandato] Ciao\n[Non serve] npm test')).toEqual({ text: '', notes: ['[Mandato] Ciao', '[Non serve] npm test'] });
    expect(splitNotes('[Mandato] Ciao\npoi ho fatto altro')).toEqual({ text: '[Mandato] Ciao\npoi ho fatto altro', notes: [] });
    const user = (text: string, from?: string): Extract<ChatItem, { kind: 'user' }> => ({ kind: 'user', id: 'u', at: 1, text, ...(from ? { from } : {}) });
    expect(foreignOf(user('[Mandato] Ciao Marco,'))).toMatchObject({ kind: 'done', summary: '[Mandato] Ciao Marco,' });
    expect(foreignOf(user('ok vai\n\n[Copiato] Ciao'))).toBeNull(); // the user's own text: a bubble, notes under it
  });

  it('a block keeps its key across renders and restarts; another text is another block', () => {
    // no message id in it: a transcript read back after a restart gives new ids, the mark must stay
    expect(blockKey('a', 'Ciao\r\n')).toBe(blockKey('a', 'Ciao'));
    expect(blockKey('a', 'Ciao')).not.toBe(blockKey('a', 'Ciao!'));
    expect(blockKey('a', 'Ciao')).not.toBe(blockKey('b', 'Ciao'));
  });
});

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const sent = () => invoke.mock.calls.filter(c => c[0] === 'chat:send').map(c => (c[1] as { text: string }).text);
const MAIL = 'Ciao Marco,\nti mando il report di oggi.\nStudio Demo';
let n = 0;

describe('notes to the chat', () => {
  let key = '';
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset(); invoke.mockResolvedValue(undefined);
    key = blockKey('a', `${MAIL}${++n}`); // one block per test (the marks live on)
    dispatch({ type: 'init', chats: [chat('a')], pending: [], tabs: [], feed: [], usage: null, info: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('Mandato: marked at once, the chat is told after the undo window (idle: its own short message)', () => {
    markSent('a', key, MAIL);
    expect(markOf(key)?.kind).toBe('sent');
    expect(sent()).toEqual([]);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent()).toEqual(['[Mandato] Ciao Marco,']);
  });

  it('Annulla within the window: the previous mark comes back, the chat hears nothing', () => {
    markCopied('a', key, MAIL);
    markSent('a', key, MAIL);
    expect(undoSent(key)).toBe(true);
    expect(markOf(key)?.kind).toBe('copied');
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(sent()).toEqual([]);
    expect(send('a', 'fatto il resto')).toBe('sent'); // the Copiato note rides on the next message
    expect(sent()).toEqual(['fatto il resto\n\n[Copiato] Ciao Marco,']);
  });

  it('Copiato alone never makes a turn; Mandato replaces it (one note per block)', () => {
    markCopied('a', key, MAIL);
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(sent()).toEqual([]);
    expect(send('a', '')).toBe('empty');
    markSent('a', key, MAIL);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent()).toEqual(['[Mandato] Ciao Marco,']);
    markCopied('a', key, MAIL); // copied again after sending: still "Mandato"
    expect(markOf(key)?.kind).toBe('sent');
  });

  it('while the chat works: no new turn; with a queued message it rides on it, else one line when it is free', () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    markSent('a', key, MAIL);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent()).toEqual([]);
    expect(app.get().queued.a ?? []).toEqual([]); // not a queued message of its own
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sent()).toEqual(['[Mandato] Ciao Marco,']);

    invoke.mockClear();
    const k2 = blockKey('a', 'Secondo testo');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    expect(send('a', 'e poi?')).toBe('queued');
    markSent('a', k2, 'Secondo testo');
    vi.advanceTimersByTime(UNDO_MS);
    expect(app.get().queued.a?.map(m => m.text)).toEqual(['e poi?']); // the note is not inside the queued message
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sent()).toEqual(['e poi?\n\n[Mandato] Secondo testo']);
  });

  it('a queued message removed loses no note; Enter on an empty field never sends notes alone', () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    markSent('a', key, MAIL);
    vi.advanceTimersByTime(UNDO_MS);
    expect(send('a', 'poi fai X')).toBe('queued');
    expect(send('a', '')).toBe('empty');
    unqueue('a', app.get().queued.a![0]!.id);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sent()).toEqual(['[Mandato] Ciao Marco,']);
  });

  it('a chat writing its hand-off, or closed, is not told: the note waits until it is free', () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { handoffBusy: true }) });
    markSent('a', key, MAIL);
    vi.advanceTimersByTime(UNDO_MS);
    expect(sent()).toEqual([]);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'closed' }) });
    expect(sent()).toEqual([]);
    dispatch({ type: 'chat:updated', chat: chat('a') });
    expect(sent()).toEqual(['[Mandato] Ciao Marco,']);
  });

  it('Non serve on a command card tells the chat', async () => {
    vi.useRealTimers();
    const req: PendingRequest = { id: 'c1', chatId: 'a', type: 'command', tool: 'Esegui', title: 't', detail: '', input: {}, at: 1, command: { itemId: 'm', lang: 'powershell', code: 'npm test\nnpm run build' } } as PendingRequest;
    await dismissCommand(req);
    expect(sent()).toEqual(['[Non serve] npm test']);
  });
});
