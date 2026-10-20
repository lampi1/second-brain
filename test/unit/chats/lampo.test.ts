// «Lampo», the quick lane (ADR 0105): one at a time, only the user's; read and web tools in plan mode (no edit, no
// command, no popup); its own short frame; never auto-closed, never in the Orchestrator's picture; «Fanne un lavoro»
// takes the last question and answer.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, LAMPO_TITLE } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { lastExchange } from '../../../src/renderer/lib/lampo';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lampo-')); roots.push(d); return d; };

function manager(starts: SessionOptions[], sent: string[]): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o: SessionOptions, s: SessionSink) => {
    starts.push(o);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); s.item({ kind: 'result', id: `r${sent.length}`, at: Date.now(), text: '', costUsd: 0, isError: false } as never, false); },
      close: async () => { s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return m;
}

describe('Lampo', () => {
  it('is one, the user\'s, read-only in plan mode, with its own frame', async () => {
    const starts: SessionOptions[] = [], sent: string[] = [];
    const m = manager(starts, sent);
    const l = await m.create({ harness: 'claude', cwd: tmp(), quick: true, prompt: 'che ore sono a Tokyo?' });
    expect(l).toMatchObject({ quick: true, title: LAMPO_TITLE, isOrchestrator: false });
    expect(starts[0]).toMatchObject({ permissionMode: 'plan', toolPolicy: { allow: ['read', 'web'] }, ceiling: 'plan' });
    expect(sent[0]).toMatch(/^\[Role supplied by the app: .*\]\nYou are Lampo/);
    expect(sent[0]).toMatch(/che ore sono a Tokyo\?$/);
    expect((await m.create({ harness: 'claude', cwd: tmp(), quick: true })).id).toBe(l.id);
    await expect(m.create({ harness: 'claude', cwd: tmp(), quick: true }, 'agent')).rejects.toThrow(/only the user/);
    expect(m.autoCloseCandidates(() => false).find(c => c.id === l.id)?.eligible).toBe(false);
    expect(m.releaseIdle(0, Date.now() + 3_600_000)).toBe(0);
  });

  it('«Fanne un lavoro» takes the last question and its answer', () => {
    const at = 1;
    expect(lastExchange([])).toBeNull();
    expect(lastExchange([
      { kind: 'user', id: 'u1', at, text: 'vecchia' }, { kind: 'assistant', id: 'a1', at, text: 'x', streaming: false },
      { kind: 'user', id: 'u2', at, text: 'Cosa fa manager.ts?' }, { kind: 'assistant', id: 'a2', at, text: 'Gestisce le chat.', streaming: false },
    ] as never)).toEqual({ question: 'Cosa fa manager.ts?', answer: 'Gestisce le chat.' });
  });
});
