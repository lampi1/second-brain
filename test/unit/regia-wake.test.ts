// Unit tests of main/chats/regia-wake.ts ("Eventi alla Regia"): a work chat that finishes, fails, waits for an answer
// or leaves a command is told to the Regia in one grouped message labelled as the app's; a chat at most once every
// perChatMs; into the Regia's running turn, never while it waits for the user (a failure only); off with the setting;
// the Regia's own turns never.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import { APP_EVENT_LABEL, RegiaWake, wakeLine } from '../../src/main/chats/regia-wake';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

function make(opts: { enabled?: boolean } = {}) {
  const sent: { chatId: string; text: string }[] = [];
  let on = opts.enabled ?? true;
  const w = new RegiaWake({ send: async (chatId, text) => { sent.push({ chatId, text }); }, enabled: () => on, groupMs: 1000, perChatMs: 10_000, now: () => Date.now() });
  const up = (p: Partial<ChatSummary> & { id: string }) => w.observe('chat:updated', chat(p));
  up({ id: 'regia', isRegia: true, title: 'Regia', state: 'idle' });
  /** a work chat's whole turn */
  const finish = (id: string, lastText: string, extra: Partial<ChatSummary> = {}) => { up({ id, state: 'running' }); up({ id, state: 'idle', lastText, ...extra }); };
  return { w, sent, up, finish, setOn: (v: boolean) => { on = v; } };
}

