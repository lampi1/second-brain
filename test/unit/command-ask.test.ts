// Unit tests of "Comando da eseguire": the rule that picks the shell blocks left for the user (shared/command-ask.ts:
// the last block of the turn's last message, or one the text asks to run; never an example nor the agent's own past
// run) and the service that turns them into requests (main/run/asks.ts: opened when the turn ends, gone when the
// block runs, on "Non serve", when the chat goes on, is archived or removed).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, EventMap, PendingRequest } from '../../src/shared/contract';
import { askedBlocks } from '../../src/shared/command-ask';
import { CommandAsks } from '../../src/main/run/asks';
import { APP_EVENT_LABEL } from '../../src/main/chats/orchestrator-wake';

const fence = (lang: string, code: string) => '```' + lang + '\n' + code + '\n```';

describe('askedBlocks: which blocks ask the user to run them', () => {
  it('the last block of the message, with nothing or a short line after it', () => {
    expect(askedBlocks(`Fatto. Riavvia il servizio:\n\n${fence('powershell', 'Restart-Service x')}`)).toEqual([{ index: 0, lang: 'powershell', code: 'Restart-Service x', lead: 'Fatto. Riavvia il servizio:' }]);
    expect(askedBlocks(`Prova:\n${fence('bash', 'npm test')}\nPoi dimmi com'è andata.`)).toHaveLength(1);
  });

  it('a block in the middle only when the text right before it asks to run it', () => {
    const text = [
      'Ecco come funziona il parser:', fence('bash', 'echo esempio'), 'Ora lancia questo per verificare:', fence('powershell', 'Get-Date'),
      'Il risultato dovrebbe essere la data di oggi, poi controlliamo insieme il resto della configurazione e i log del servizio.',
    ].join('\n');
    expect(askedBlocks(text).map(b => b.code)).toEqual(['Get-Date']);
  });

  it('no example in the middle of an explanation, no block followed by more text', () => {
    const text = [
      'Il comando si scrive così:', fence('bash', 'git log --oneline'),
      'e mostra un commit per riga. Il resto della spiegazione continua qui sotto, con altri dettagli sul formato e sulle opzioni utili.',
    ].join('\n');
    expect(askedBlocks(text)).toEqual([]);
  });

  it('never an example nor what the agent already ran, even as the last block', () => {
    expect(askedBlocks(`Ad esempio:\n${fence('bash', 'ls -la')}`)).toEqual([]);
    expect(askedBlocks(`Ho eseguito i test con:\n${fence('powershell', 'npm test')}`)).toEqual([]);
    expect(askedBlocks(`For example:\n${fence('sh', 'make')}`)).toEqual([]);
  });

  it('only blocks Esegui can run: shell languages, not empty, not too long', () => {
    expect(askedBlocks(`Configura così:\n${fence('json', '{ "a": 1 }')}`)).toEqual([]);
    expect(askedBlocks(`Lancia:\n${fence('', 'Get-Date')}`)).toEqual([]);
    expect(askedBlocks(`Lancia:\n${fence('powershell', '   ')}`)).toEqual([]);
    expect(askedBlocks(`Lancia:\n${fence('powershell', 'x'.repeat(9000))}`)).toEqual([]);
    expect(askedBlocks('Nessun blocco qui.')).toEqual([]);
  });

  it('the last block counts only if it is the last of any language', () => {
    expect(askedBlocks(`Comando:\n${fence('bash', 'npm run build')}\nE il file:\n${fence('json', '{}')}`)).toEqual([]);
  });

  it('code normalized like the runner (CRLF, trailing blanks) and at most three per message', () => {
    expect(askedBlocks('Lancia:\r\n```powershell\r\nGet-Date  \r\n\r\n```')[0]?.code).toBe('Get-Date');
    const many = [1, 2, 3, 4].map(i => `Esegui il passo ${i}:\n${fence('powershell', `echo ${i}`)}`).join('\n\n');
    expect(askedBlocks(many).map(b => b.code)).toEqual(['echo 2', 'echo 3', 'echo 4']);
  });
});

// ---------------------------------------------------------------- the service

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: 'Lavoro', cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const asst = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text });

function make(ran: (chatId: string, itemId: string, code: string) => boolean = () => false) {
  const events: { ch: string; p: unknown }[] = [];
  const asked: PendingRequest[] = [];
  const s = new CommandAsks({
    emit: (ch, p) => { events.push({ ch, p }); },
    ran, onAsk: r => asked.push(r), settleMs: 10, now: () => 1000,
  });
  const ev = <K extends keyof EventMap>(ch: K, p: EventMap[K]) => s.observe(ch, p);
  /** a whole turn: running, the items, idle, then the settle delay */
  const turn = (id: string, items: ChatItem[]) => {
    ev('chat:updated', chat({ id, state: 'running' }));
    for (const it of items) ev('chat:item', { chatId: id, item: it });
    ev('chat:updated', chat({ id, state: 'idle' }));
    vi.advanceTimersByTime(20);
  };
  return { s, events, asked, ev, turn };
}

