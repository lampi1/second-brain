// leased-kill: the kill paths fail safe while a lease is held (ADR 0338): a kill in flight, an unreadable or late member
// list, a helper that does not answer and the tree kill without a job all leave the leased process alive, and none of
// them terminates or closes a job not proven free of leases. The helper, the process list and the kills are played by
// the test; time is fake.
import type * as ChildProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => [] as string[]);
vi.mock('node:child_process', async orig => ({
  ...(await orig<typeof ChildProcess>()),
  spawn: (cmd: string, args: string[]) => { spawned.push([cmd, ...args].join(' ')); return { on() {}, unref() {} }; },
}));
import { killTrees } from '../../../src/main/chats/cli';
import { JobGuard, jobGuard, killEngineTree, type JobMember } from '../../../src/main/chats/jobguard';
import { setLeaseReader } from '../../../src/main/chats/leased-procs';
import { killSparing, type Proc } from '../../../src/main/chats/proctree';

const JOB: JobMember[] = [
  { pid: 100, ppid: 1, name: 'claude.exe' }, { pid: 101, ppid: 100, name: 'bash.exe' },
  { pid: 300, ppid: 101, name: 'dotnet.exe' }, { pid: 301, ppid: 300, name: 'node.exe' },
];
const line = (members: JobMember[]): string => `ok ${members.map(m => `${m.pid}:${m.ppid}:${m.name}`).join('|')}`;
type Inner = { jobs: Set<number>; loosened: Set<number>; proc: unknown; st: string; call: (cmd: string, job: number) => Promise<string> };

/** Plays the helper behind `g`: `answer` per command (null = it never answers). */
function play(g: JobGuard, answer: (cmd: string) => string | Promise<string> | null, jobs = [7]): { asked: string[]; wrote: string[]; closed: () => boolean; helperKilled: () => boolean } {
  const asked: string[] = [], wrote: string[] = [];
  let closed = false, killed = false;
  const inner = g as unknown as Inner;
  for (const j of jobs) inner.jobs.add(j);
  inner.proc = { stdin: { write: (l: string) => { wrote.push(l.trim().split(' ').slice(1, 3).join(' ')); return true; }, end: () => { closed = true; } }, kill: () => { killed = true; } };
  inner.st = 'ready';
  inner.call = (cmd, job) => { asked.push(`${cmd} ${job}`); const r = answer(cmd); return r === null ? new Promise(() => {}) : Promise.resolve(r); };
  return { asked, wrote, closed: () => closed, helperKilled: () => killed };
}
const withEnds = (): { g: JobGuard; ended: number[] } => { const ended: number[] = []; return { g: new JobGuard(pid => { ended.push(pid); }), ended }; };

