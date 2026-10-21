// Unit tests of main/chats/orchestrator-wake.ts ("Eventi all'Orchestrator"): a work chat that finishes, fails, waits for an answer
// or leaves a command is told to the Orchestrator in one grouped message labelled as the app's; a chat at most once every
// perChatMs; into the Orchestrator's running turn, never while it waits for the user (a failure only); off with the setting;
// the Orchestrator's own turns never.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import { APP_EVENT_LABEL, OrchestratorWake, wakeLine, type WakeSubmissionReceipt } from '../../src/main/chats/orchestrator-wake';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

function make(opts: { enabled?: boolean } = {}) {
  const sent: { chatId: string; text: string }[] = [];
  let on = opts.enabled ?? true;
  const w = new OrchestratorWake({ send: async (chatId, text) => { sent.push({ chatId, text }); }, enabled: () => on, groupMs: 1000, perChatMs: 10_000, now: () => Date.now() });
  const up = (p: Partial<ChatSummary> & { id: string }) => w.observe('chat:updated', chat(p));
  up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', state: 'idle' });
  /** a work chat's whole turn */
  const finish = (id: string, lastText: string, extra: Partial<ChatSummary> = {}) => { up({ id, state: 'running' }); up({ id, state: 'idle', lastText, ...extra }); };
  return { w, sent, up, finish, setOn: (v: boolean) => { on = v; } };
}

