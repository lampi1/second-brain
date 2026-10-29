// The deferred store writes (writeDelayMs, the main-process freezes of 2026-10-27): chats.json and the agent runs (app.db,
// ADR 0199; agent-runs.json when the database cannot be used) are written once per burst, asynchronously, and nothing is lost on quit or exit (the pending writes are flushed
// synchronously). Also pins the async writer's rules: a newer write always wins over an older one still in flight, a
// locked rename is retried without blocking, an unchanged body is not written again, a sync save during a deferred one
// is never undone by it in memory (`last`, the prune), a failed deferred write retries on its own, and the startup
// removes the tmp files an exit left behind.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { ChatStore, type StoredChat } from '../../../src/main/chats/store';
import { AgentRunStore, RUNS_MAX, endRun } from '../../../src/main/agents/runs';
import { closeAppDbs } from '../../../src/main/app-db';
import { writeLocalTextAsync } from '../../../src/main/agents/local-store';
import { RunsDb, exportRuns, type RunsWrite } from '../../../src/main/agents/runs-db';
import { log } from '../../../src/main/log';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.shutdown(); closeAppDbs(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmpDir = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); roots.push(d); return d; };
const CORRECTION = '[Reasoning correction]\nNo, il bug è nel parser.';
const tmps = (dir: string) => fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = tmpDir('sb-deferred-');
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (_h, _o, s) => ({
    harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
    start() { s.changed({ state: 'idle' }); }, send() {},
    close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
    rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
  } as unknown as HarnessSession) });
  managers.push(m);
  const create = (title: string) => m.create({ harness: 'claude', cwd: dir, prompt: 'Rivedi il PR', title }, 'user',
    { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'reviewer', version: 3 }, instructions: 'Sei un revisore.', policy: null });
  const chats = () => { try { return (JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: StoredChat[] }).chats; } catch { return []; } };
  const runs = () => { try { return (exportRuns(path.join(dir, 'app.db'))?.runs ?? []) as { chatId: string }[]; } catch { return []; } };
  return { m, dir, create, chats, runs };
}

