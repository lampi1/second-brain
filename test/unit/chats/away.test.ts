// «Modalità notte» in the chats (ADR 0191, ChatManager.awayAnswered / settleForAway / deliverNow): while the user is away
// a question gets its recommended option, a permission is refused and parked (never granted), every new context hears
// the rule once and, after the mode goes off, once that the user is back.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer, PendingRequest } from '../../../src/shared/contract';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AWAY_BACK, AWAY_PARKED, AWAY_RULE } from '../../../src/shared/away';
import type { AwayEntry } from '../../../src/main/chats/away-log';

const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-away-')); roots.push(d); return d; };

interface World { sent: string[]; answers: { id: string; answer: Answer }[]; away: { on: boolean }; log: Omit<AwayEntry, 'at'>[]; sink?: SessionSink }
function manager(w: World): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, away: () => w.away.on, onAway: e => w.log.push(e),
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
const question = (id: string): Omit<PendingRequest, 'chatId'> => ({ id, type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: Date.now(),
  questions: [{ question: 'Apro la PR?', multiSelect: false, options: [{ label: 'No' }, { label: 'Sì (consigliato)' }] }] });
const permission = (id: string): Omit<PendingRequest, 'chatId'> => ({ id, type: 'permission', tool: 'WebFetch', title: 'WebFetch', detail: 'https://example.com', input: { url: 'https://example.com' }, at: Date.now() });

describe('Modalità notte in the chats', () => {
  it('tells every new context once, then once that the user is back', async () => {
    const w = world(true), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'primo' });
    expect(w.sent[0]!.endsWith(`\n\n${AWAY_RULE}`)).toBe(true);
    await m.send(chat.id, 'secondo');
    expect(w.sent.at(-1)).toBe('secondo');
    w.away.on = false;
    await m.send(chat.id, 'terzo');
    expect(w.sent.at(-1)).toBe(`terzo\n\n${AWAY_BACK}`);
    await m.send(chat.id, 'quarto');
    expect(w.sent.at(-1)).toBe('quarto');
  });

  it('answers a question with its recommended option and parks a permission, never granting it', async () => {
    const w = world(true), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), title: 'Lavoro' });
    w.sink!.pending(question('q1'));
    w.sink!.pending(permission('p1'));
    expect(w.answers).toEqual([
      { id: 'q1', answer: { kind: 'question', answers: { 'Apro la PR?': 'Sì (consigliato)' } } },
      { id: 'p1', answer: { kind: 'permission', allow: false, message: AWAY_PARKED } },
    ]);
    expect(m.pending().filter(p => p.chatId === chat.id)).toEqual([]);
    expect(w.log.map(e => e.kind)).toEqual(['picked', 'parked']);
    expect(w.log[0]!.text).toContain('Sì (consigliato)');
  });

  it('leaves requests to the user when the mode is off, and settles them when it goes on', async () => {
    const w = world(false), m = manager(w);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp() });
    w.sink!.pending(question('q2'));
    expect(w.answers).toEqual([]);
    expect(m.openForUser()).toEqual([{ title: chat.title, what: 'Apro la PR?' }]);
    w.away.on = true;
    expect(m.settleForAway()).toBe(1);
    expect(w.answers.map(a => a.id)).toEqual(['q2']);
    expect(m.pending().filter(p => p.chatId === chat.id)).toEqual([]);
    expect(m.openForUser()).toEqual([]);
  });

  it('puts the recap in the open Orchestrator only', async () => {
    const w = world(false), m = manager(w);
    expect(m.awayRecap('riepilogo')).toBe(false);
    const o = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true });
    expect(m.awayRecap('riepilogo')).toBe(true);
    expect(m.items(o.id).some(i => i.kind === 'system' && i.text === 'riepilogo')).toBe(true);
  });
});
