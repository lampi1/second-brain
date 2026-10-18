// Agent metrics (A6) after the correctness review of PR 22 (docs/reviews/pr-22.md on review/pr-22): a run pruned into
// the rollups is never counted again after a restart, a run report goes to the turn it belongs to (a turn that died
// without a result or a queued turn included), and agents:metrics answers from memory when agent-runs.json cannot be
// written. Uses the same fake-session ChatManager fixture as agent-runs-manager.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { ChatStore } from '../../../src/main/chats/store';
import { compatibleOwner } from '../../../src/main/agents/catalog';
import { RUNS_MAX, endRun } from '../../../src/main/agents/runs';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.useRealTimers(); for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** idleOnStart = false: a new session reports no state at start (so only its own exit can end the old turn). */
function fixture(extra: Partial<ChatManagerOptions> = {}, idleOnStart = true) {
  const dir = extra.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-22-'));
  if (!extra.userData) roots.push(dir);
  const sinks = new Map<string, SessionSink>();
  let last!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (_h, _o, s) => {
    last = s;
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (idleOnStart) s.changed({ state: 'idle' }); }, send() {},
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  const create = async () => {
    const c = await m.create({ harness: 'claude', cwd: dir, prompt: 'Rivedi il PR' }, 'user',
      { owner: { ...compatibleOwner('claude', null), source: 'catalog', id: 'reviewer', version: 3 }, instructions: 'Sei un revisore.', policy: null }, {});
    sinks.set(c.id, last);
    return c;
  };
  const run = (id: string) => m.list().find(x => x.id === id)?.run;
  return { m, dir, create, run, sink: (id: string) => sinks.get(id)!, latest: () => last };
}
const report = (o: object) => `Fatto.\n\n\`\`\`run-report\n${JSON.stringify(o)}\n\`\`\``;
const reply = (sink: SessionSink, text: string, at: number) => {
  sink.item({ kind: 'assistant', id: `a${at}`, at, text }, false);
  sink.item({ kind: 'result', id: `r${at}`, at, costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
};
const storedChat = (dir: string, id: string) =>
  (JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: { id: string; run?: unknown; runPruned?: string }[] }).chats.find(x => x.id === id);

describe('a pruned run is never counted again', () => {
  it('a chat whose run was pruned into the rollups gets no new backfilled run after a restart (no double count)', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.archive(c.id); // the run ends as closed: the oldest end in the store
    const base = Date.now() + 1000;
    // the store reaches RUNS_MAX: the oldest ended run (the chat's) is folded into the rollups and pruned
    for (let i = 0; i < RUNS_MAX; i++) endRun(f.m.runs.start({ chatId: `filler-${i}`, agentId: 'filler', version: 1, goal: 'x', startedBy: 'user', startedAt: base, costKnown: true }, false), 'closed', base + i);
    f.m.runs.save();
    expect(f.run(c.id)).toBeUndefined(); // onPrune dropped the mirror
    const before = f.m.runMetrics().find(a => a.agentId === 'reviewer')!;
    expect(before.versions.reduce((n, v) => n + v.ended, 0)).toBe(1); // the rollup: 1 ended run of reviewer v3
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);

    // the same run must never be counted again: still 1 reviewer run in the metrics after each restart (before the
    // fix every start backfilled a v0 run for the chat, the full store pruned it into the reviewer/0 rollup at once,
    // and the count grew by one per restart: 2, 3, 4…)
    const totals: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g = fixture({ userData: f.dir });
      const after = g.m.runMetrics().find(a => a.agentId === 'reviewer')!;
      totals.push(after.versions.reduce((n, v) => n + v.ended, 0) + after.open);
      await g.m.shutdown(); managers.splice(managers.indexOf(g.m), 1);
    }
    expect(totals).toEqual([1, 1, 1]);
  });

  it('keeps the pruned run’s id in chats.json in place of its mirror', async () => {
    const f = fixture();
    const c = await f.create();
    const id = f.run(c.id)!.runId;
    await f.m.archive(c.id);
    const base = Date.now() + 1000;
    for (let i = 0; i < RUNS_MAX; i++) endRun(f.m.runs.start({ chatId: `filler-${i}`, agentId: 'filler', version: 1, goal: 'x', startedBy: 'user', startedAt: base, costKnown: true }, false), 'closed', base + i);
    f.m.runs.save();
    const stored = storedChat(f.dir, c.id)!;
    expect(stored.run).toBeUndefined();
    expect(stored.runPruned).toBe(id);
  });

  it('a mirror dropped at load (its run already pruned) is remembered too: no v0 run on this start or the next', async () => {
    const f = fixture();
    const c = await f.create();
    const id = f.run(c.id)!.runId;
    await f.m.archive(c.id);
    const endedAt = f.run(c.id)!.endedAt!;
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    // the store pruned the run but chats.json still holds its mirror (e.g. the app stopped before chats.json was written)
    fs.writeFileSync(path.join(f.dir, 'agent-runs.json'), JSON.stringify({ version: 1, runs: [], prunedThrough: endedAt }));

    const g = fixture({ userData: f.dir });
    expect(g.run(c.id)).toBeUndefined();
    expect(g.m.runs.list()).toHaveLength(0);
    await g.m.shutdown(); managers.splice(managers.indexOf(g.m), 1);
    expect(storedChat(f.dir, c.id)).toMatchObject({ runPruned: id });
    expect(storedChat(f.dir, c.id)?.run).toBeUndefined();

    const h = fixture({ userData: f.dir });
    expect(h.run(c.id)).toBeUndefined();
    expect(h.m.runs.list()).toHaveLength(0);
  });

  it('chats.json keeps only a well-formed pruned run id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-22-')); roots.push(dir);
    const chat = { harness: 'claude', cwd: dir, sessionId: null, title: 'x', model: null, effort: null, permissionMode: null, isRegia: false, createdAt: 1 };
    fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: [
      { ...chat, id: 'a', runPruned: 'r_0123456789ab' }, { ...chat, id: 'b', runPruned: 'not-a-run' }, { ...chat, id: 'c', runPruned: 7 },
    ] }));
    const loaded = new ChatStore(dir).load();
    expect(loaded.map(c => c.runPruned)).toEqual(['r_0123456789ab', undefined, undefined]);
  });
});

