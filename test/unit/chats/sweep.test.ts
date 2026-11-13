// sweep: the orphan sweep's bookkeeping (engines remembered with their real creation time and app run; tools of an
// ended engine killed once its chat is gone or its run is over; never while its chat is open in this run; old roots
// forgotten), the per-name counts of its log line, and the idle tick that releases engines.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Proc } from '../../../src/main/chats/proctree';
import { EngineSweeper, ROOT_TTL_MS, countByName, sweepOnce, type EngineRoot } from '../../../src/main/chats/sweep';
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
  });
});