describe('CommandAsks: a block left for the user is an open request', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('opens one request when the turn ends, with the block and a notification', () => {
    vi.useFakeTimers();
    const { s, events, asked, turn } = make();
    turn('c1', [asst('a1', `Fatto. Ora lancia:\n${fence('powershell', 'npm run check')}`)]);
    expect(s.pending()).toHaveLength(1);
    const r = s.pending()[0]!;
    expect(r).toMatchObject({ chatId: 'c1', type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: 'npm run check', command: { itemId: 'a1', code: 'npm run check', lang: 'powershell' } });
    expect(events.map(e => e.ch)).toEqual(['pending:added']);
    expect(asked).toHaveLength(1);
  });

  it('nothing while the turn runs, nothing when the agent went on with a tool after the block', () => {
    vi.useFakeTimers();
    const { s, ev, turn } = make();
    ev('chat:updated', chat({ id: 'c1', state: 'running' }));
    ev('chat:item', { chatId: 'c1', item: asst('a1', `Lancia:\n${fence('bash', 'ls')}`) });
    vi.advanceTimersByTime(50);
    expect(s.pending()).toEqual([]);
    ev('chat:item', { chatId: 'c1', item: { kind: 'tool', id: 't1', at: 2, name: 'Bash', summary: 'ls', input: {}, status: 'ok' } });
    ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
    vi.advanceTimersByTime(20);
    expect(s.pending()).toEqual([]);
    // only the last message of the turn counts: an earlier one with a block, then a final one without
    turn('c2', [asst('a2', `Lancia:\n${fence('bash', 'ls')}`), { kind: 'tool', id: 't2', at: 2, name: 'Read', summary: 'x', input: {}, status: 'ok' }, asst('a3', 'Ho finito.')]);
    expect(s.pending()).toEqual([]);
  });

  it('a production block says why; a block already run opens nothing', () => {
    vi.useFakeTimers();
    const { s, turn } = make((_c, itemId) => itemId === 'a9');
    turn('c1', [asst('a1', `Questo lo lanci tu:\n${fence('bash', 'az webapp restart -n app-prod -g rg-prod')}`)]);
    expect(s.pending()[0]?.command?.prod).toMatch(/Azure/);
    turn('c2', [asst('a9', `Lancia:\n${fence('bash', 'ls')}`)]);
    expect(s.pending().filter(p => p.chatId === 'c2')).toEqual([]);
  });

  it('gone when the block runs (only that block) or on "Non serve"', () => {
    vi.useFakeTimers();
    const { s, events, turn } = make();
    turn('c1', [asst('a1', `Esegui:\n${fence('powershell', 'echo 1')}\n\nPoi esegui:\n${fence('powershell', 'echo 2')}`)]);
    expect(s.pending()).toHaveLength(2);
    s.ran('c1', 'a1', 'echo 9'); // another code: nothing
    expect(s.pending()).toHaveLength(2);
    s.ran('c1', 'a1', 'echo 1');
    expect(s.pending().map(p => p.detail)).toEqual(['echo 2']);
    const id = s.pending()[0]!.id;
    expect(s.has('c1', id)).toBe(true);
    s.dismiss('c1', id);
    expect(s.pending()).toEqual([]);
    expect(events.filter(e => e.ch === 'pending:resolved')).toHaveLength(2);
    expect(() => s.dismiss('c1', id)).toThrow(/non è più aperta/);
  });

  it('gone when the chat goes on: a new message, a new turn, archived, removed', () => {
    vi.useFakeTimers();
    const { s, ev, turn } = make();
    const block = () => asst(`a${Math.random()}`, `Lancia:\n${fence('bash', 'ls')}`);
    turn('c1', [block()]);
    ev('chat:item', { chatId: 'c1', item: { kind: 'user', id: 'u1', at: 3, text: 'fatto' } });
    expect(s.pending()).toEqual([]);
    turn('c1', [block()]);
    ev('chat:updated', chat({ id: 'c1', state: 'running' }));
    expect(s.pending()).toEqual([]);
    turn('c1', [block()]);
    ev('chat:updated', chat({ id: 'c1', state: 'closed', closedAt: 5 }));
    expect(s.pending()).toEqual([]);
    turn('c1', [block()]);
    ev('chat:removed', { chatId: 'c1' });
    expect(s.pending()).toEqual([]);
  });

  it("the app's own news to the Orchestrator does not take away the command the Orchestrator left", () => {
    vi.useFakeTimers();
    const { s, ev, turn } = make();
    turn('orchestrator', [asst('r1', `Lancia:
${fence('powershell', 'Get-Date')}`)]);
    expect(s.pending()).toHaveLength(1);
    ev('chat:item', { chatId: 'orchestrator', item: { kind: 'user', id: 'u1', at: 3, text: `${APP_EVENT_LABEL}
Novità dalle chat di lavoro:` } });
    turn('orchestrator', [asst('r2', 'Ok, niente da dire all\'utente.')]);
    expect(s.pending().map(p => p.detail)).toEqual(['Get-Date']);
    // the user's own message does
    ev('chat:item', { chatId: 'orchestrator', item: { kind: 'user', id: 'u2', at: 4, text: 'fatto' } });
    expect(s.pending()).toEqual([]);
  });

  it('a message of notes only (Mandato, Non serve: ADR 0038) does not take away the other commands', () => {
    vi.useFakeTimers();
    const { s, ev, turn } = make();
    turn('a', [asst('m1', `Manda il testo e poi lancia:
${fence('powershell', 'Get-Date')}`)]);
    expect(s.pending()).toHaveLength(1);
    ev('chat:item', { chatId: 'a', item: { kind: 'user', id: 'u1', at: 3, text: '[Mandato] Ciao Marco,\n[Copiato] Ciao' } });
    turn('a', [asst('m2', 'Segnato.')]);
    expect(s.pending().map(p => p.detail)).toEqual(['Get-Date']);
    // a typed message with notes riding on it is the user's own: it does
    ev('chat:item', { chatId: 'a', item: { kind: 'user', id: 'u2', at: 4, text: 'fatto\n\n[Mandato] Ciao' } });
    expect(s.pending()).toEqual([]);
  });

  it('a hand-off right after the turn: the command is read before it, stays through it, the note is never read', () => {
    vi.useFakeTimers();
    const { s, ev } = make();
    ev('chat:updated', chat({ id: 'c1', state: 'running' }));
    ev('chat:item', { chatId: 'c1', item: asst('a1', `Ora lancia:\n${fence('powershell', 'npm run check')}`) });
    ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
    // the automatic hand-off starts before the settle delay (manager maybeAutoHandoff)
    ev('chat:updated', chat({ id: 'c1', state: 'idle', handoffBusy: true }));
    expect(s.pending().map(p => p.detail)).toEqual(['npm run check']);
    ev('chat:updated', chat({ id: 'c1', state: 'running', handoffBusy: true }));
    ev('chat:item', { chatId: 'c1', item: asst('h1', `<<<PASSAGGIO\nProssimo passo:\n${fence('bash', 'npm test')}\nPASSAGGIO>>>`) });
    ev('chat:updated', chat({ id: 'c1', state: 'running' })); // handoffBusy goes first
    ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
    vi.advanceTimersByTime(20);
    expect(s.pending().map(p => p.detail)).toEqual(['npm run check']);
    // the next real turn is the chat going on
    ev('chat:updated', chat({ id: 'c1', state: 'running' }));
    expect(s.pending()).toEqual([]);
  });

  it('a hand-off turn and a chat that only started open nothing', () => {
    vi.useFakeTimers();
    const { s, ev } = make();
    ev('chat:updated', chat({ id: 'c1', state: 'starting' }));
    ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
    vi.advanceTimersByTime(20);
    ev('chat:updated', chat({ id: 'c1', state: 'running', handoffBusy: true }));
    ev('chat:item', { chatId: 'c1', item: asst('h1', `Prossimo passo:\n${fence('bash', 'npm test')}`) });
    ev('chat:updated', chat({ id: 'c1', state: 'idle', handoffBusy: true }));
    vi.advanceTimersByTime(20);
    expect(s.pending()).toEqual([]);
  });

  it('a late streaming update of the last message after the turn ended is read', () => {
    vi.useFakeTimers();
    const { s, ev } = make();
    ev('chat:updated', chat({ id: 'c1', state: 'running' }));
    ev('chat:item', { chatId: 'c1', item: asst('a1', 'Ora lancia') });
    ev('chat:updated', chat({ id: 'c1', state: 'idle' }));
    ev('chat:item', { chatId: 'c1', item: asst('a1', `Ora lancia:\n${fence('powershell', 'Get-Date')}`) });
    vi.advanceTimersByTime(20);
    expect(s.pending().map(p => p.detail)).toEqual(['Get-Date']);
  });
});