describe('OrchestratorWake', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps two user messages with distinct event IDs and retries a failed delivery', async () => {
    let attempts = 0;
    const w = new OrchestratorWake({ enabled: () => true, groupMs: 10, perChatMs: 20,
      send: async () => { attempts++; if (attempts === 1) throw new Error('temporary failure'); } });
    w.observe('chat:updated', chat({ id: 'o', isOrchestrator: true }));
    w.observe('chat:updated', chat({ id: 'c', state: 'running' }));
    for (const text of ['first instruction', 'second instruction']) w.userMessage({ chatId: 'c', title: 'C', role: null, parentTitle: null, text });
    expect(new Set(w.queued().map(event => event.eventId)).size).toBe(2);
    w.observe('chat:updated', chat({ id: 'c', state: 'idle' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);
    expect(w.queued()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(20);
    expect(attempts).toBe(2);
    expect(w.queued()).toHaveLength(0);
    w.stop();
  });

  it('waits for an actual submission receipt after queue admission and preserves full user instructions', async () => {
    const receipts: WakeSubmissionReceipt[] = [], sent: string[] = [];
    const w = new OrchestratorWake({ enabled: () => true, receiptAcknowledgement: true, groupMs: 10, perChatMs: 20,
      send: async (_id, text, receipt) => { sent.push(text); receipts.push(receipt!); } });
    w.observe('chat:updated', chat({ id: 'o', isOrchestrator: true }));
    w.observe('chat:updated', chat({ id: 'c', state: 'running' }));
    const full = `${'x'.repeat(2500)} IMPORTANT FINAL CONSTRAINT`;
    w.userMessage({ eventId: 'event-1', seq: 1, chatId: 'c', title: 'C', role: null, parentTitle: null, text: full });
    w.observe('chat:updated', chat({ id: 'c', state: 'idle' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(full);
    expect(w.queued()).toHaveLength(2);
    receipts[0]!.failed(new Error('queued engine failed'));
    await vi.advanceTimersByTimeAsync(20);
    expect(sent).toHaveLength(2);
    expect(w.queued()).toHaveLength(2);
    receipts[1]!.submitted(); receipts[1]!.submitted();
    expect(w.queued()).toHaveLength(0);
    w.stop();
  });

  it('a finished chat wakes the Orchestrator with one labelled line, after the grouping window', async () => {
    const { sent, finish } = make();
    finish('qa', 'Report pronto: 8 test su 9.');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('orchestrator');
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

  it('a question, a permission or a command alone never wakes the Orchestrator: it goes with the next finished news', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', { id: 'p1', chatId: 'fb', type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: {}, at: 1 } satisfies PendingRequest);
    // the Orchestrator going idle again does not send quiet news either
    up({ id: 'orchestrator', isOrchestrator: true, state: 'running' });
    up({ id: 'orchestrator', isOrchestrator: true, state: 'idle' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    expect(w.queued().map(e => e.kind).sort()).toEqual(['permission', 'question']);
    finish('map', 'Mappa pronta.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«map» (Claude): ha finito il turno');
    expect(sent[0]!.text).toContain('«qa» (Claude): aspetta una risposta dell\'utente: Apro il bug?');
    expect(sent[0]!.text).toContain('«fb» (Claude): aspetta un permesso');
    expect(sent[0]!.text).not.toContain('app_digest'); // what to do with the news is in its rules (WAKE_RULE), once per session
  });

  it('a turn that ends leaving a command still wakes the Orchestrator; a quiet news answered at idle becomes a wake', async () => {
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

  it('a chat on the app\'s code reports to the shared coordinator like any other', async () => {
    const { w, sent, up, finish } = make();
    finish('fix', 'Ramo pronto.', { cwd: 'C:/repo' });
    up({ id: 'fix', cwd: 'C:/repo', state: 'running' });
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

  it('into the Orchestrator\'s running turn at once; while it waits for the user only a failure; the rest when it is free', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'orchestrator', isOrchestrator: true, state: 'running' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(1); // no new turn: it joins the one running
    up({ id: 'orchestrator', isOrchestrator: true, state: 'waiting', pending: 1 });
    finish('dev', 'fatto anche io');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1); // it waits for the user: no interruption
    expect(w.held()).toBe(1); // held by its gate (the e2e waits on it)
    up({ id: 'fail', state: 'running' }); up({ id: 'fail', state: 'error', lastError: 'ECONNRESET' });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(2); // a failure goes at once
    expect(sent[1]!.text).toContain('ECONNRESET');
    expect(sent[1]!.text).not.toContain('fatto anche io');
    up({ id: 'orchestrator', isOrchestrator: true, state: 'idle', pending: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(3);
  });

  it('a Cursor Orchestrator (no message mid-turn) gets nothing while it works', async () => {
    const { sent, up, finish } = make();
    up({ id: 'orchestrator', isOrchestrator: true, state: 'running', harness: 'cursor' });
    up({ id: 'fail', state: 'running' }); up({ id: 'fail', state: 'error', lastError: 'x' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual([]);
    up({ id: 'orchestrator', isOrchestrator: true, state: 'idle', harness: 'cursor' });
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toHaveLength(1);
  });

  it('a closed Orchestrator is woken (the message resumes it)', async () => {
    const { sent, up, finish } = make();
    up({ id: 'orchestrator', isOrchestrator: true, state: 'closed' });
    finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
  });

  it('nothing when off, without a Orchestrator, for the Orchestrator itself, a hand-off turn or an archived chat', async () => {
    const off = make({ enabled: false });
    off.finish('qa', 'fatto');
    await vi.advanceTimersByTimeAsync(2000);
    expect(off.sent).toEqual([]);

    const { w, sent, up, finish } = make();
    finish('orchestrator', 'l’Orchestrator ha finito', { isOrchestrator: true });
    up({ id: 'h', state: 'running', handoffBusy: true });
    up({ id: 'h', state: 'idle', handoffBusy: true, lastText: 'passaggio scritto' });
    finish('arch', 'x');
    up({ id: 'arch', state: 'closed', closedAt: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
    expect(w.queued()).toEqual([]);

    const none = new OrchestratorWake({ send: async () => { throw new Error('no'); }, enabled: () => true, groupMs: 10 });
    none.observe('chat:updated', chat({ id: 'qa', state: 'running' }));
    none.observe('chat:updated', chat({ id: 'qa', state: 'idle' }));
    expect(none.queued()).toEqual([]);
  });

  it('a Orchestrator that did not change since the app started is found in the chat list', async () => {
    const sent: string[] = [];
    const w = new OrchestratorWake({ send: async id => { sent.push(id); }, enabled: () => true, groupMs: 10, list: () => [chat({ id: 'orchestrator', isOrchestrator: true, state: 'idle' })] });
    w.observe('chat:updated', chat({ id: 'qa', state: 'running' }));
    w.observe('chat:updated', chat({ id: 'qa', state: 'idle', lastText: 'fatto' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual(['orchestrator']);
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
    up({ id: 'orchestrator', isOrchestrator: true, state: 'running' });
    up({ id: 'qa', state: 'running' });
    w.observe('pending:added', { id: 'q1', chatId: 'qa', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 1, questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }] } satisfies PendingRequest);
    w.observe('pending:resolved', { chatId: 'qa', requestId: 'q1' });
    up({ id: 'qa', state: 'idle', lastText: 'Bug aperto.' });
    up({ id: 'orchestrator', isOrchestrator: true, state: 'idle' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('«qa» (Claude): ha finito il turno. Ultima riga: «Bug aperto.»');
    expect(sent[0]!.text).not.toContain('aspetta');
  });

  it('an update of an idle Orchestrator does not cut the grouping window short', async () => {
    const { sent, up, finish } = make();
    finish('a', 'uno');
    await vi.advanceTimersByTimeAsync(300);
    up({ id: 'orchestrator', isOrchestrator: true, state: 'idle', contextTokens: 5000 });
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

  it('the news go to the open Orchestrator, also after it was replaced (Pulisci)', async () => {
    const sent: string[] = [];
    // "nuova" replaced "vecchia", which is closed now
    const list = [chat({ id: 'vecchia', isOrchestrator: true, state: 'closed', closedAt: 1 }), chat({ id: 'nuova', isOrchestrator: true, state: 'idle' })];
    const w = new OrchestratorWake({ send: async id => { sent.push(id); }, enabled: () => true, groupMs: 10, list: () => list });
    w.observe('chat:updated', list[0]!);
    w.observe('chat:updated', chat({ id: 'w', state: 'running' }));
    w.observe('chat:updated', chat({ id: 'w', state: 'idle', lastText: 'fatto' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual(['nuova']);
  });
});

describe('the user writes in a work chat (ADR 0083)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('quiet news with his words, role and parent: no wake by itself, rides along with the next delivery, held meanwhile, kept beside the chat\'s finish', async () => {
    const { w, sent, up } = make();
    up({ id: 'strat', title: 'Piano', state: 'idle' });
    up({ id: 'kid', title: 'Log', state: 'idle', parentId: 'strat', agent: { id: 'scout', name: 'Scout' } as ChatSummary['agent'] });
    await vi.advanceTimersByTimeAsync(5000);
    sent.length = 0;
    w.userMessage({ chatId: 'kid', title: 'Log', role: 'Scout', parentTitle: 'Piano', text: `Solo marzo, per favore. ${'y'.repeat(500)}` });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
    expect(w.heldNews().map(h => h.kind)).toEqual(['started', 'user-message']);
    const kidRow = { title: 'Log', parentId: 'strat', agent: { id: 'scout', name: 'Scout' } as ChatSummary['agent'] };
    up({ id: 'kid', state: 'running', ...kidRow });
    up({ id: 'kid', state: 'idle', lastText: 'testo del figlio che non deve passare', ...kidRow });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    const t = sent[0]!.text;
    expect(t).toContain("«Log» (Scout, delegata da «Piano»): l'utente ci ha scritto direttamente");
    expect(t).toContain('«Solo marzo, per favore.');
    expect(t).not.toContain('non disfare'); // the rule is in the Orchestrator's frame, not in every note
    expect(t).toContain('«Log» (Scout, delegata da «Piano»): ha finito il turno.');
    expect(t).not.toContain('testo del figlio');
    expect(t.length).toBeLessThan(1200);
    expect(w.queued()).toEqual([]);
  });

  it('a delegated chat that just finished never wakes the Orchestrator by itself (its result goes to its parent)', async () => {
    const { w, sent, up } = make();
    up({ id: 'strat', title: 'Piano', state: 'idle' });
    const kidRow = { title: 'Log', parentId: 'strat', agent: { id: 'scout', name: 'Scout' } as ChatSummary['agent'] };
    up({ id: 'kid', state: 'idle', ...kidRow });
    await vi.advanceTimersByTimeAsync(5000);
    sent.length = 0;
    up({ id: 'kid', state: 'running', ...kidRow });
    up({ id: 'kid', state: 'idle', lastText: 'fatto', ...kidRow });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
    expect(w.queued().map(e => e.kind)).toEqual(['done']); // it rides along with the next news
  });

  it('a chat that gave its result with agent_report in the turn adds no "finished" (the result already went)', async () => {
    const { w, sent, up } = make();
    up({ id: 'a', title: 'Ordini', state: 'idle' });
    await vi.advanceTimersByTimeAsync(5000);
    sent.length = 0;
    up({ id: 'a', state: 'running' });
    up({ id: 'a', state: 'idle', lastText: 'ecco il risultato', run: { report: { at: Date.now(), outcome: 'done', verified: 'yes', summary: 's', via: 'agent_report' } } as unknown as ChatSummary['run'] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
    expect(w.queued()).toEqual([]);
    // a run-report block in the reply reached no one: its "finished" still goes
    up({ id: 'a', state: 'running' });
    up({ id: 'a', state: 'idle', lastText: 'run-report', lastResult: { at: Date.now() } as ChatSummary['lastResult'], run: { report: { at: Date.now() + 1, outcome: 'done', verified: 'yes', summary: 's' } } as unknown as ChatSummary['run'] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });

  it('nothing for the Orchestrator\'s own chat, nor with the events off', async () => {
    const { w, setOn } = make();
    w.userMessage({ chatId: 'orchestrator', title: 'Orchestrator', role: null, parentTitle: null, text: 'ciao' });
    expect(w.queued()).toEqual([]);
    setOn(false);
    w.userMessage({ chatId: 'x', title: 'x', role: null, parentTitle: null, text: 'ciao' });
    expect(w.queued()).toEqual([]);
  });
});

describe('OrchestratorWake: quiet results and app-started chats (token plan 2026-10-20)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a root chat\'s clean result is quiet: no turn of its own, it rides into the next one with its summary', async () => {
    const { w, sent, up, finish } = make();
    up({ id: 'fix', title: 'App · fix', state: 'running' });
    expect(w.cleanReport({ chatId: 'fix', title: 'App · fix', role: 'Artisan', summary: 'Fix su main, 14 test verdi' })).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    expect(w.heldNews()).toHaveLength(1);
    // the user writes: the Orchestrator works, the result goes into its turn
    up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', state: 'running' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('- «App · fix» (Artisan): ha consegnato: «Fix su main, 14 test verdi»');
    // its own turn end adds nothing (the report was its result)
    finish('other', 'x');
    expect(w.queued().some(e => e.chatId === 'fix')).toBe(false);
  });

  it('a clean report keeps its own slot: a later error of the same chat never hides it', async () => {
    const { w, up, sent } = make();
    up({ id: 'fix', title: 'App · fix', state: 'running' });
    w.cleanReport({ chatId: 'fix', title: 'App · fix', role: 'Artisan', summary: 'Fix su main' });
    up({ id: 'fix', title: 'App · fix', state: 'error', lastError: 'boom' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('ha consegnato: «Fix su main»');
    expect(sent[0]!.text).toContain('si è fermata su un errore: boom');
    expect(w.queued()).toEqual([]);
  });

  it('off or without an Orchestrator it is not taken: the caller sends the result as before', () => {
    const { w, setOn } = make();
    setOn(false);
    expect(w.cleanReport({ chatId: 'fix', title: 'fix', role: 'Artisan', summary: 's' })).toBe(false);
  });

  it('a chat the app started (a sampled review) never wakes it when it finishes; a failure still does', async () => {
    const { sent, up } = make();
    const run = { runId: 'r', agentId: 'sentinel', version: 1, startedAt: 0, startedBy: 'app' } as unknown as ChatSummary['run'];
    up({ id: 'rev', state: 'running', run });
    up({ id: 'rev', state: 'idle', lastText: 'verdetto', run });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
    up({ id: 'rev', state: 'running', run });
    up({ id: 'rev', state: 'error', lastError: 'boom', run });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });
});
