// #379 «questions sometimes reach me twice»: the same question asked again while its first copy is still open (an
// engine retrying its ask, two asks in one message) is never shown twice; it takes the first one's answer, and shows
// only if the engine withdraws the first unanswered. A fake engine, temp folders only.
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
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-twins-')); roots.push(d); return d; };

interface World { sent: string[]; answers: { id: string; answer: Answer }[]; away: { on: boolean }; log: Omit<AwayEntry, 'at'>[]; sink?: SessionSink; events: { ch: string; p: { requestId?: string; id?: string } }[] }
function manager(w: World, brainRoot?: string): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit: (ch: string, p: unknown) => { w.events.push({ ch, p: p as { requestId?: string; id?: string } }); } }, coldEveryMs: 0, away: () => w.away.on, onAway: e => w.log.push(e), ...(brainRoot ? { brainRoot: () => brainRoot } : {}),
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
const world = (on: boolean): World => ({ sent: [], answers: [], away: { on }, log: [], events: [] });

const ask = (id: string, question: string, options = ['Sì (consigliato)', 'No']): Omit<PendingRequest, 'chatId'> => ({ id, type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: Date.now(),
  questions: [{ question, multiSelect: false, options: options.map(label => ({ label })) }] });

const tick = () => new Promise(r => setImmediate(r));
const added = (w: World) => w.events.filter(e => e.ch === 'pending:added').map(e => e.p.id);

describe('the same question twice', () => {
  it('is shown once and both copies get the user\'s answer', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    expect(added(w)).toEqual(['q1']);
    expect(m.pending().filter(p => p.chatId === chat.id).map(p => p.id)).toEqual(['q1']);
    await m.answer(chat.id, 'q1', { kind: 'question', answers: { 'Tolgo il vecchio login?': 'No' } });
    expect(w.answers.map(a => a.id).sort()).toEqual(['q1', 'q2']);
    // the engine resolves both afterwards: nothing shows again
    w.sink!.resolved('q2'); w.sink!.resolved('q1');
    expect(added(w)).toEqual(['q1']);
  });

  it('a different question, or other options, is its own panel', async () => {
    const w = world(false), m = manager(w);
    await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il nuovo login?'));
    w.sink!.pending(ask('q3', 'Tolgo il vecchio login?', ['Sì', 'No (consigliato)']));
    expect(added(w)).toEqual(['q1', 'q2', 'q3']);
  });

  it('the first withdrawn unanswered: the twin shows; a withdrawn twin never does', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q3', 'Tolgo il vecchio login?'));
    w.sink!.resolved('q2');
    w.sink!.resolved('q1');
    await tick();
    expect(added(w)).toEqual(['q1', 'q3']);
    expect(m.pending().filter(p => p.chatId === chat.id).map(p => p.id)).toEqual(['q3']);
  });

  it('an engine that exits resolves everything first: no copy flashes on screen', async () => {
    const w = world(false), m = manager(w);
    await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    w.sink!.resolved('q1'); w.sink!.resolved('q2');
    w.sink!.exit({ code: 0, error: null });
    await tick();
    expect(added(w)).toEqual(['q1']);
  });

  it('a wrong first answer leaves the copy waiting; a question differing by a space is its own panel', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q3', 'Tolgo il vecchio login? '));
    expect(added(w)).toEqual(['q1', 'q3']);
    await expect(m.answer(chat.id, 'q1', { kind: 'question', answers: { 'Altro?': 'No' } })).rejects.toThrow();
    await m.answer(chat.id, 'q1', { kind: 'question', answers: { 'Tolgo il vecchio login?': 'No' } });
    expect(w.answers.map(a => a.id).sort()).toEqual(['q1', 'q2']);
  });

  it('the same ask again while a copy is about to show joins it: one panel', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(ask('q1', 'Tolgo il vecchio login?'));
    w.sink!.pending(ask('q2', 'Tolgo il vecchio login?'));
    w.sink!.resolved('q1');
    w.sink!.pending(ask('q3', 'Tolgo il vecchio login?'));
    await tick();
    expect(added(w)).toEqual(['q1', 'q2']);
    await m.answer(chat.id, 'q2', { kind: 'question', answers: { 'Tolgo il vecchio login?': 'No' } });
    expect(w.answers.map(a => a.id).sort()).toEqual(['q2', 'q3']);
  });
});
