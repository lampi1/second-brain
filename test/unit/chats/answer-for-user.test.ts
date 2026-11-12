// The Orchestrator answering a work chat's Sì/No question for the user (ADR 0269, ChatManager.answerForUser): only an
// engine's own yes/no question in a work chat, one of its options, never what stays the user's alone; recorded with a
// line in the chat that says who answered.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, PendingRequest } from '../../../src/shared/contract';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { AwayEntry } from '../../../src/main/chats/away-log';

const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-forusr-')); roots.push(d); return d; };

interface World { sent: string[]; answers: { id: string; answer: Answer }[]; away: { on: boolean }; log: Omit<AwayEntry, 'at'>[]; sink?: SessionSink }
function manager(w: World, brainRoot?: string): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, away: () => w.away.on, onAway: e => w.log.push(e), ...(brainRoot ? { brainRoot: () => brainRoot } : {}),
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
const world = (on: boolean): World => ({ sent: [], answers: [], away: { on }, log: [] });

const ask = (id: string, question: string, options = ['Sì (consigliato)', 'No']): Omit<PendingRequest, 'chatId'> => ({ id, type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: Date.now(),
  questions: [{ question, multiSelect: false, options: options.map(label => ({ label })) }] });

describe('the Orchestrator answers for the user', () => {
  it('answers a work chat\'s yes/no question with one of its options and says so in the chat', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    m.answerForUser(chat.id, 'q1', { 'Tolgo il vecchio login?': 'Sì (consigliato)' });
    expect(w.answers).toEqual([{ id: 'q1', answer: { kind: 'question', answers: { 'Tolgo il vecchio login?': 'Sì (consigliato)' } } }]);
    expect(m.pending().filter(p => p.chatId === chat.id)).toEqual([]);
    expect(m.items(chat.id).some(i => i.kind === 'system' && i.code === 'orchestratorAnswered')).toBe(true);
  });

  it('never on what is the user\'s alone, an option the question does not have, or the Orchestrator\'s own question', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Faccio il deploy in produzione?'));
    expect(() => m.answerForUser(chat.id, 'q1', { 'Faccio il deploy in produzione?': 'Sì (consigliato)' })).toThrow(/solo dell’utente/);
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    expect(() => m.answerForUser(chat.id, 'q2', { 'Tolgo il vecchio login?': 'Forse' })).toThrow(/opzioni/);
    w.sink!.pending(ask('q3', 'Quale colore?', ['Rosso', 'Blu']));
    expect(() => m.answerForUser(chat.id, 'q3', { 'Quale colore?': 'Rosso' })).toThrow(/Sì\/No/);
    expect(w.answers).toEqual([]);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    w.sink!.pending(ask('q4', 'Tolgo il vecchio login?'));
    expect(() => m.answerForUser(o.id, 'q4', { 'Tolgo il vecchio login?': 'Sì (consigliato)' })).toThrow(/chat di lavoro/);
  });
});