describe('kills while a lease is held', () => {
  beforeEach(() => { vi.useFakeTimers(); spawned.length = 0; setLeaseReader(() => new Set([300])); });
  afterEach(() => { vi.useRealTimers(); setLeaseReader(() => new Set()); });

  for (const bad of ['err list win32 234', 'err timeout', 'ok 100:1:claude.exe|garbage']) {
    it(`an unreadable member list (${bad}) never terminates the job: it is released, the caller kills by pid`, async () => {
      const { g, ended } = withEnds();
      const h = play(g, cmd => (cmd === 'list' ? bad : 'ok'));
      expect(await g.kill(7, 'c1')).toBe(false);
      expect(h.asked).toEqual(['list 7', 'release 7']);
      expect(ended).toEqual([]);
      expect(g.has(7)).toBe(false);
    });

    it(`an unreadable member list (${bad}) at the quit: released before the jobs close`, async () => {
      const { g, ended } = withEnds();
      const h = play(g, cmd => (cmd === 'list' ? bad : 'ok'));
      await g.quit(1);
      expect(h.asked).toEqual(['list 7', 'release 7', 'quit 0']);
      expect(ended).toEqual([]);
    });

    it(`an unreadable member list (${bad}) on the minute tick: the job stops dying with the app`, async () => {
      const { g } = withEnds();
      const h = play(g, cmd => (cmd === 'list' ? bad : 'ok'));
      await g.loosenLeased();
      expect(h.asked).toEqual(['list 7', 'loosen 7']);
    });
  }

  it('a kill in flight is waited for by the quit: the job is released before it closes the others', async () => {
    const { g, ended } = withEnds();
    let reply: (r: string) => void = () => {};
    const h = play(g, cmd => (cmd === 'list' ? new Promise<string>(r => { reply = r; }) : 'ok'));
    const kill = g.kill(7);
    const quit = g.quit(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.asked).toEqual(['list 7']);
    reply(line(JOB));
    expect(await kill).toBe(true);
    await quit;
    expect(h.asked).toEqual(['list 7', 'release 7', 'quit 0']);
    expect(ended).toEqual([100, 101]);
  });

  it('a kill in flight at closeAll whose list comes after the deadline: released first, never terminated later', async () => {
    const { g, ended } = withEnds();
    let reply: (r: string) => void = () => {};
    const h = play(g, cmd => (cmd === 'list' ? new Promise<string>(r => { reply = r; }) : 'ok'));
    const kill = g.kill(7);
    const close = g.closeAll();
    await vi.advanceTimersByTimeAsync(1500);
    await close;
    expect(h.asked).toEqual(['list 7', 'release 7', 'closeall 0']);
    // even when the late list holds no lease any more the job is not terminated: it is not ours any more
    reply(line(JOB.slice(0, 2)));
    await kill;
    expect(h.asked).toEqual(['list 7', 'release 7', 'closeall 0']);
    expect(ended).toEqual([100, 101]);
  });

  it('a list that never answers: every job not proven free is released at the deadline, a proven one closes', async () => {
    const { g, ended } = withEnds();
    const h = play(g, () => 'ok', [7, 8]);
    const inner = g as unknown as Inner;
    inner.call = (cmd, job) => { h.asked.push(`${cmd} ${job}`); return cmd === 'list' && job === 8 ? new Promise(() => {}) : Promise.resolve(cmd === 'list' ? line(JOB.slice(0, 2)) : 'ok'); };
    const quit = g.quit(1);
    await vi.advanceTimersByTimeAsync(1000);
    await quit;
    expect(h.asked).toEqual(['list 7', 'list 8', 'release 8', 'quit 0']);
    expect(ended).toEqual([]);
  });

  it('a helper that does not confirm closeall is not ended while a lease is held', async () => {
    const { g } = withEnds();
    const h = play(g, cmd => (cmd === 'closeall' ? 'err timeout' : cmd === 'list' ? null : 'ok'));
    const close = g.closeAll();
    await vi.advanceTimersByTimeAsync(1500);
    await close;
    expect(h.asked).toEqual(['list 7', 'release 7', 'closeall 0']);
    expect(h.helperKilled()).toBe(false);
    expect(h.closed()).toBe(true);
  });

  it('the synchronous stop releases the jobs first and leaves the helper to end by itself; without leases it is ended', () => {
    const { g } = withEnds();
    const h = play(g, () => 'ok', [7, 8]);
    g.stop();
    expect(h.wrote).toEqual(['release 7', 'release 8']);
    expect([h.closed(), h.helperKilled()]).toEqual([true, false]);
    setLeaseReader(() => new Set());
    const other = withEnds().g, o = play(other, () => 'ok');
    other.stop();
    expect([o.wrote, o.closed(), o.helperKilled()]).toEqual([[], true, true]);
  });

  const T = Date.now() - 60_000;
  const p = (pid: number, ppid: number, at: number, name: string): Proc => ({ pid, ppid, created: T + at, name });
  const PROCS = [p(100, 1, 0, 'claude.exe'), p(101, 100, 1000, 'bash.exe'), p(300, 101, 2000, 'dotnet.exe'), p(301, 300, 3000, 'node.exe'), p(400, 1, 0, 'node.exe')];

  it('the tree kill without a job walks the list, children first, and leaves the leased stack', async () => {
    const ended: number[] = [];
    await killSparing([100], { list: async () => PROCS, end: pid => { ended.push(pid); } });
    expect(ended).toEqual([101, 100]);
    // a leased root stays with all its tree
    ended.length = 0;
    await killSparing([300], { list: async () => PROCS, end: pid => { ended.push(pid); } });
    expect(ended).toEqual([]);
  });

  it('a pid taken by another program since the kill was asked is not killed; no list = only the pids themselves', async () => {
    const ended: number[] = [];
    await killSparing([100], { list: async () => PROCS, end: pid => { ended.push(pid); }, since: T - 1 });
    expect(ended).toEqual([]);
    const fallback = vi.fn();
    await killSparing([100], { list: async () => null, end: pid => { ended.push(pid); }, fallback });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(ended).toEqual([]);
    await killSparing([100, 300], { list: async () => null, end: pid => { ended.push(pid); } });
    expect(ended).toEqual([100]);
  });

  it('killTrees never runs taskkill /T (nor a group kill) while a lease is held', async () => {
    const group = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const ended: number[] = [];
      killTrees([100], { sparing: { list: async () => PROCS, end: pid => { ended.push(pid); } } });
      killTrees([101, 300], { tree: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(ended).toEqual([101, 100]);
      expect(spawned.filter(c => c.includes('/T'))).toEqual([]);
      expect([...spawned, ...group.mock.calls.map(c => String(c[0]))].join(' ')).not.toMatch(/\b300\b/);
    } finally { group.mockRestore(); }
  });

  it('killEngineTree falls back to the sparing kill when the job list is unreadable', async () => {
    const inner = jobGuard as unknown as Inner;
    const before = { proc: inner.proc, st: inner.st, call: inner.call };
    try {
      const h = play(jobGuard, cmd => (cmd === 'list' ? 'err timeout' : 'ok'), [77]);
      const ended: number[] = [];
      expect(killEngineTree(100, 77, () => {}, 'c1', { list: async () => PROCS, end: pid => { ended.push(pid); } })).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.asked).toEqual(['list 77', 'release 77']);
      expect(ended).toEqual([101, 100]);
      expect(spawned).toEqual([]);
    } finally { Object.assign(inner, before); inner.jobs.clear(); }
  });
});
