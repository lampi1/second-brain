// The chats of the in-app routine executor, gone with ADR 0325: their records stay in chats.json byte for byte, the
// app never loads them (so they cannot resume, fork or receive work), and their runs are neither shown nor ended.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ChatStore } from '../../../src/main/chats/store';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';

const roots: string[] = [], managers: ChatManager[] = [];
const sessionId = (first: string) => [first, '2222', '4333', '8444', '555555555555'].join('-');
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-retired-')); roots.push(root); return root; };
const run = { runId: 'r_000000000001', chatId: 'old-routine', agentId: 'artisan', version: 1, goal: 'Old routine', startedBy: 'orchestrator', startedAt: 1000, costUsd: null, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } };
const rows = (root: string) => [
  { id: 'old-routine', harness: 'claude', cwd: root, title: 'Old routine', createdAt: 1000, sessionId: sessionId('11111111'), routine: { runId: 'old-run', stepId: 'step' }, run, heldResults: [{ title: 'Child', message: 'Routine result' }], unknownField: { kept: true } },
  { id: 'old-child', harness: 'claude', cwd: root, title: 'Routine child', createdAt: 1001, sessionId: sessionId('22222222'), parentId: 'old-routine', working: true },
  { id: 'old-grandchild', harness: 'claude', cwd: root, title: 'Deeper', createdAt: 1002, parentId: 'old-child' },
  { id: 'old-package', harness: 'claude', cwd: root, title: 'Package step', createdAt: 1003, routinePackage: 'a'.repeat(64) },
  { id: 'old-archived', harness: 'claude', cwd: root, title: 'Archived', createdAt: 1004, routineArchived: true, closedAt: 1005 },
  { id: 'plain', harness: 'claude', cwd: root, title: 'A normal chat', createdAt: 1006 },
];
const retired = ['old-routine', 'old-child', 'old-grandchild', 'old-package', 'old-archived'];

it('keeps retired routine chats and everything below them in the file, and loads none of them', () => {
  const root = temp(), all = rows(root);
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: all }));
  const store = new ChatStore(root), loaded = store.load();
  expect(loaded.map(c => c.id)).toEqual(['plain']);
  expect([...store.retiredIds].sort()).toEqual([...retired].sort());
  // every way of writing puts them back as they were, unknown fields included
  const kept = () => (JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8')) as { chats: { id: string }[] }).chats;
  store.save([...loaded, { ...loaded[0]!, id: 'new' }]);
  expect(kept().map(c => c.id)).toEqual(['plain', 'new', ...retired]);
  expect(kept().filter(c => retired.includes(c.id))).toEqual(all.filter(c => retired.includes(c.id)));
  store.checkpoint(loaded);
  expect(kept().filter(c => retired.includes(c.id))).toEqual(all.filter(c => retired.includes(c.id)));
  // the next start reads the same split
  const again = new ChatStore(root);
  expect(again.load().map(c => c.id)).toEqual(['plain']);
  expect([...again.retiredIds].sort()).toEqual([...retired].sort());
});

it('writes them back from the deferred save too', async () => {
  const root = temp(), all = rows(root);
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: all }));
  const store = new ChatStore(root), loaded = store.load();
  expect(await store.saveAsync([...loaded, { ...loaded[0]!, id: 'new' }])).toBe(true);
  expect((JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8')) as { chats: { id: string }[] }).chats.map(c => c.id)).toEqual(['plain', 'new', ...retired]);
});

it('a store with no retired chat writes the file as before', () => {
  const root = temp();
  const store = new ChatStore(root);
  expect(store.load()).toEqual([]);
  store.save([]);
  expect(fs.readFileSync(path.join(root, 'chats.json'), 'utf8')).toBe('{"version":2,"chats":[]}\n');
});

function manager(root: string) {
  const starts: SessionOptions[] = [];
  const m = new ChatManager({ userData: root, emitter: { emit() {} }, claudeHome: path.join(root, 'home'), coldEveryMs: 0, runEveryMs: 0, childResultsMs: 10, sessionFactory: (_h, o, s) => {
    starts.push(o); return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); }, send() {}, close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, starts };
}

it('the app has no retired chat: nothing to resume, fork, assign or deliver', async () => {
  vi.useFakeTimers();
  const root = temp();
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: rows(root) }));
  const f = manager(root);
  expect(f.m.list().map(c => c.id)).toEqual(['plain']);
  expect(f.m.summary('old-routine')).toBeUndefined();
  const send = vi.spyOn(f.m, 'send');
  expect(f.m.resumeInterrupted()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(send).not.toHaveBeenCalled();
  expect(f.m.staleRuns(Date.now() + 86400000)).toBe(0);
  await expect(f.m.assignTask('old-routine', 'Continue')).rejects.toThrow();
  await expect(f.m.continueChat('old-routine')).rejects.toThrow();
  // a fork of its session is a new, ordinary chat: the retired record is not found by its session id
  expect(f.starts).toHaveLength(0);
  // and a restart of the app still finds them in the file
  await f.m.shutdown();
  expect((JSON.parse(fs.readFileSync(path.join(root, 'chats.json'), 'utf8')) as { chats: { id: string }[] }).chats.map(c => c.id).filter(id => retired.includes(id))).toEqual(retired);
});
