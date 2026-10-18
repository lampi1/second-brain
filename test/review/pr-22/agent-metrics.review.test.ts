// Review of PR 22 (agent metrics A6): failing tests that prove the correctness findings in docs/reviews/pr-22.md.
// Each test states the behaviour the PR intends and fails on the PR head because of the bug it names. Uses the same
// fake-session ChatManager fixture as test/unit/chats/agent-runs-manager.test.ts. Run:
// `npx vitest run --config test/review/pr-22/vitest.config.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { compatibleOwner } from '../../../src/main/agents/catalog';
import { RUNS_MAX, endRun } from '../../../src/main/agents/runs';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.useRealTimers(); for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-22-'));
  if (!extra.userData) roots.push(dir);
  const sinks = new Map<string, SessionSink>();
  let last!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (_h, _o, s) => {
    last = s;
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); }, send() {},
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
  return { m, dir, create, run, sink: (id: string) => sinks.get(id)! };
}
const report = (o: object) => `Fatto.\n\n\`\`\`run-report\n${JSON.stringify(o)}\n\`\`\``;
const reply = (sink: SessionSink, text: string, at: number) => {
  sink.item({ kind: 'assistant', id: `a${at}`, at, text }, false);
  sink.item({ kind: 'result', id: `r${at}`, at, costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
};

describe('PR 22 review: pruned run comes back as a v0 run', () => {
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

    // the same run must never be counted again: still 1 reviewer run in the metrics after each restart. On the PR head
    // every start backfills a v0 run for the chat (its mirror is gone), the full store prunes it into the reviewer/0
    // rollup at once, and the count grows by one per restart: 2, 3, 4…
    const totals: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g = fixture({ userData: f.dir });
      const after = g.m.runMetrics().find(a => a.agentId === 'reviewer')!;
      totals.push(after.versions.reduce((n, v) => n + v.ended, 0) + after.open);
      await g.m.shutdown(); managers.splice(managers.indexOf(g.m), 1);
    }
    expect(totals).toEqual([1, 1, 1]);
  });
});

describe('PR 22 review: turnAt is per running state, not per turn', () => {
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
});

describe('PR 22 review: agents:metrics fails on a failed write', () => {
  it('runMetrics still answers from memory when agent-runs.json cannot be written', async () => {
    const f = fixture();
    const c = await f.create();
    // agent-runs.json cannot be replaced (on Windows: a lock held by an antivirus or indexer; here: a directory)
    fs.rmSync(path.join(f.dir, 'agent-runs.json'));
    fs.mkdirSync(path.join(f.dir, 'agent-runs.json'));
    f.sink(c.id).changed({ contextTokens: 500 }); // touch(): the store is dirty
    expect(() => f.m.runMetrics()).not.toThrow();
  });
});
