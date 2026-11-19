// One question, one row, one answer (ADR 0326), in the ChatManager: the user's own words reach the chat with the app's
// note; the same question asked again before the chat replied to them is answered by the app and never shown; the Orchestrator
// never shows as its own a question a work chat has open; a message that asks about a question is never passed to the
// work chat as its answer. A fake engine, temp folders only.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, ChatItem, PendingRequest } from '../../../src/shared/contract';
import { ChatManager } from '../../../src/main/chats/manager';
import { ASK_AGAIN_MAX } from '../../../src/main/chats/manager-requests';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { EXPLAINED, WORDS_NOTE } from '../../../src/shared/ask-once';

const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-askonce-')); roots.push(d); return d; };

interface World { sent: string[]; answers: { id: string; answer: Answer }[]; sink?: SessionSink; added: string[]; relay: boolean }
function manager(w: World): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit: (ch: string, p: unknown) => { if (ch === 'pending:added') w.added.push((p as { id: string }).id); } }, coldEveryMs: 0, relayPanel: () => w.relay,
    sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => {
      w.sink = s;
      return {
        harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { if (!o.sessionId) s.changed({ sessionId: SESSION }); s.changed({ state: 'idle' }); },
        send(text: string) { w.sent.push(text); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (id: string, answer: Answer) => { w.answers.push({ id, answer }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  return m;
}
const world = (): World => ({ sent: [], answers: [], added: [], relay: false });
const ask = (id: string, question: string, options = ['Sì (consigliato)', 'No']): Omit<PendingRequest, 'chatId'> => ({ id, type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: Date.now(),
  questions: [{ question, multiSelect: false, options: options.map(label => ({ label })) }] });
const words = (q: string, a: string): Answer => ({ kind: 'question', answers: { [q]: a } });
const textOf = (a: Answer, q: string): string => (a.kind === 'question' ? String(a.answers[q]) : '');
const Q = 'Faccio il merge su main?';

describe('the user answers in his own words', () => {
  it('the Orchestrator reads them with the note; the same question again is answered by the app, never shown', async () => {
    const w = world(), m = manager(w);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    w.sink!.pending(ask('q1', Q));
    await m.answer(o.id, 'q1', words(Q, 'perché su main e non su un ramo?'));
    expect(textOf(w.answers[0]!.answer, Q)).toBe(`perché su main e non su un ramo?${WORDS_NOTE}`);
    // the model asks it again, in almost the same words, before he wrote anything
    const again = 'Faccio ora il merge su main?';
    w.sink!.pending(ask('q2', again));
    expect(w.added).toEqual(['q1']);
    expect(m.pending().filter(p => p.chatId === o.id)).toEqual([]);
    expect(w.answers[1]!.id).toBe('q2');
    expect(textOf(w.answers[1]!.answer, again)).toContain('Not asked again');
    expect(textOf(w.answers[1]!.answer, again)).toContain('«perché su main e non su un ramo?»');
  });

  it('after a reply to his words the question comes back as a row; a short line is not a reply', async () => {
    const w = world(), m = manager(w);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    w.sink!.pending(ask('q1', Q));
    await m.answer(o.id, 'q1', words(Q, 'in che senso?'));
    w.sink!.item({ kind: 'assistant', id: 'a1', text: 'Te lo spiego nel riepilogo.', at: Date.now() } as ChatItem, false);
    w.sink!.pending(ask('q2', Q));
    expect(w.added).toEqual(['q1']); // answered by the app: no reply to «in che senso?» yet
    const reply = 'Intendo questo: con Sì il lavoro arriva a tutti oggi, con No resta sul ramo finché non lo guardi. Esempio: la correzione del bottone.';
    expect(reply.length).toBeGreaterThanOrEqual(EXPLAINED);
    w.sink!.item({ kind: 'assistant', id: 'a2', text: reply, at: Date.now() } as ChatItem, false);
    w.sink!.pending(ask('q3', Q));
    expect(w.added).toEqual(['q1', 'q3']); // explained first: the same question, his to answer with a click
  });

  it('another question is shown; after his next message the same one may be asked', async () => {
    const w = world(), m = manager(w);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    w.sink!.pending(ask('q1', Q));
    await m.answer(o.id, 'q1', words(Q, 'spiegami'));
    w.sink!.pending(ask('q2', 'Cancello il ramo vecchio dopo il lavoro?'));
    expect(w.added).toEqual(['q1', 'q2']);
    await m.answer(o.id, 'q2', words('Cancello il ramo vecchio dopo il lavoro?', 'No'));
    // an option he picked ends the memory of his words: nothing is held back after it
    w.sink!.pending(ask('q3', Q));
    expect(w.added).toEqual(['q1', 'q2', 'q3']);
    await m.answer(o.id, 'q3', words(Q, 'non ho capito'));
    await m.send(o.id, 'ok ora ho capito, richiedimelo');
    w.sink!.pending(ask('q4', Q));
    expect(w.added).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  it('a chat that keeps asking is not stuck: after the limit the question shows as it is', async () => {
    const w = world(), m = manager(w);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    w.sink!.pending(ask('q0', Q));
    await m.answer(o.id, 'q0', words(Q, 'boh'));
    for (let i = 1; i <= ASK_AGAIN_MAX; i++) w.sink!.pending(ask(`r${i}`, Q));
    expect(w.added).toEqual(['q0']);
    w.sink!.pending(ask('shown', Q));
    expect(w.added).toEqual(['q0', 'shown']);
  });

  it('an option he picked reaches the chat as it is, and the same question later is a new question', async () => {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Applico anche il prossimo file?'));
    await m.answer(chat.id, 'q1', words('Applico anche il prossimo file?', 'Sì (consigliato)'));
    expect(w.answers[0]!.answer).toEqual(words('Applico anche il prossimo file?', 'Sì (consigliato)'));
    w.sink!.pending(ask('q2', 'Applico anche il prossimo file?'));
    expect(w.added).toEqual(['q1', 'q2']); // never answered for him: each file is his own yes
  });

  it('his words never answer the next decision: after work or the end of the turn, a like question is his again', async () => {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    const COMMIT = 'Faccio il commit delle modifiche su questo ramo?';
    // one word changed is another question, at once
    w.sink!.pending(ask('q1', COMMIT));
    await m.answer(chat.id, 'q1', words(COMMIT, 'va bene, fallo'));
    w.sink!.pending(ask('q2', 'Faccio il push delle modifiche su questo ramo?'));
    expect(w.added).toEqual(['q1', 'q2']);
    await m.answer(chat.id, 'q2', words('Faccio il push delle modifiche su questo ramo?', 'No'));
    // the very same question after the chat worked on his words: a new decision
    w.sink!.pending(ask('q3', COMMIT));
    await m.answer(chat.id, 'q3', words(COMMIT, 'va bene, fallo'));
    w.sink!.item({ kind: 'tool', id: 't1', name: 'Bash', input: { command: 'git commit -m x' }, status: 'ok', at: Date.now() } as ChatItem, false);
    w.sink!.pending(ask('q4', COMMIT));
    expect(w.added).toEqual(['q1', 'q2', 'q3', 'q4']);
    // a brief is no work: the same question right after it is still held
    await m.answer(chat.id, 'q4', words(COMMIT, 'cioè?'));
    w.sink!.item({ kind: 'tool', id: 't2', name: 'mcp__second-brain__show_ui', input: {}, status: 'ok', at: Date.now() } as ChatItem, false);
    w.sink!.pending(ask('q5', COMMIT));
    expect(w.added).toEqual(['q1', 'q2', 'q3', 'q4']);
    // the turn ended: the next turn's question is shown
    w.sink!.item({ kind: 'result', id: 'r1', isError: false, costUsd: 0, durationMs: 1, turns: 1, at: Date.now() } as ChatItem, false);
    w.sink!.pending(ask('q6', COMMIT));
    expect(w.added).toEqual(['q1', 'q2', 'q3', 'q4', 'q6']);
  });

  it('«sì» typed instead of clicked is the option, and a text of the app is not his words: no note, nothing held', async () => {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', Q));
    await m.answer(chat.id, 'q1', words(Q, 'sì'));
    expect(w.answers[0]!.answer).toEqual(words(Q, 'sì'));
    w.sink!.pending(ask('q2', Q));
    expect(w.added).toEqual(['q1', 'q2']);
    await m.answer(chat.id, 'q2', words(Q, 'Comando finito: exit 0, 12 righe'), 'pc', true); // a run's result (wiring-shared.ts)
    expect(w.answers[1]!.answer).toEqual(words(Q, 'Comando finito: exit 0, 12 righe'));
    w.sink!.pending(ask('q3', Q));
    expect(w.added).toEqual(['q1', 'q2', 'q3']);
  });

  it('a question about production is never answered by the app, also the same one again', async () => {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    const PROD = 'Lancio la migrazione sul database di produzione?';
    w.sink!.pending(ask('q1', PROD));
    await m.answer(chat.id, 'q1', words(PROD, 'in che senso?'));
    w.sink!.pending(ask('q2', PROD));
    expect(w.added).toEqual(['q1', 'q2']);
  });

  it('a work chat reads his words with the same note', async () => {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', Q));
    await m.answer(chat.id, 'q1', words(Q, 'usa il ramo dev'));
    expect(textOf(w.answers[0]!.answer, Q)).toBe(`usa il ramo dev${WORDS_NOTE}`);
  });
});

describe('the Orchestrator and a work chat\'s open question', () => {
  async function setup() {
    const w = world(), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'QA · Rimborsi' });
    const work = w.sink!;
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    return { w, m, chat, work, orch: w.sink!, o };
  }

  it('asked again as the Orchestrator\'s own, it is not shown: one question, one row', async () => {
    const { w, m, chat, work, orch, o } = await setup();
    work.pending(ask('q1', 'Rilancio il test 7 anche su master?'));
    orch.pending(ask('o1', 'Rilancio il test 7 anche su master?'));
    expect(w.added).toEqual(['q1']);
    expect(m.pending().map(p => p.chatId)).toEqual([chat.id]);
    const told = textOf(w.answers.find(a => a.id === 'o1')!.answer, 'Rilancio il test 7 anche su master?');
    expect(told).toContain('«QA · Rimborsi» already has this question open');
    expect(told).toContain(`chatId ${chat.id}, requestId q1`);
    // its own, different question is shown, also one that differs by a word
    orch.pending(ask('o2', 'Da quale dei due progetti riparto oggi?'));
    orch.pending(ask('o3', 'Rilancio il test 8 anche su master?'));
    expect(w.added).toEqual(['q1', 'o2', 'o3']);
    expect(m.pending().some(p => p.chatId === o.id && p.id === 'o2')).toBe(true);
  });

  it('told twice for the same row, its copy is shown: never a question that can not be asked', async () => {
    const { w, work, orch } = await setup();
    work.pending(ask('q1', 'Rilancio il test 7 anche su master?'));
    for (let i = 1; i <= ASK_AGAIN_MAX; i++) orch.pending(ask(`o${i}`, 'Rilancio il test 7 anche su master?'));
    expect(w.added).toEqual(['q1']);
    orch.pending(ask('shown', 'Rilancio il test 7 anche su master?'));
    expect(w.added).toEqual(['q1', 'shown']);
  });

  it('a question it relays to Remote Control in its own panel is shown (chats/relay.ts)', async () => {
    const { w, work, orch } = await setup();
    w.relay = true;
    work.pending(ask('q1', 'Rilancio il test 7 anche su master?'));
    orch.pending(ask('o1', 'Rilancio il test 7 anche su master?'));
    expect(w.added).toEqual(['q1', 'o1']);
  });

  it('a message that asks about the question is never passed to the work chat: the Orchestrator explains', async () => {
    const { w, m, chat, work, o } = await setup();
    work.pending(ask('q1', 'Rilancio il test 7 anche su master?'));
    await m.send(o.id, 'cosa cambia se lo rilanci su master?');
    expect(w.sent.at(-1)).toContain('explain it to him here yourself');
    expect(() => m.answerWithUserWords(chat.id, 'q1', 'cosa cambia se lo rilanci su master?')).toThrow(/chiede una spiegazione/);
    expect(w.answers).toEqual([]);
    expect(m.pending().some(p => p.id === 'q1')).toBe(true); // the row stays open
    await m.send(o.id, 'ok allora rilancialo');
    m.answerWithUserWords(chat.id, 'q1', 'ok allora rilancialo');
    expect(textOf(w.answers[0]!.answer, 'Rilancio il test 7 anche su master?')).toBe(`ok allora rilancialo${WORDS_NOTE}`);
  });
});
