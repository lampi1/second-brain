// The app's estimate under the user's request to the Orchestrator (ADR 0087, token plan 2026-10-20): the user's own
// message gets the line task_estimate would answer, so the Orchestrator acts without calling the tool; the app's news,
// agents' mail, a mode-tagged message and work chats get nothing; the chat view and a transcript re-read never show it.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { userText } from '../../../src/main/chats/transcript';
import { estimateLine, withoutEstimateLine } from '../../../src/shared/task-estimate';

const LINE = estimateLine({ path: 'self', why: 'A short question, 1 part; fewer than 3 similar tasks, no figure: answer it yourself, without starting a chat.' });
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-est-')); roots.push(d); return d; };

function manager(sent: string[], estimate: (t: string) => string | null): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, requestEstimate: estimate, sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => ({
    harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
    start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
    send(text: string) { sent.push(text); },
    close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
  }) as unknown as HarnessSession });
  managers.push(m);
  return m;
}

describe('the estimate line under a request to the Orchestrator', () => {
  it('goes with the user\'s own messages only', async () => {
    const sent: string[] = [], asked: string[] = [];
    const m = manager(sent, t => { asked.push(t); return LINE; });
    const orch = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(sent.at(-1)!.endsWith(`Ciao\n\n${LINE}`)).toBe(true);
    const ask = 'che ore sono a Tokyo e a New York, adesso?';
    await m.send(orch.id, ask);
    expect(sent.at(-1)).toBe(`${ask}\n\n${LINE}`);
    expect(asked).toEqual(['Ciao', ask]);
    // the item the chat view shows keeps the user's words
    const items = m.items(orch.id).filter(i => i.kind === 'user');
    expect(items.at(-1)).toMatchObject({ text: ask });
    // a short follow-up in the conversation going on is no new request (ADR 0182)
    await m.send(orch.id, 'ok vai');
    await m.send(orch.id, 'il secondo');
    expect(sent.slice(-2)).toEqual(['ok vai', 'il secondo']);
    // the app's news, an agent's mail and a mode-tagged message: no line
    await m.send(orch.id, '[evento app · messaggio automatico] Novità');
    await m.send(orch.id, 'Fatto il lavoro', undefined, false, 'Artisan · fix');
    await m.send(orch.id, '[strategist] Affida\n\nfai X');
    expect(sent.slice(-3).every(t => !t.includes(LINE))).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it('never goes to a work chat, and a failing estimate never holds the message', async () => {
    const sent: string[] = [];
    const m = manager(sent, () => { throw new Error('boom'); });
    const work = await m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'lavoro' });
    expect(sent.at(-1)).toBe('lavoro');
    const orch = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(sent.at(-1)!.endsWith('Ciao')).toBe(true);
    expect(work.id).not.toBe(orch.id);
  });

  it('a transcript re-read drops the line', () => {
    expect(withoutEstimateLine(`domanda\n\n${LINE}`)).toBe('domanda');
    expect(userText(`domanda\n\n${LINE}`)).toEqual({ text: 'domanda' });
    expect(withoutEstimateLine('[app estimate] scritto dall\'utente')).toBe('[app estimate] scritto dall\'utente');
  });
});
