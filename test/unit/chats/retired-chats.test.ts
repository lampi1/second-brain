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

it('a stored result of a retired chat is not offered, delivered or ended; the same result of another chat is delivered', async () => {
  vi.useFakeTimers();
  const root = temp();
  // a first start writes two finished root results into the run store: one of a retired chat, one of a chat long gone
  const first = manager(root), at = Date.now() - 60_000; // recent: an old run is pruned from the store at the next start
  const result = (chatId: string) => {
    const r = first.m.runs.start({ chatId, agentId: 'artisan', version: 1, goal: 'Old work', startedBy: 'orchestrator', startedAt: at, costKnown: true });
    r.taskId = 't'; r.taskVersion = 1;
    r.report = { at, outcome: 'done', verified: 'yes', summary: 'Done', canonical: { outcome: 'done', summary: 'Done', output: 'Result', doneWhen: [], at, taskId: 't', runId: r.runId, taskVersion: 1 } };
    r.delivery = { policy: 'synthesize', reportedAt: at, attempts: 0 };
    return r.runId;
  };
  const old = result('old-routine'), other = result('gone-chat');
  first.m.runs.save();
  await first.m.shutdown(); managers.splice(managers.indexOf(first.m), 1);
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: rows(root) }));
  const f = manager(root);
  const orchestrator = await f.m.create({ harness: 'claude', cwd: root, orchestrator: true });
  await vi.advanceTimersByTimeAsync(100);
  // the other chat's result reached the Orchestrator (shown and handed over for its summary): the retired chat's did not
  expect(f.m.runs.get(other)?.delivery?.synthesisSubmittedAt).toBeDefined();
  expect(f.m.items(orchestrator.id).filter(i => (i as { code?: string }).code === 'resultReady')).toHaveLength(1);
  expect(f.m.summary(orchestrator.id)!.availableResultIds ?? []).not.toContain(old);
  expect(f.m.runs.get(old)?.delivery).toEqual({ policy: 'synthesize', reportedAt: at, attempts: 0 });
  await expect(f.m.synthesizeResult(old, { kind: 'user' })).rejects.toThrow('Only a root task result');
  f.m.staleRuns(Date.now() + 86400000);
  expect(f.m.runs.get(old)?.endedAt).toBeUndefined();
});

it('a chats.json that is there and was not read is never lost: a copy is kept, or nothing is written', async () => {
  const busy = () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
  // read refused once, the copy works: the app starts empty and the whole old file is beside the new one
  const root = temp(), file = path.join(root, 'chats.json'), text = JSON.stringify({ version: 2, chats: rows(root) });
  fs.writeFileSync(file, text);
  const read = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(busy);
  const store = new ChatStore(root);
  expect(store.load()).toEqual([]);
  read.mockRestore();
  const copy = fs.readdirSync(root).find(n => n.startsWith('chats.json.unread-'))!;
  expect(fs.readFileSync(path.join(root, copy), 'utf8')).toBe(text);
  store.save([]);
  expect(fs.readFileSync(file, 'utf8')).toBe('{"version":2,"chats":[]}\n');
  // read and copy both refused: no way of writing touches the file in this session
  const root2 = temp(), file2 = path.join(root2, 'chats.json');
  fs.writeFileSync(file2, text);
  const read2 = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(busy), copy2 = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(busy);
  const locked = new ChatStore(root2);
  expect(locked.load()).toEqual([]);
  read2.mockRestore(); copy2.mockRestore();
  locked.save([]);
  expect(await locked.saveAsync([])).toBe(true);
  expect(() => locked.checkpoint([])).toThrow('Archivio chat non letto');
  expect(fs.readFileSync(file2, 'utf8')).toBe(text);
  // the next start reads it as usual
  expect(new ChatStore(root2).load().map(c => c.id)).toEqual(['plain']);
});

it('a record with a mark out of shape is an ordinary chat, as it always was', () => {
  const root = temp();
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ version: 2, chats: [
    { id: 'a', harness: 'claude', cwd: root, title: 'A', createdAt: 1, routine: {} },
    { id: 'b', harness: 'claude', cwd: root, title: 'B', createdAt: 2, routinePackage: '' },
    { id: 'c', harness: 'claude', cwd: root, title: 'C', createdAt: 3, routineArchived: 'yes' },
  ] }));
  const store = new ChatStore(root);
  expect(store.load().map(c => c.id)).toEqual(['a', 'b', 'c']);
  expect(store.retiredIds.size).toBe(0);
});
