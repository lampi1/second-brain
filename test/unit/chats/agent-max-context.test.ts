// An agent's "Contesto massimo" (#80) reaches its engine: the session starts with the agent's compaction window instead
// of the user's setting, and keeps it after a restart (chats.json); a chat without one keeps the setting.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-maxctx-')); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function manager(userData: string, seen: SessionOptions[]) {
  const m = new ChatManager({ userData, emitter: { emit: () => {} }, compactWindowTokens: () => 200_000,
    resolveAgent: req => ({ request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null, skills: [], launches: [], ...(req.title === 'Lungo' ? { maxContext: 500_000 } : {}) }),
    sessionFactory: (harness, options, sink): HarnessSession => { seen.push(options); return { harness, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { sink.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {} }; } });
  managers.push(m);
  return m;
}

it('starts the agent\'s chat with its own compaction window and keeps it across a restart', async () => {
  const userData = tmp(), cwd = tmp(), seen: SessionOptions[] = [];
  const m = manager(userData, seen);
  const long = await m.create({ harness: 'claude', cwd, title: 'Lungo' });
  await m.create({ harness: 'claude', cwd, title: 'Normale' });
  await m.send(long.id, 'ciao');
  expect(seen.map(o => o.compactWindowTokens)).toEqual([500_000, 200_000]);
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')) as { chats: { title: string; agentMaxContext?: number }[] };
  expect(stored.chats.find(c => c.title === 'Lungo')?.agentMaxContext).toBe(500_000);
  await m.shutdown(50); managers.splice(0);
  const after: SessionOptions[] = [];
  const again = manager(userData, after);
  await again.send(long.id, 'di nuovo');
  expect(after.at(-1)?.compactWindowTokens).toBe(500_000);
});