describe('ChatManager with writeDelayMs', () => {
  it('a new assignment never synchronously rewrites the full run ledger (#262)', async () => {
    const f = fixture({ writeDelayMs: 60_000 });
    const writes = vi.spyOn(AgentRunStore.prototype, 'save');
    const chat = await f.create('Start');
    expect(writes).not.toHaveBeenCalled();
    expect(f.chats().find(c => c.id === chat.id)?.run?.runId).toBeTruthy();
    f.m.flushWrites();
    expect(f.runs().map(r => r.chatId)).toContain(chat.id);
  });
  it('flushes every pending chat and run write at quit: nothing changed in the last burst is lost', async () => {
    const f = fixture({ writeDelayMs: 60_000 }); // the timer never fires in this test: only the quit writes
    const a = await f.create('Primo'), b = await f.create('Secondo');
    // a create is a strict checkpoint (on disk at once); a correction is a deferred chat + run write
    f.m.resumedByUser(b.id, CORRECTION);
    const tagged = (rows: { id?: string; chatId?: string; corrections?: { tagged: number }; run?: { corrections?: { tagged: number } } }[]) => rows.find(x => (x.chatId ?? x.id) === b.id);
    expect(tagged(f.chats())?.run?.corrections?.tagged ?? 0).toBe(0);
    await f.m.shutdown();
    managers.splice(managers.indexOf(f.m), 1);
    expect(f.chats().map(c => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(f.runs().map(r => r.chatId)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(tagged(f.chats())?.run?.corrections?.tagged).toBe(1);
    expect(tagged(f.runs() as never)?.corrections?.tagged).toBe(1);
    // the next start reads them back
    expect(new ChatStore(f.dir).load().map(c => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(tmps(f.dir)).toEqual([]);
  });

  it('the process exit path (flushWrites) writes them too', async () => {
    const f = fixture({ writeDelayMs: 60_000 });
    const a = await f.create('Uscita');
    f.m.resumedByUser(a.id, CORRECTION);
    f.m.flushWrites();
    expect(f.chats().find(c => c.id === a.id)?.run?.corrections?.tagged).toBe(1);
    expect((f.runs() as { chatId: string; corrections?: { tagged: number } }[]).find(r => r.chatId === a.id)?.corrections?.tagged).toBe(1);
  });

  it('writes a burst of changes once, asynchronously, after the delay', async () => {
    const f = fixture({ writeDelayMs: 30 });
    const a = await f.create('Uno');
    const writes = vi.spyOn(fs.promises, 'writeFile'), dbWrites = vi.spyOn(RunsDb.prototype, 'write');
    for (let i = 0; i < 5; i++) f.m.resumedByUser(a.id, CORRECTION);
    expect(writes).not.toHaveBeenCalled(); // nothing written in-line
    expect(dbWrites).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.chats().find(c => c.id === a.id)?.run?.corrections?.tagged).toBe(5), { timeout: 3000 });
    await vi.waitFor(() => expect((f.runs() as { chatId: string; corrections?: { tagged: number } }[]).find(r => r.chatId === a.id)?.corrections?.tagged).toBe(5), { timeout: 3000 });
    const of = (name: string) => writes.mock.calls.filter(([p]) => path.basename(String(p)).startsWith(name)).length;
    expect(of('chats.json')).toBe(1); // five changes, ten saves asked: one write per store
    expect(dbWrites).toHaveBeenCalledTimes(1);
    expect(dbWrites.mock.calls[0]![0].upsert.map(r => r.id)).toEqual([f.m.list().find(c => c.id === a.id)!.run!.runId]); // only the changed run
  });

  it('a failed deferred write is tried again on its own, with no later change to trigger it', async () => {
    const f = fixture({ writeDelayMs: 20, writeRetryMs: 20 });
    const a = await f.create('Riprova');
    const real = fs.promises.writeFile.bind(fs.promises);
    const failed = { chats: 0, runs: 0 };
    vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const writes = vi.spyOn(fs.promises, 'writeFile').mockImplementation(((p: fs.PathLike, ...rest: never[]) => {
      const name = path.basename(String(p));
      if (name.startsWith('chats.json') && failed.chats === 0) { failed.chats++; return Promise.reject(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })); }
      return (real as (...a: unknown[]) => Promise<void>)(p, ...rest);
    }) as typeof fs.promises.writeFile);
    const realDb = RunsDb.prototype.write;
    const dbWrites = vi.spyOn(RunsDb.prototype, 'write').mockImplementation(function (this: RunsDb, w: RunsWrite) {
      if (failed.runs === 0) { failed.runs++; throw Object.assign(new Error('SQLITE_FULL'), { errcode: 13 }); }
      return realDb.call(this, w);
    });
    f.m.resumedByUser(a.id, CORRECTION); // the only change: nothing else will ask for a save
    await vi.waitFor(() => expect(f.chats().find(c => c.id === a.id)?.run?.corrections?.tagged).toBe(1), { timeout: 3000 });
    await vi.waitFor(() => expect((f.runs() as { chatId: string; corrections?: { tagged: number } }[]).find(r => r.chatId === a.id)?.corrections?.tagged).toBe(1), { timeout: 3000 });
    expect(failed).toEqual({ chats: 1, runs: 1 });
    const of = (name: string) => writes.mock.calls.filter(([p]) => path.basename(String(p)).startsWith(name)).length;
    expect(of('chats.json')).toBe(2);
    expect(dbWrites).toHaveBeenCalledTimes(2);
  });
});

describe('startup cleanup', () => {
  it('removes only the <file>.<uuid>.tmp of chats.json and agent-runs.json left by an exit mid-write', () => {
    const dir = tmpDir('sb-orphans-');
    const id = randomUUID();
    const names = [`chats.json.${id}.tmp`, `agent-runs.json.${id}.tmp`, `other.json.${id}.tmp`, 'chats.json.tmp', 'chats.json.bad.tmp', `chats.json.${id}.tmp.keep`];
    for (const n of names) fs.writeFileSync(path.join(dir, n), '{}');
    new ChatStore(dir).load();
    new AgentRunStore(dir).close();
    expect(fs.readdirSync(dir).filter(n => !n.startsWith('app.db')).sort()).toEqual([`other.json.${id}.tmp`, 'chats.json.tmp', 'chats.json.bad.tmp', `chats.json.${id}.tmp.keep`].sort());
  });
});

describe('the async store writers', () => {
  it('ChatStore: a sync save while a deferred one is in flight wins; the older body never lands', async () => {
    const dir = tmpDir('sb-chatstore-');
    const store = new ChatStore(dir);
    const row = (title: string): StoredChat => ({ id: 'c1', harness: 'claude', cwd: dir, sessionId: null, title, model: null, effort: null, permissionMode: null, isOrchestrator: false, createdAt: 1 });
    const older = store.saveAsync([row('vecchio')]);
    store.save([row('nuovo')]);
    await older;
    expect(new ChatStore(dir).load()[0]!.title).toBe('nuovo');
    // unchanged: no new write
    const writes = vi.spyOn(fs.promises, 'writeFile');
    await store.saveAsync([row('nuovo')]);
    expect(writes).not.toHaveBeenCalled();
    expect(tmps(dir)).toEqual([]);
  });

  it('ChatStore: a checkpoint after a deferred rename (unlink held) does not let the older body become `last`', async () => {
    const dir = tmpDir('sb-chatstore-gen-');
    const store = new ChatStore(dir);
    const row = (title: string): StoredChat => ({ id: 'c1', harness: 'claude', cwd: dir, sessionId: null, title, model: null, effort: null, permissionMode: null, isOrchestrator: false, createdAt: 1 });
    store.save([row('A')]);
    store.save([row('B')]);
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const realUnlink = fs.promises.unlink.bind(fs.promises);
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async p => { await held; return realUnlink(p); });
    let renamed!: () => void;
    const landed = new Promise<void>(r => { renamed = r; });
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => { realRename(a, b); if (String(a).match(/\.[0-9a-f-]{36}\.tmp$/)) renamed(); });
    const deferred = store.saveAsync([row('A')]);
    await landed; // A is on disk; the deferred write may still be waiting for its tmp's unlink
    store.checkpoint([row('C')]);
    release();
    await deferred;
    store.save([row('A')]); // the state goes back to A: it must be written
    expect(new ChatStore(dir).load()[0]!.title).toBe('A');
  });

  it('AgentRunStore (agent-runs.json): a sync save with a prune during a deferred pruning write is not rolled back by it', async () => {
    const dir = tmpDir('sb-runstore-prune-');
    const s = new AgentRunStore(dir, { db: false });
    const start = (startedAt: number) => ({ chatId: 'c1', agentId: 'reviewer', version: 1, goal: 'Rivedi', startedBy: 'user' as const, startedAt, costKnown: true });
    for (let i = 0; i < RUNS_MAX; i++) endRun(s.start(start(10), false), 'closed', 1000 + i);
    endRun(s.start(start(10), false), 'closed', 9000); // one over: the deferred write prunes the oldest end
    s.touch();
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const realUnlink = fs.promises.unlink.bind(fs.promises);
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async p => { await held; return realUnlink(p); });
    let renamed!: () => void;
    const landed = new Promise<void>(r => { renamed = r; });
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => { realRename(a, b); if (String(a).match(/\.[0-9a-f-]{36}\.tmp$/)) renamed(); });
    const deferred = s.saveAsync();
    await landed;
    endRun(s.start(start(10), false), 'closed', 9001);
    s.save(); // prunes two (the deferred one's prune was not committed in memory yet) and commits
    const after = { rolled: structuredClone(s.rolledUp()), size: s.list().length };
    release();
    const ok = await deferred;
    expect(s.rolledUp()).toEqual(after.rolled);
    expect(s.list()).toHaveLength(after.size);
    expect(ok).toBe(true);
    const disk = new AgentRunStore(dir, { db: false });
    expect(disk.rolledUp()).toEqual(after.rolled);
    expect(disk.list()).toHaveLength(after.size);
  }, 30_000);

  it('AgentRunStore (agent-runs.json): flush() at quit writes over a deferred write still in flight', async () => {
    const dir = tmpDir('sb-runstore-');
    const runs = new AgentRunStore(dir, { db: false });
    const start = (chatId: string) => ({ chatId, agentId: 'reviewer', version: 1, goal: 'Rivedi', startedBy: 'user' as const, startedAt: Date.now(), costKnown: true });
    runs.start(start('c1'), false);
    const pending = runs.saveAsync();
    runs.start(start('c2'), false);
    expect(runs.pending).toBe(true);
    runs.flush();
    await pending;
    const saved = (JSON.parse(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')) as { runs: { chatId: string }[] }).runs.map(r => r.chatId);
    expect(saved).toEqual(['c1', 'c2']);
    expect(runs.pending).toBe(false);
  });

  it('AgentRunStore (agent-runs.json): the deferred save serializes the runs in slices, writes the same file as a sync save, and keeps a change made meanwhile (#297)', async () => {
    const dir = tmpDir('sb-runslices-'), other = tmpDir('sb-runslices-sync-');
    const a = new AgentRunStore(dir, { db: false }), b = new AgentRunStore(other, { db: false });
    const start = (chatId: string, at: number) => ({ chatId, agentId: 'reviewer', version: 1, goal: `Rivedi ${'x'.repeat(4000)}`, startedBy: 'user' as const, startedAt: at, costKnown: true });
    for (let i = 0; i < 400; i++) { const run = start(`c${i}`, 1000 + i); const ra = a.start(run, false), rb = b.start(run, false); rb.runId = ra.runId; }
    b.save();
    const pending = a.saveAsync();
    a.start(start('late', 9999), false); // a change while the slices run
    expect(await pending).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')).toBe(fs.readFileSync(path.join(other, 'agent-runs.json'), 'utf8'));
    expect(a.pending).toBe(true); // 'late' is written by the next save
    await a.saveAsync();
    expect((JSON.parse(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')) as { runs: unknown[] }).runs).toHaveLength(401);
  });

  it('AgentRunStore (app.db): flush() at quit writes over a deferred save still in its slices', async () => {
    const dir = tmpDir('sb-runstore-db-');
    const runs = new AgentRunStore(dir);
    expect(runs.backend).toBe('sqlite');
    const start = (chatId: string) => ({ chatId, agentId: 'reviewer', version: 1, goal: 'Rivedi', startedBy: 'user' as const, startedAt: Date.now(), costKnown: true });
    runs.start(start('c1'), false);
    const pending = runs.saveAsync();
    runs.start(start('c2'), false);
    expect(runs.pending).toBe(true);
    runs.flush();
    expect(await pending).toBe(true); // superseded by the flush
    expect((exportRuns(path.join(dir, 'app.db'))!.runs as { chatId: string }[]).map(r => r.chatId)).toEqual(['c1', 'c2']);
    expect(runs.pending).toBe(false);
    runs.close();
  });

  it('AgentRunStore (app.db): the deferred save writes only the changed runs, the same rows as a sync save, and keeps a change made meanwhile (#297)', async () => {
    const dir = tmpDir('sb-runslices-db-'), other = tmpDir('sb-runslices-db-sync-');
    const a = new AgentRunStore(dir), b = new AgentRunStore(other);
    const start = (chatId: string, at: number) => ({ chatId, agentId: 'reviewer', version: 1, goal: `Rivedi ${'x'.repeat(4000)}`, startedBy: 'user' as const, startedAt: at, costKnown: true });
    for (let i = 0; i < 400; i++) { const run = start(`c${i}`, 1000 + i); const ra = a.start(run, false), rb = b.start(run, false); rb.runId = ra.runId; }
    b.save();
    const writes = vi.spyOn(RunsDb.prototype, 'write');
    const pending = a.saveAsync();
    a.start(start('late', 9999), false); // a change while the slices run
    expect(await pending).toBe(true);
    expect(exportRuns(path.join(dir, 'app.db'))).toEqual(exportRuns(path.join(other, 'app.db')));
    expect(a.pending).toBe(true); // 'late' is written by the next save
    a.list()[0]!.costUsd = 1; // and one run changed in place
    await a.saveAsync();
    const ids = writes.mock.calls.at(-1)![0].upsert.map(r => r.id);
    expect(ids).toHaveLength(2); // 'late' and the run changed in place, not the other 399
    expect(ids).toContain(a.list()[0]!.runId);
    expect(exportRuns(path.join(dir, 'app.db'))!.runs).toHaveLength(401);
    a.close(); b.close();
  });

  it('AgentRunStore (app.db): a sync save with a prune during a deferred save is not rolled back by it', async () => {
    const dir = tmpDir('sb-runstore-db-prune-');
    const s = new AgentRunStore(dir);
    const start = (startedAt: number) => ({ chatId: 'c1', agentId: 'reviewer', version: 1, goal: 'Rivedi', startedBy: 'user' as const, startedAt, costKnown: true });
    for (let i = 0; i < RUNS_MAX; i++) endRun(s.start(start(10), false), 'closed', 1000 + i);
    endRun(s.start(start(10), false), 'closed', 9000); // one over
    const deferred = s.saveAsync(); // its slices yield: the sync save below runs first
    endRun(s.start(start(10), false), 'closed', 9001);
    s.save(); // prunes two and commits
    const after = { rolled: structuredClone(s.rolledUp()), size: s.list().length };
    expect(await deferred).toBe(true);
    expect(s.rolledUp()).toEqual(after.rolled);
    expect(s.list()).toHaveLength(after.size);
    const disk = new AgentRunStore(dir);
    expect(disk.rolledUp()).toEqual(after.rolled);
    expect(disk.list()).toHaveLength(after.size);
    s.close(); disk.close();
  }, 30_000);

  it('writeLocalTextAsync retries a locked rename without blocking, and drops a superseded write', async () => {
    const dir = tmpDir('sb-lsasync-');
    const file = path.join(dir, 'agent-runs.json');
    const real = fs.renameSync.bind(fs);
    let fails = 2;
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => { if (fails-- > 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); real(a, b); });
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    expect(await writeLocalTextAsync(file, 'uno\n', () => true, { waits: [30, 30] })).toBe(true);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0); // the event loop kept running during the waits
    expect(fs.readFileSync(file, 'utf8')).toBe('uno\n');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await writeLocalTextAsync(file, 'due\n', () => false)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('uno\n');
    expect(tmps(dir)).toEqual([]);
  });
});
