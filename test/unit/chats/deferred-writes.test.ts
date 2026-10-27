// The deferred store writes (writeDelayMs, the main-process freezes of 2026-10-27): chats.json and agent-runs.json are
// written once per burst, asynchronously, and nothing is lost on quit or exit (the pending writes are flushed
// synchronously). Also pins the async writer's rules: a newer write always wins over an older one still in flight, a
// locked rename is retried without blocking, an unchanged body is not written again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { ChatStore, type StoredChat } from '../../../src/main/chats/store';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { writeLocalTextAsync } from '../../../src/main/agents/local-store';
import { log } from '../../../src/main/log';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
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
  const runs = () => { try { return (JSON.parse(fs.readFileSync(path.join(dir, 'agent-runs.json'), 'utf8')) as { runs: { chatId: string }[] }).runs; } catch { return []; } };
  return { m, dir, create, chats, runs };
}

describe('ChatManager with writeDelayMs', () => {
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
    const writes = vi.spyOn(fs.promises, 'writeFile');
    for (let i = 0; i < 5; i++) f.m.resumedByUser(a.id, CORRECTION);
    expect(writes).not.toHaveBeenCalled(); // nothing written in-line
    await vi.waitFor(() => expect(f.chats().find(c => c.id === a.id)?.run?.corrections?.tagged).toBe(5), { timeout: 3000 });
    await vi.waitFor(() => expect((f.runs() as { chatId: string; corrections?: { tagged: number } }[]).find(r => r.chatId === a.id)?.corrections?.tagged).toBe(5), { timeout: 3000 });
    const of = (name: string) => writes.mock.calls.filter(([p]) => path.basename(String(p)).startsWith(name)).length;
    expect(of('chats.json')).toBe(1); // five changes, ten saves asked: one write per file
    expect(of('agent-runs.json')).toBe(1);
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

  it('AgentRunStore: flush() at quit writes over a deferred write still in flight', async () => {
    const dir = tmpDir('sb-runstore-');
    const runs = new AgentRunStore(dir);
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
