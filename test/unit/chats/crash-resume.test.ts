// One recovery after an engine crash mid-turn (ADR 0238; cloudroom: one recovery attempt after cleanup): the chat
// restarts on its session with CRASH_RESUME_TEXT, nothing of the crashed turn is sent again; a second crash in the same
// turn stays an error, and a result gives the next turn its own recovery. Fake sessions, no engine process.
import { afterEach, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Answer } from '../../../src/shared/contract';
import { ChatManager } from '../../../src/main/chats/manager';
import { CRASH_RESUME_TEXT } from '../../../src/main/chats/manager-helpers';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { waitFor } from './helpers';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-crash-')); roots.push(d); return d; };

function manager() {
  const sent: string[] = [], sinks: SessionSink[] = [];
  const session = crypto.randomUUID();
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0,
    sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => {
      sinks.push(s);
      return {
        harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { if (!o.sessionId) s.changed({ sessionId: session }); s.changed({ state: 'idle' }); },
        send(text: string) { sent.push(text); s.changed({ state: 'running' }); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: (_id: string, _a: Answer) => true,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  return { m, sent, sinks, crash: () => sinks.at(-1)!.exit({ code: 1, error: 'engine crashed' }) };
}

it('restarts a chat once after its engine crashed mid-turn, and leaves a second crash of the same turn as an error', async () => {
  const w = manager();
  const chat = await w.m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'lavora' });
  w.crash();
  await waitFor(() => w.sent.includes(CRASH_RESUME_TEXT), 'the recovery message');
  expect(w.sinks).toHaveLength(2);                                   // a new engine on the same chat
  expect(w.sent.filter(t => t === 'lavora')).toHaveLength(1);        // the crashed turn is never sent again
  w.crash();
  await waitFor(() => w.m.list().find(c => c.id === chat.id)?.state === 'error', 'the error state');
  await Promise.resolve();
  expect(w.sent.filter(t => t === CRASH_RESUME_TEXT)).toHaveLength(1);
  expect(w.sinks).toHaveLength(2);
});

it('a turn that ended with a result gets its own recovery again', async () => {
  const w = manager();
  const chat = await w.m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'lavora' });
  w.crash();
  await waitFor(() => w.sent.includes(CRASH_RESUME_TEXT), 'the first recovery');
  w.sinks.at(-1)!.item({ kind: 'result', id: 'r1', at: Date.now(), text: 'fatto', isError: false } as never, false);
  w.sinks.at(-1)!.changed({ state: 'idle' });
  await w.m.send(chat.id, 'ancora');
  w.crash();
  await waitFor(() => w.sent.filter(t => t === CRASH_RESUME_TEXT).length === 2, 'the second recovery');
});

it('never restarts a chat that crashed while idle', async () => {
  const w = manager();
  const chat = await w.m.create({ harness: 'anthropic', cwd: tmp() });
  w.crash();
  await waitFor(() => w.m.list().find(c => c.id === chat.id)?.state === 'error', 'the error state');
  await Promise.resolve();
  expect(w.sent).toEqual([]);
});

it('a delegated child is not resumed: its parent already got a blocked result and decides', async () => {
  const w = manager();
  const chat = await w.m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'lavora' });
  (w.m as unknown as { chats: Map<string, { s: { delegation?: unknown } }> }).chats.get(chat.id)!.s.delegation = { role: 'artisan' };
  w.crash();
  await waitFor(() => w.m.list().find(c => c.id === chat.id)?.state === 'error', 'the error state');
  await new Promise(r => setTimeout(r, 0));
  expect(w.sent).not.toContain(CRASH_RESUME_TEXT);
  expect(w.sinks).toHaveLength(1);
});
