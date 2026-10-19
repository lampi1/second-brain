// Unit tests of "Correggi il pensiero" (ADR 0058): the message a correction sends and its reading back
// (src/renderer/lib/correction.ts), the sentences marked in the reasoning, when it is refused, and the store action
// correctThought with a fake bridge (stop = first in the queue + interrupt keeping it; step = Claude only, sent into the
// running turn; a free chat gets a normal message; an open question or permission sends nothing).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { cleanQuote, correctedThoughts, correctionBlocked, correctionText, findQuote, markPieces, parseCorrection, QUOTE_MAX } from '../../src/renderer/lib/correction';

const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...a), on: () => () => {} } }));
const { app, correctThought, dispatch } = await import('../../src/renderer/store/store');

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});

describe('correction text', () => {
  it('quotes the sentence on one line and reads back the same quote and fix', () => {
    const t = correctionText('  Penso di usare\n la libreria «vecchia».  ', 'usa quella nuova');
    expect(t).toBe('[Reasoning correction]\nIn your reasoning you wrote: «Penso di usare la libreria "vecchia".»\nNot like that: usa quella nuova\nRedo this step taking the correction into account.');
    expect(parseCorrection(t)).toEqual({ quote: 'Penso di usare la libreria "vecchia".', fix: 'usa quella nuova' });
    expect(parseCorrection('ciao')).toBeNull();
    expect(parseCorrection(`${t}\nextra`)).toBeNull();
    // the first, Italian format (corrections already saved) still reads back
    expect(parseCorrection('[Correzione del ragionamento]\nNel tuo ragionamento hai scritto: «Penso X»\nNo, così: Y\nRifai questo passo tenendo conto della correzione.')).toEqual({ quote: 'Penso X', fix: 'Y' });
  });

  it('cuts a long selection to QUOTE_MAX with an ellipsis, and still finds it in the reasoning', () => {
    const long = 'parola '.repeat(200);
    const q = cleanQuote(long);
    expect(q.length).toBe(QUOTE_MAX);
    expect(q.endsWith('…')).toBe(true);
    expect(findQuote(long, q)?.start).toBe(0);
  });
});

describe('marks', () => {
  it('finds a quote across line breaks and marks it; overlaps keep the first', () => {
    const text = 'Primo passo.\nPenso di usare\nla libreria vecchia. Poi altro.';
    expect(findQuote(text, 'Penso di usare la libreria vecchia.')).toEqual({ start: 13, end: 48 });
    expect(markPieces(text, ['Penso di usare la libreria vecchia.', 'libreria'])).toEqual([
      { text: 'Primo passo.\n', mark: false }, { text: 'Penso di usare\nla libreria vecchia.', mark: true }, { text: ' Poi altro.', mark: false },
    ]);
    expect(markPieces('niente', ['altro'])).toEqual([{ text: 'niente', mark: false }]);
    expect(findQuote('a.b', '.')).toEqual({ start: 1, end: 2 }); // regex characters are literal
  });

  it('each correction marks the latest reasoning before it that holds the quote (notes riding on it too)', () => {
    const items: ChatItem[] = [
      { kind: 'thinking', id: 't1', at: 1, text: 'Uso la libreria vecchia.' },
      { kind: 'thinking', id: 't2', at: 2, text: 'Altro: uso la libreria vecchia.' },
      { kind: 'user', id: 'u1', at: 3, text: `${correctionText('uso la libreria vecchia.', 'nuova')}\n\n[Copiato] mail` },
      { kind: 'user', id: 'u2', at: 4, text: correctionText('non c’è', 'x') },
    ];
    const m = correctedThoughts(items);
    expect([...m]).toEqual([['t2', ['uso la libreria vecchia.']]]);
  });

  it('refused while the chat waits on the user', () => {
    expect(correctionBlocked(chat('a', { state: 'running' }), false)).toBeNull();
    expect(correctionBlocked(chat('a', { state: 'waiting' }), false)).toMatch(/rispondi prima/);
    expect(correctionBlocked(chat('a', { state: 'running' }), true)).toMatch(/rispondi prima/);
    expect(correctionBlocked(undefined, false)).toMatch(/non c’è/);
  });
});

describe('correctThought', () => {
  const sends = () => invoke.mock.calls.filter(c => c[0] === 'chat:send').map(c => (c[1] as { text: string }).text);
  const flush = () => new Promise(r => setTimeout(r, 0));
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    dispatch({ type: 'init', chats: [chat('a'), chat('c', { harness: 'cursor' })], pending: [], tabs: [], feed: [], usage: null, info: null });
    for (const id of ['a', 'c']) for (const m of app.get().queued[id] ?? []) dispatch({ type: 'unqueue', chatId: id, id: m.id });
  });

  it('stop: the correction goes first in the queue, the turn is interrupted keeping it, it is sent once when idle', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    expect(await correctThought('a', 'Penso X', 'no, Y', 'stop')).toEqual({ done: 'stopping' });
    expect(invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'a', keepQueued: true });
    expect(sends()).toEqual([]);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sends()).toEqual([correctionText('Penso X', 'no, Y')]);
  });

  it('step (Claude): sent into the running turn at once, nothing interrupted', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    expect(await correctThought('a', 'Penso X', 'no, Y', 'step')).toEqual({ done: 'step' });
    await flush();
    expect(sends()).toEqual([correctionText('Penso X', 'no, Y')]);
    expect(invoke).not.toHaveBeenCalledWith('chat:stop', expect.anything());
  });

  it('step on Cursor stops the turn instead (ACP takes no message mid-turn)', async () => {
    dispatch({ type: 'chat:updated', chat: chat('c', { harness: 'cursor', state: 'running' }) });
    expect(await correctThought('c', 'Penso X', 'no', 'step')).toEqual({ done: 'stopping' });
    expect(invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'c', keepQueued: true });
  });

  it('a free chat gets it as a normal message; an open request or an empty fix sends nothing', async () => {
    const req: PendingRequest = { id: 'r1', chatId: 'a', type: 'permission', tool: 'Bash', title: 't', detail: 'd', input: {}, at: 1 };
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    dispatch({ type: 'pending:added', req });
    expect(await correctThought('a', 'Penso X', 'no', 'stop')).toMatchObject({ blocked: expect.stringMatching(/rispondi prima/) });
    expect(await correctThought('a', 'Penso X', '  ', 'stop')).toMatchObject({ blocked: 'Scrivi la correzione.' });
    expect(invoke).not.toHaveBeenCalled();
    dispatch({ type: 'pending:resolved', chatId: 'a', requestId: 'r1' });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(await correctThought('a', 'Penso X', 'no', 'stop')).toEqual({ done: 'sent' });
    expect(sends()).toEqual([correctionText('Penso X', 'no')]);
  });
});
