// sweep-safety: what the orphan sweep must never kill (ADR 0338): a program that took a recorded engine's pid within the
// spawn slack, this app, an engine of this run; nothing from a record of engines.json that is not fully valid, and a
// walk with a bad time kills nothing. Also: engines.json is replaced whole, never left half written.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { descendants, quitReapRoots, type Proc } from '../../../src/main/chats/proctree';
import { EngineSweeper, parseRoots, sweepOnce, touchRoots, type EngineRoot } from '../../../src/main/chats/sweep';
import { tmp } from './helpers';

const T = 1_760_000_000_000;
const p = (pid: number, ppid: number, at: number, name = 'node.exe'): Proc => ({ pid, ppid, created: T + at, name });
const RUN = 'run-now';
const noted = (o: Partial<EngineRoot> = {}): EngineRoot => ({ pid: 100, created: T, approx: true, name: 'claude.exe', chatId: 'c1', run: '999-1', lastSeen: T + 1000, exited: null, ...o });
const pids = (roots: EngineRoot[], procs: Proc[], live: { chatId: string; pid: number }[] = [], self = 1): number[] =>
  sweepOnce(roots, procs, { live, open: [] }, T + 99_000, RUN, T + 99_000, self).orphans.map(x => x.pid);

describe('a recorded pid reused within the spawn slack', () => {
  it('the real engine still goes (name compared without case)', () => {
    expect(pids([noted()], [p(100, 50, 2000, 'Claude.EXE'), p(200, 100, 3000)])).toEqual([200, 100]);
  });

  it('by the user\'s program: neither it nor what it started', () => {
    expect(pids([noted()], [p(100, 50, 2000, 'EXCEL.EXE'), p(200, 100, 3000)])).toEqual([]);
    expect(pids([noted()], [p(100, 50, 2000, 'node.exe'), p(200, 100, 3000)])).toEqual([]);
    expect(pids([noted()], [{ pid: 100, ppid: 50, created: T + 2000 }, p(200, 100, 3000)])).toEqual([]);
  });

  it('a record with no name (an older version\'s) kills no engine, exact time or not', () => {
    const { name: _n, ...bare } = noted();
    expect(pids([bare], [p(100, 50, 0, 'claude.exe'), p(200, 100, 3000)])).toEqual([]);
    const { approx: _a, ...exact } = bare;
    expect(pids([exact], [p(100, 50, 0, 'claude.exe'), p(200, 100, 3000)])).toEqual([]);
  });

  it('by this app, even with the recorded name: neither it nor what it started', () => {
    expect(pids([noted({ name: 'electron.exe' })], [p(100, 50, 2000, 'electron.exe'), p(200, 100, 3000, 'electron.exe')], [], 100)).toEqual([]);
    // a process this app started
    expect(pids([noted({ name: 'electron.exe' })], [p(60, 50, 0, 'electron.exe'), p(100, 60, 2000, 'electron.exe')], [], 60)).toEqual([]);
    // the default is this process
    const own = noted({ pid: process.pid });
    expect(sweepOnce([own], [p(process.pid, 50, 2000, 'claude.exe')], { live: [], open: [] }, T + 99_000, RUN).orphans).toEqual([]);
  });

  it('by a live engine of this run, or one still starting: neither it nor what it started', () => {
    const procs = [p(100, 60, 2000, 'claude.exe'), p(200, 100, 3000)];
    const r = sweepOnce([noted()], procs, { live: [{ chatId: 'c2', pid: 100 }], open: ['c2'] }, T + 99_000, RUN, T + 99_000, 60);
    expect(r.orphans).toEqual([]);
    expect(r.roots.filter(x => x.run === RUN)).toMatchObject([{ pid: 100, created: T + 2000, chatId: 'c2', exited: null }]);
    const starting = noted({ run: RUN, created: T + 2100, chatId: 'c2', lastSeen: T + 98_000 });
    expect(pids([noted(), starting], procs)).toEqual([]);
  });

  it('a leased process recorded as an engine is not killed by name and time alone', async () => {
    const { setLeaseReader } = await import('../../../src/main/chats/leased-procs');
    setLeaseReader(() => new Set([100]));
    try { expect(pids([noted()], [p(100, 50, 0, 'claude.exe'), p(200, 100, 3000)])).toEqual([]); } finally { setLeaseReader(() => new Set()); }
  });

  it('this app started by an agent of an earlier run: never itself nor its engines, with what they run', () => {
    const procs = [p(101, 100, 1000, 'bash.exe'), p(60, 101, 2000, 'electron.exe'), p(300, 60, 3000, 'claude.exe'), p(301, 300, 4000, 'node.exe')];
    const live = [{ chatId: 'c2', pid: 300 }];
    expect(pids([noted()], [p(100, 50, 0, 'claude.exe'), ...procs], live, 60)).toEqual([101, 100]);
    expect(pids([noted({ exited: T + 1500 })], procs, live, 60)).toEqual([101]);
  });

  it('the name is recorded at spawn and kept between sweeps', () => {
    const a = touchRoots([], [], T, RUN, { pid: 100, chatId: 'c1', name: 'claude.exe' });
    expect(touchRoots(a, [{ chatId: 'c1', pid: 100 }], T + 60_000, RUN)[0]).toMatchObject({ name: 'claude.exe' });
  });
});