describe('RegiaWake', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a finished chat wakes the Regia with one labelled line, after the grouping window', async () => {
    const { sent, finish } = make();
    finish('qa', 'Report pronto: 8 test su 9.');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('regia');
    expect(sent[0]!.text.startsWith(APP_EVENT_LABEL)).toBe(true);
    expect(sent[0]!.text).toContain('- «qa» (Claude): ha finito il turno. Ultima riga: «Report pronto: 8 test su 9.»');
  });

  it('several chats in one message; error, question, permission and command say what happened', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'sms', harness: 'cursor', state: 'running' });
    up({ id: 'sms', harness: 'cursor', state: 'error', lastError: 'ECONNRESET' });
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', { id: 'p1', chatId: 'fb', type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: {}, at: 1 } satisfies PendingRequest);
    finish('map', 'Fatto. Ora lancia:');
    w.observe('pending:added', { id: 'cmd-a-0', chatId: 'map', type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: 'npm run check', input: {}, at: 1, command: { itemId: 'a', code: 'npm run check', lang: 'powershell' } } satisfies PendingRequest);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    const t = sent[0]!.text;
    expect(t).toContain('«sms» (Cursor): si è fermata su un errore: ECONNRESET');
    expect(t).toContain('«qa» (Claude): aspetta una risposta dell\'utente: Apro il bug?');
    expect(t).toContain('«fb» (Claude): aspetta un permesso dell\'utente: Bash · npm test');
    // the command arrives after the turn's end: it takes the place of "finished"
    expect(t).toContain('«map» (Claude): ha lasciato all\'utente un comando da eseguire: npm run check');
    expect(t).not.toContain('«map» (Claude): ha finito');
  });

  it('a question, a permission or a command alone never wakes the Regia: it goes with the next finished news', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', { id: 'p1', chatId: 'fb', type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: {}, at: 1 } satisfies PendingRequest);
    // the Regia going idle again does not send quiet news either
    up({ id: 'regia', isRegia: true, state: 'running' });
    up({ id: 'regia', isRegia: true, state: 'idle' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    expect(w.queued().map(e => e.kind).sort()).toEqual(['permission', 'question']);
    finish('map', 'Mappa pronta.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«map» (Claude): ha finito il turno');
    expect(sent[0]!.text).toContain('«qa» (Claude): aspetta una risposta dell\'utente: Apro il bug?');
    expect(sent[0]!.text).toContain('«fb» (Claude): aspetta un permesso');
    expect(sent[0]!.text).toContain('app_digest');
  });

  it('a turn that ends leaving a command still wakes the Regia; a quiet news answered at idle becomes a wake', async () => {
    const { w, sent, up, finish } = make();
    finish('map', 'Fatto. Ora lancia:');
    w.observe('pending:added', { id: 'cmd-a-0', chatId: 'map', type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: 'npm run check', input: {}, at: 1, command: { itemId: 'a', code: 'npm run check', lang: 'powershell' } } satisfies PendingRequest);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«map» (Claude): ha lasciato all\'utente un comando da eseguire: npm run check');
    // a question alone stays quiet; answered and the chat idle, it turns into "finished" and goes by itself
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    up({ id: 'qa', state: 'idle', lastText: 'Bug aperto.' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
    w.observe('pending:resolved', { chatId: 'qa', requestId: 'q1' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('«qa» (Claude): ha finito il turno. Ultima riga: «Bug aperto.»');
  });

  it('legacy app workers report to the shared coordinator', async () => {
    const { w, sent, up, finish } = make();
    finish('fix', 'Ramo pronto.', { space: 'app' });
    finish('app-regia', 'Fatto.', { space: 'app', appRegia: true });
    up({ id: 'fix', space: 'app', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'fix', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Unisco?', options: [], multiSelect: false }] } satisfies PendingRequest);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Unisco?');
  });

  it('a turn that ended with an error result is an error', async () => {
    const { sent, finish } = make();
    finish('qa', 'Crediti esauriti', { lastResult: { at: 5, isError: true } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent[0]!.text).toContain('«qa» (Claude): si è fermata su un errore: Crediti esauriti');
  });

  it('at most one message per chat in perChatMs: later news waits, then goes', async () => {
    const { sent, finish } = make();
    finish('qa', 'uno');
    await vi.advanceTimersByTimeAsync(1000);
    finish('qa', 'due');
    finish('qa', 'tre');
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('Ultima riga: «tre»');
    expect(sent[1]!.text).not.toContain('«due»');
  });

  it('into the Regia\'s running turn at once; while it waits for the user only a failure; the rest when it is free', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'regia', isRegia: true, state: 'running' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(1); // no new turn: it joins the one running
    up({ id: 'regia', isRegia: true, state: 'waiting', pending: 1 });
    finish('dev', 'fatto anche io');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1); // it waits for the user: no interruption
    expect(w.held()).toBe(1); // held by its gate (the e2e waits on it)
    up({ id: 'fail', state: 'running' }); up({ id: 'fail', state: 'error', lastError: 'ECONNRESET' });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(2); // a failure goes at once
    expect(sent[1]!.text).toContain('ECONNRESET');
    expect(sent[1]!.text).not.toContain('fatto anche io');
    up({ id: 'regia', isRegia: true, state: 'idle', pending: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(3);
  });

  it('a Cursor Regia (no message mid-turn) gets nothing while it works', async () => {
    const { sent, up, finish } = make();
    up({ id: 'regia', isRegia: true, state: 'running', harness: 'cursor' });
    up({ id: 'fail', state: 'running' }); up({ id: 'fail', state: 'error', lastError: 'x' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([]);
    up({ id: 'regia', isRegia: true, state: 'idle', harness: 'cursor' });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(1);
  });

  it('a closed Regia is woken (the message resumes it)', async () => {
    const { sent, up, finish } = make();
    up({ id: 'regia', isRegia: true, state: 'closed' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
  });

  it('nothing when off, without a Regia, for the Regia itself, a hand-off turn or an archived chat', async () => {
    const off = make({ enabled: false });
    off.finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(2000);
    expect(off.sent).toEqual([]);

    const { w, sent, up, finish } = make();
    finish('regia', 'la Regia ha finito', { isRegia: true });
    up({ id: 'h', state: 'running', handoffBusy: true });
    up({ id: 'h', state: 'idle', handoffBusy: true, lastText: 'passaggio scritto' });
    finish('arch', 'x');
    up({ id: 'arch', state: 'closed', closedAt: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
    expect(w.queued()).toEqual([]);

    const none = new RegiaWake({ send: async () => { throw new Error('no'); }, enabled: () => true, groupMs: 10 });
    none.observe('chat:updated', chat({ id: 'qa', state: 'running' }));
    none.observe('chat:updated', chat({ id: 'qa', state: 'idle' }));
    expect(none.queued()).toEqual([]);
  });

  it('a Regia that did not change since the app started is found in the chat list', async () => {
    const sent: string[] = [];
    const w = new RegiaWake({ send: async id => { sent.push(id); }, enabled: () => true, groupMs: 10, list: () => [chat({ id: 'regia', isRegia: true, state: 'idle' })] });
    w.observe('chat:updated', chat({ id: 'qa', state: 'running' }));
    w.observe('chat:updated', chat({ id: 'qa', state: 'idle', lastText: 'fatto' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual(['regia']);
  });

  it('a turn the user stopped himself is not told', async () => {
    const { sent, finish } = make();
    finish('qa', 'interrotto', { lastResult: { at: 7, isError: false, interrupted: true } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
  });

  it('an engine that boots and goes idle ran no turn: nothing told (a new chat, a reopen, a chat leaving for the CPU queue)', async () => {
    const { sent, up, finish } = make();
    up({ id: 'os', state: 'starting' });
    up({ id: 'os', state: 'idle' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
    // its first real turn still is
    finish('os', 'Fatto.');
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(1);
  });

  it('a hand-off turn is not a turn of the chat', async () => {
    const { sent, up } = make();
    up({ id: 'qa', state: 'idle' });
    up({ id: 'qa', state: 'idle', handoffBusy: true });
    up({ id: 'qa', state: 'running', handoffBusy: true });
    up({ id: 'qa', state: 'running' });
    up({ id: 'qa', state: 'idle', lastText: 'PASSAGGIO>>>' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
  });

  it('a question answered before the news went is told as what the chat did next', async () => {
    const { w, sent, up } = make();
    up({ id: 'regia', isRegia: true, state: 'running' });
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    w.observe('pending:resolved', { chatId: 'qa', requestId: 'q1' });
    up({ id: 'qa', state: 'idle', lastText: 'Bug aperto.' });
    up({ id: 'regia', isRegia: true, state: 'idle' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«qa» (Claude): ha finito il turno. Ultima riga: «Bug aperto.»');
    expect(sent[0]!.text).not.toContain('aspetta');
  });

  it('an update of an idle Regia does not cut the grouping window short', async () => {
    const { sent, up, finish } = make();
    finish('a', 'uno');
    await vi.advanceTimersByTimeAsync(300);
    up({ id: 'regia', isRegia: true, state: 'idle', contextTokens: 5000 });
    await vi.advanceTimersByTimeAsync(300);
    finish('b', 'due');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«a»');
    expect(sent[0]!.text).toContain('«b»');
  });

  it('long last lines are cut', () => {
    expect(wakeLine({ chatId: 'a', title: 'A', harness: 'claude', kind: 'done', detail: 'x'.repeat(500), at: 0 }).length).toBeLessThan(260);
  });

  it('several Regie (ADR 0021): the news go to the first one in tab order, also after it was replaced (Pulisci)', async () => {
    const sent: string[] = [];
    // "nuova" replaced the first Regia: it came later (after "ricerca") but keeps the first tab's regiaSince
    const list = [chat({ id: 'ricerca', isRegia: true, regiaSince: 2, state: 'idle' }), chat({ id: 'nuova', isRegia: true, regiaSince: 1, state: 'idle' })];
    const w = new RegiaWake({ send: async id => { sent.push(id); }, enabled: () => true, groupMs: 10, list: () => list });
    w.observe('chat:updated', list[0]!);
    w.observe('chat:updated', chat({ id: 'w', state: 'running' }));
    w.observe('chat:updated', chat({ id: 'w', state: 'idle', lastText: 'fatto' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual(['nuova']);
  });
});
