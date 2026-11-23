// leased-procs: the processes bound to a held lease (<brain>/ops/state/envs.json) and what they started are never killed,
// by the sweep's walk nor by the kill of a job that holds them; a lease with no holder protects nothing.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobGuard, type JobMember } from '../../../src/main/chats/jobguard';
import { leasedIn, readLeasedPids, setLeaseReader } from '../../../src/main/chats/leased-procs';
import { quitReapScript, type Proc } from '../../../src/main/chats/proctree';
import { sweepOnce, type EngineRoot } from '../../../src/main/chats/sweep';
import { tmp } from './helpers';

const T = 1_760_000_000_000;
const p = (pid: number, ppid: number, at: number, name: string): Proc => ({ pid, ppid, created: T + at, name });

/** A guard whose helper is played by the test: answers per command, what it was asked, what it ended. */
function guard(members: JobMember[]) {
  const asked: string[] = [], ended: number[] = [];
  const g = new JobGuard(pid => { ended.push(pid); });
  const inner = g as unknown as { jobs: Set<number>; proc: object; st: string; call: (cmd: string, job: number) => Promise<string> };
  inner.jobs.add(7);
  inner.proc = {};
  inner.st = 'ready';
  inner.call = async (cmd, job) => { asked.push(`${cmd} ${job}`); return cmd === 'list' ? `ok ${members.map(m => `${m.pid}:${m.ppid}:${m.name}`).join('|')}` : 'ok'; };
  return { g, asked, ended };
}
const JOB: JobMember[] = [
  { pid: 100, ppid: 1, name: 'claude.exe' }, { pid: 101, ppid: 100, name: 'bash.exe' }, { pid: 102, ppid: 101, name: 'electron.exe' },
  { pid: 300, ppid: 999, name: 'dotnet.exe' }, { pid: 301, ppid: 300, name: 'Site.exe' },
];

describe('leased processes', () => {
  afterEach(() => { setLeaseReader(() => new Set()); });

  it('reads the pids of held leases only; no brain or a broken file = none', () => {
    const brain = tmp('lease');
    fs.mkdirSync(path.join(brain, 'ops', 'state'), { recursive: true });
    const file = path.join(brain, 'ops', 'state', 'envs.json');
    fs.writeFileSync(file, JSON.stringify({ 'stack-a': { holder: { chat: 'x', pids: [300, 301, 'no', -1] }, queue: [] }, 'stack-b': { holder: null }, 'test-1': { holder: { chat: 'y' } } }));
    expect([...readLeasedPids(brain)]).toEqual([300, 301]);
    fs.writeFileSync(file, '{');
    expect(readLeasedPids(brain).size).toBe(0);
    expect(readLeasedPids(null).size).toBe(0);
  });

  it('covers what a leased process started', () => {
    expect([...leasedIn(JOB, new Set([300]))]).toEqual([300, 301]);
    expect(leasedIn(JOB, new Set()).size).toBe(0);
  });

  it('the sweep never walks into a leased stack; its unleased siblings still go', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: 'run', lastSeen: T + 60_000, exited: T + 60_000 };
    const procs = [p(200, 100, 1000, 'bash.exe'), p(201, 200, 2000, 'dotnet.exe'), p(202, 201, 3000, 'node.exe'), p(203, 200, 3000, 'node.exe')];
    setLeaseReader(() => new Set([201]));
    expect(sweepOnce([root], procs, { live: [], open: [] }, T + 120_000, 'run').orphans.map(x => x.pid).sort()).toEqual([200, 203]);
  });

  it('the reap left to the quit carries the leased pids too', () => {
    setLeaseReader(() => new Set([201, 202]));
    expect(quitReapScript([{ pid: 100, created: T, exited: T }])).toContain('$leased = @(201, 202)');
  });

  it('killing a job with a leased stack ends the rest of the tree one by one and lets the stack go', async () => {
    const { g, asked, ended } = guard(JOB);
    setLeaseReader(() => new Set([300]));
    expect(await g.kill(7, 'c1')).toBe(true);
    expect(ended).toEqual([100, 101, 102]);
    expect(asked).toEqual(['list 7', 'release 7']);
  });

  it('a job with nothing leased is terminated whole (the engine, its shells, the dev Electron under them)', async () => {
    const { g, asked, ended } = guard(JOB);
    expect(await g.kill(7, 'c1')).toBe(true);
    expect(asked).toEqual(['kill 7']);
    setLeaseReader(() => new Set([5555]));
    const other = guard(JOB);
    expect(await other.g.kill(7)).toBe(true);
    expect(other.asked).toEqual(['list 7', 'kill 7']);
    expect([...ended, ...other.ended]).toEqual([]);
  });

  it('a job that holds a leased stack stops dying with the app, once; at quit its other members are ended first', async () => {
    const { g, asked, ended } = guard(JOB);
    setLeaseReader(() => new Set([300]));
    await g.loosenLeased();
    await g.loosenLeased();
    expect(asked).toEqual(['list 7', 'loosen 7']);
    await g.quit(1);
    expect(ended).toEqual([100, 101, 102]);
    expect(asked.slice(2)).toEqual(['list 7', 'release 7', 'quit 0']);
  });
});
