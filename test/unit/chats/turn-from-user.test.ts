// The Orchestrator's ChatSummary.turnFromUser (ADR 0368): set while a turn the user's own message started (or joined)
// runs, absent for a turn only the app's news started, even when that news joined his turn: the renderer interrupts
// only the app's own turns for his next message. Real ChatManager, in-process fake session.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { SessionSink } from '../../../src/main/chats/session';
import { closeAppDbs } from '../../../src/main/app-db';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); closeAppDbs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function orchestrator() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-turn-from-user-')); roots.push(dir);
  let sink!: SessionSink, busy = false;
  const m = new ChatManager({ userData: dir, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => false, emitter: { emit() {} },
    sessionFactory: (_h, _o, s: SessionSink) => (sink = s, { harness: 'claude', sessionId: 'session', pid: null, root: null, alive: true, get busy() { return busy; },
      start() { s.changed({ state: 'idle' }); }, send() { busy = true; s.changed({ state: 'running' }); },
      answer: () => false, close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
  managers.push(m);
  const c = await m.create({ harness: 'claude', cwd: dir, orchestrator: true });
  const end = () => { busy = false; sink.item({ kind: 'result', id: `r${Date.now()}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false); sink.changed({ state: 'idle' }); };
  return { m, id: c.id, end, summary: () => m.list().find(x => x.id === c.id)! };
}

describe('the Orchestrator\'s turnFromUser on its summary', () => {
  it('his turn stays his when the app\'s news joins it; a turn only the news started is not his', async () => {
    const o = await orchestrator();
    await o.m.send(o.id, 'fai il punto');
    expect(o.summary().turnFromUser).toBe(true);
    await o.m.send(o.id, '[evento app] novità dalle chat', undefined, false, 'App', false, { kind: 'app' });
    expect(o.summary().turnFromUser).toBe(true);
    o.end();
    expect(o.summary().turnFromUser).toBeUndefined();
    await o.m.send(o.id, '[evento app] altre novità', undefined, false, 'App', false, { kind: 'app' });
    expect(o.summary().state).toBe('running');
    expect(o.summary().turnFromUser).toBeUndefined();
  });
});
