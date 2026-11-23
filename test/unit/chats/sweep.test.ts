// sweep: the orphan sweep's bookkeeping (engines remembered with their real creation time and app run; tools of an
// ended engine killed once its chat is gone or its run is over; never while its chat is open in this run; old roots
// forgotten), the per-name counts of its log line, and the idle tick that releases engines.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Proc } from '../../../src/main/chats/proctree';
import { EngineSweeper, ROOT_TTL_MS, SPAWN_SLACK_MS, countByName, sweepOnce, touchRoots, type EngineRoot } from '../../../src/main/chats/sweep';
import { tmp } from './helpers';

const T = 1_760_000_000_000;
const p = (pid: number, ppid: number, at: number, name = 'node.exe'): Proc => ({ pid, ppid, created: T + at, name });
const RUN = 'run-now';

describe('sweep', () => {
  it('remembers a running engine with its real creation time and kills nothing of it', () => {
    const procs = [p(100, 1, 0, 'claude.exe'), p(200, 100, 1000, 'node.exe')];
    const r = sweepOnce([], procs, { live: [{ chatId: 'c1', pid: 100 }], open: ['c1'] }, T + 5000, RUN);
    expect(r.roots).toEqual([{ pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 5000, exited: null }]);
    expect(r.orphans).toEqual([]);
  });

  it('an ended engine whose chat closed: its tools die, Excel stays', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 60_000, exited: null };
    const procs = [p(200, 100, 1000, 'node.exe'), p(201, 200, 2000, 'cmd.exe'), p(202, 100, 3000, 'EXCEL.EXE')];
    const r = sweepOnce([root], procs, { live: [], open: [] }, T + 120_000, RUN);
    expect(r.orphans.map(x => x.pid).sort()).toEqual([200, 201]);
    expect(r.roots[0]).toMatchObject({ exited: T + 60_000 });
  });

  it('never while its chat is open in this run (a kept dev server); always for an earlier run', () => {
    const procs = [p(200, 100, 1000)];
    const mine: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 60_000, exited: T + 60_000 };
    expect(sweepOnce([mine], procs, { live: [], open: ['c1'] }, T + 120_000, RUN).orphans).toEqual([]);
    const old: EngineRoot = { ...mine, run: 'crashed-run' };
    expect(sweepOnce([old], procs, { live: [], open: ['c1'] }, T + 120_000, RUN).orphans.map(x => x.pid)).toEqual([200]);
  });

  it('a pid reused by another process ends the root; old roots are forgotten', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 1000, exited: null };
    const procs = [p(100, 1, 50_000, 'chrome.exe'), p(300, 100, 60_000)]; // the reuser and its own child
    const r = sweepOnce([root], procs, { live: [], open: [] }, T + 70_000, RUN);
    expect(r.orphans).toEqual([]);
    expect(r.roots[0]?.exited).toBe(T + 1000);
    expect(sweepOnce(r.roots, [], { live: [], open: [] }, T + 1000 + ROOT_TTL_MS + 1, RUN).roots).toEqual([]);
  });

  it('an engine of an earlier run still alive after its app died: its tools, then the engine; Excel stays', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: '999-1', lastSeen: T + 1000, exited: null };
    const procs = [p(100, 1, 0, 'claude.exe'), p(200, 100, 1000, 'bash.exe'), p(201, 200, 2000, 'electron.exe'), p(202, 100, 3000, 'EXCEL.EXE')];
    const r = sweepOnce([root], procs, { live: [], open: [] }, T + 99_000, RUN);
    expect(r.orphans.map(x => [x.pid, x.reason])).toEqual([
      [201, 'left by an engine of an earlier app run'], [200, 'left by an engine of an earlier app run'], [100, 'engine of an earlier app run']]);
    expect(r.roots[0]?.exited).toBe(T + 99_000);
  });

  it('never an engine whose earlier run is still alive (a slow quit), nor a pid the app did not start', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: `500-${T - 3000}`, lastSeen: T + 1000, exited: null };
    const procs = [p(500, 1, -4000, 'electron.exe'), p(100, 1, 0, 'claude.exe'), p(200, 100, 1000, 'node.exe'), p(300, 1, 0, 'claude.exe')];
    expect(sweepOnce([root], procs, { live: [], open: [] }, T + 99_000, RUN).orphans).toEqual([]);
    // the run is gone, but the pid is now someone else's (another creation time): untracked, never killed
    const reused = [p(100, 1, 40_000, 'claude.exe'), p(200, 100, 41_000, 'node.exe'), p(300, 1, 0, 'claude.exe')];
    expect(sweepOnce([{ ...root, run: '999-1' }], reused, { live: [], open: [] }, T + 99_000, RUN).orphans).toEqual([]);
  });

  it('a root noted at spawn (our clock) matches its engine within the slack only', () => {
    const noted: EngineRoot = { pid: 100, created: T + 300, approx: true, chatId: 'c1', run: '999-1', lastSeen: T + 1000, exited: null };
    const procs = [p(100, 1, 0, 'claude.exe'), p(200, 100, 1000, 'node.exe')];
    expect(sweepOnce([noted], procs, { live: [], open: [] }, T + 99_000, RUN).orphans.map(x => x.pid)).toEqual([200, 100]);
    expect(sweepOnce([{ ...noted, created: T + SPAWN_SLACK_MS + 1 }], procs, { live: [], open: [] }, T + 99_000, RUN).orphans).toEqual([]);
    // this run: a sweep that sees it live makes it exact
    const mine = sweepOnce([{ ...noted, run: RUN }], procs, { live: [{ chatId: 'c1', pid: 100 }], open: ['c1'] }, T + 5000, RUN);
    expect(mine.roots).toEqual([{ pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 5000, exited: null }]);
  });

  it('an ended engine of this run: its grandchildren go too (dev Electron, tsc --watch, dotnet under its shell)', () => {
    const root: EngineRoot = { pid: 100, created: T, chatId: 'c1', run: RUN, lastSeen: T + 60_000, exited: T + 60_000 };
    const procs = [p(200, 100, 1000, 'bash.exe'), p(201, 200, 2000, 'node.exe'), p(202, 201, 3000, 'electron.exe'), p(203, 200, 4000, 'dotnet.exe')];
    expect(sweepOnce([root], procs, { live: [], open: [] }, T + 120_000, RUN).orphans.map(x => x.pid).sort()).toEqual([200, 201, 202, 203]);
  });

  it('a root noted while the process list ran is not judged by that list', () => {
    const noted: EngineRoot = { pid: 100, created: T + 10_000, approx: true, chatId: 'c1', run: RUN, lastSeen: T + 10_000, exited: null };
    const r = sweepOnce([noted], [], { live: [], open: ['c1'] }, T + 12_000, RUN, T + 5000);
    expect(r.roots[0]?.exited).toBeNull();
  });

  it('touchRoots notes a spawn at once and ends this run\'s roots no longer live, without a process list', () => {
    const a = touchRoots([], [], T, RUN, { pid: 100, chatId: 'c1' });
    expect(a).toEqual([{ pid: 100, created: T, approx: true, chatId: 'c1', run: RUN, lastSeen: T, exited: null }]);
    const b = touchRoots(a, [{ chatId: 'c1', pid: 100 }], T + 60_000, RUN);
    expect(b[0]).toMatchObject({ lastSeen: T + 60_000, exited: null });
    const c = touchRoots([...b, { pid: 7, created: 0, chatId: 'x', run: 'other', lastSeen: 0, exited: null }], [], T + 120_000, RUN);
    expect(c.map(r => [r.pid, r.exited])).toEqual([[100, T + 60_000], [7, null]]);
    // still booting (noted, not in the live list yet): not an end until the boot time is over
    expect(touchRoots(a, [], T + 30_000, RUN)[0]?.exited).toBeNull();
    expect(touchRoots(a, [], T + 61_000, RUN)[0]?.exited).toBe(T);
  });

  it('counts the names that pile up', () => {
    expect(countByName([p(1, 0, 0, 'node.exe'), p(2, 0, 0, 'Node.EXE'), p(3, 0, 0, 'taskkill.exe'), p(4, 0, 0, 'x.exe')]))
      .toMatchObject({ 'node.exe': 2, 'taskkill.exe': 1, 'claude.exe': 0 });
  });

  it('a sweep kills the orphans with TerminateProcess, writes engines.json; the idle tick releases after the setting', async () => {
    const ud = tmp('sweep');
    fs.writeFileSync(path.join(ud, 'engines.json'), JSON.stringify([{ pid: 100, created: T, chatId: 'gone', run: 'old', lastSeen: Date.now(), exited: null }]));
    const killed: number[] = [];
    let idleAsked = -1, min = 30;
    const sw = new EngineSweeper({
      userData: ud, owners: () => ({ live: [], open: [] }), idleMin: () => min,
      releaseIdle: ms => { idleAsked = ms; return 2; },
      list: async () => [{ pid: 200, ppid: 100, created: T + 1000, name: 'node.exe' }], kill: pid => { killed.push(pid); },
    });
    expect(await sw.sweep()).toBe(1);
    expect(killed).toEqual([200]);
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'engines.json'), 'utf8'))[0]).toMatchObject({ pid: 100, exited: expect.any(Number) });
    expect(sw.idleTick()).toBe(2);
    expect(idleAsked).toBe(30 * 60_000);
    min = 0; idleAsked = -1;
    expect(sw.idleTick()).toBe(0);
    expect(idleAsked).toBe(-1);
    // a spawn is in engines.json at once, before any sweep
    sw.noteSpawn(4242, 'c9');
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'engines.json'), 'utf8'))).toContainEqual(expect.objectContaining({ pid: 4242, chatId: 'c9', approx: true, exited: null }));
  });
});