describe('a run report goes to its own turn', () => {
  it('a fresh turn before delayed idle cannot overwrite a run completed after the previous result', async () => {
    const f = fixture();
    const c = await f.create();
    const s = f.sink(c.id);
    s.changed({ state: 'running' });
    reply(s, report({ outcome: 'done', verified: 'yes', summary: 'prima' }), Date.now());
    await f.m.set(c.id, { workStatus: 'completed' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(f.run(c.id)!.endedAt! + 100);
    // Claude emits submission on a fresh send or autonomous activity, even when running is unchanged.
    s.changed({ effortSubmitted: null });
    reply(s, report({ outcome: 'blocked', verified: 'no', summary: 'dopo la fine' }), Date.now());
    expect(f.run(c.id)?.report).toMatchObject({ ok: true, summary: 'prima' });
  });

  it('a turn that died without a result does not let a later post-end turn overwrite the ended run’s report', async () => {
    const f = fixture();
    const c = await f.create();
    const s = f.sink(c.id);
    reply(s, report({ outcome: 'done', verified: 'yes', summary: 'prima' }), Date.now());
    s.changed({ state: 'running' }); // a turn starts...
    s.changed({ state: 'error' }); // ...and the CLI dies: no result, r.turnAt stays set
    await f.m.set(c.id, { workStatus: 'completed' }); // its Regia completes the run while idle
    const ended = f.run(c.id)!.endedAt!;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ended + 60_000);
    s.changed({ state: 'running' }); // the Regia writes to the chat later: a turn after the end (no reopen)
    reply(s, report({ outcome: 'blocked', verified: 'no', summary: 'dopo la fine' }), Date.now());
    expect(f.run(c.id)?.report).toMatchObject({ ok: true, summary: 'prima' }); // an ended run takes nothing
  });

  it('a queued turn during which the run is completed still takes its report', async () => {
    const f = fixture();
    const c = await f.create();
    const s = f.sink(c.id);
    s.changed({ state: 'running' });
    reply(s, 'primo turno, nessun report', Date.now()); // the CLI had a queued message: the chat stays running
    await f.m.set(c.id, { workStatus: 'completed' }); // the Regia completes the run during the queued turn
    reply(s, report({ outcome: 'done', verified: 'yes', summary: 'turno in coda' }), Date.now() + 1);
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed', report: { ok: true, summary: 'turno in coda' } });
  });

  it('a session that exits mid-turn ends that turn: a later post-end turn in a new session takes nothing', async () => {
    const f = fixture({}, false);
    const c = await f.create();
    const s = f.sink(c.id);
    reply(s, report({ outcome: 'done', verified: 'yes', summary: 'prima' }), Date.now());
    s.changed({ state: 'running' }); // a turn starts...
    s.exit({ code: 1, error: 'crash' }); // ...and the engine is gone with no result and no state change of its own
    await f.m.set(c.id, { workStatus: 'completed' });
    const ended = f.run(c.id)!.endedAt!;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ended + 60_000);
    await f.m.send(c.id, 'continua', undefined, false, 'regia'); // a new session (no reopen: not the user)
    const t = f.latest();
    expect(t).not.toBe(s);
    t.changed({ state: 'running' });
    reply(t, report({ outcome: 'blocked', verified: 'no', summary: 'dopo la fine' }), Date.now());
    expect(f.run(c.id)).toMatchObject({ endReason: 'completed', report: { ok: true, summary: 'prima' } });
  });

  it('a turn that ends with a result and goes idle does not lend its start to the next turn', async () => {
    const f = fixture();
    const c = await f.create();
    const s = f.sink(c.id);
    s.changed({ state: 'running' });
    reply(s, report({ outcome: 'done', verified: 'yes', summary: 'prima' }), Date.now());
    s.changed({ state: 'idle' });
    await f.m.set(c.id, { workStatus: 'completed' });
    const ended = f.run(c.id)!.endedAt!;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ended + 60_000);
    s.changed({ state: 'running' });
    reply(s, report({ outcome: 'blocked', verified: 'no', summary: 'dopo la fine' }), Date.now());
    expect(f.run(c.id)?.report).toMatchObject({ ok: true, summary: 'prima' });
  });
});

describe('agents:metrics on a failed write', () => {
  it('runMetrics still answers from memory when agent-runs.json cannot be written', async () => {
    const f = fixture();
    const c = await f.create();
    // agent-runs.json cannot be replaced (on Windows: a lock held by an antivirus or indexer; here: a directory)
    fs.rmSync(path.join(f.dir, 'agent-runs.json'));
    fs.mkdirSync(path.join(f.dir, 'agent-runs.json'));
    f.sink(c.id).changed({ contextTokens: 500 }); // touch(): the store is dirty
    expect(() => f.m.runMetrics()).not.toThrow();
  });

  it('the answer from memory has the open run in it', async () => {
    const f = fixture();
    const c = await f.create();
    fs.rmSync(path.join(f.dir, 'agent-runs.json'));
    fs.mkdirSync(path.join(f.dir, 'agent-runs.json'));
    f.sink(c.id).changed({ contextTokens: 500 });
    expect(f.m.runMetrics().find(a => a.agentId === 'reviewer')).toMatchObject({ open: 1 });
  });
});