describe('engines.json', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const good = { pid: 100, created: T, chatId: 'c1', run: 'old', lastSeen: T + 1000, exited: T + 1000 };
  const without = (k: string): object => Object.fromEntries(Object.entries(good).filter(([x]) => x !== k));
  const bad: [string, object][] = [
    ['no exited', without('exited')], ['exited a string', { ...good, exited: `${T}` }], ['exited not finite', { ...good, exited: Infinity }],
    ['no lastSeen', without('lastSeen')], ['lastSeen null', { ...good, lastSeen: null }], ['lastSeen a string', { ...good, lastSeen: 'x' }],
    ['exited in the future', { ...good, exited: 9e15 }], ['lastSeen in the future', { ...good, lastSeen: 9e15 }],
    ['no created', without('created')], ['name not a string', { ...good, name: 3 }], ['pid 0', { ...good, pid: 0 }], ['null', null as unknown as object],
  ];

  it('drops every record that is not fully valid, keeps the others', () => {
    for (const [what, r] of bad) expect(parseRoots([r, good], Date.now()), what).toEqual([good]);
    expect(parseRoots([{ ...good, exited: null, name: 'claude.exe', approx: true }], Date.now())).toHaveLength(1);
    expect(parseRoots({}, Date.now())).toEqual([]);
  });

  it('a bad record kills nothing: not even a process born long after under the same pid', async () => {
    for (const [what, r] of bad) {
      const ud = tmp('sweep-bad');
      // JSON reads 1e999 as Infinity; stringify would write null, a valid value
      fs.writeFileSync(path.join(ud, 'engines.json'), JSON.stringify([r], (_k, v: unknown) => (v === Infinity ? 'INF' : v)).replace('"INF"', '1e999'));
      const killed: number[] = [];
      const sw = new EngineSweeper({
        userData: ud, owners: () => ({ live: [], open: [] }), idleMin: () => 0, releaseIdle: () => 0,
        list: async () => [p(200, 100, 500), p(201, 100, 90_000_000)], kill: pid => { killed.push(pid); },
      });
      await sw.sweep();
      expect(killed, what).toEqual([]);
    }
  });

  it('is written to a temp file and renamed; a write that fails leaves the old file whole', () => {
    const ud = tmp('sweep-atomic'), file = path.join(ud, 'engines.json');
    const sw = new EngineSweeper({ userData: ud, owners: () => ({ live: [], open: [] }), idleMin: () => 0, releaseIdle: () => 0 });
    sw.noteSpawn(4242, 'c9', 'claude.exe');
    const before = fs.readFileSync(file, 'utf8');
    const direct = vi.spyOn(fs, 'writeFileSync'), rename = vi.spyOn(fs, 'renameSync');
    sw.noteSpawn(4243, 'c9', 'claude.exe');
    expect(direct.mock.calls.map(c => c[0])).not.toContain(file);
    expect(rename.mock.calls.map(c => c[1])).toEqual([file]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(2);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).not.toBe(before);
    rename.mockImplementation(() => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); });
    sw.noteSpawn(4244, 'c9', 'claude.exe');
    expect(fs.readFileSync(file, 'utf8')).toBe(after);
    expect(fs.readdirSync(ud)).toEqual(['engines.json']);
    // what could not be written is not lost: the next minute's tick writes it
    rename.mockRestore();
    sw.idleTick();
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as EngineRoot[]).map(r => r.pid)).toEqual([4242, 4243, 4244]);
  });
});

describe('a walk with a bad time kills nothing', () => {
  it('descendants and the quit reap', () => {
    const procs = [p(200, 100, 1000), p(201, 100, 90_000_000)];
    expect(descendants(procs, { pid: 100, created: T, exited: T + 2000 }).map(x => x.pid)).toEqual([200]);
    for (const bad of [NaN, undefined as unknown as number, Infinity, 'x' as unknown as number]) {
      expect(descendants(procs, { pid: 100, created: T, exited: bad })).toEqual([]);
      expect(descendants(procs, { pid: 100, created: bad, exited: T + 2000 })).toEqual([]);
      expect(descendants(procs, { pid: 100, created: bad, exited: Infinity }, { live: true })).toEqual([]);
    }
    expect(quitReapRoots([{ pid: 1, created: T, exited: NaN }, { pid: 2, created: NaN, exited: T }, { pid: 3, created: 0, exited: T }, { pid: 4, created: T, exited: T }]).map(r => r.pid)).toEqual([4]);
  });
});
