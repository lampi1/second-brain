// proctree: which processes still descend from an engine that exited (parent ids + creation times, reused pids), and
// a real reap: an exited parent whose child keeps running.
// The quit reaper: an engine terminated directly, its child killed by a PowerShell that outlives the caller.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { descendants, parseProcList, psToList, quitReapScript, reapAfterQuit, reapTree, snapshotTrees, type Proc } from '../../../src/main/chats/proctree';
import { alive, killStray, tmp, waitFor } from './helpers';
import { killTrees } from '../../../src/main/chats/cli';

const T = 1_760_000_000_000;
const p = (pid: number, ppid: number, at: number, name = 'node.exe'): Proc => ({ pid, ppid, created: T + at, name });
const root = { pid: 100, created: T, exited: T + 30000 };
const ids = (l: Proc[]): number[] => l.map(x => x.pid).sort((a, b) => a - b);

describe('proctree', () => {
  it('parses pid ppid created name lines and skips the rest', () => {
    expect(parseProcList(`10 4 ${T} node.exe\r\ngarbage\n 11  10  ${T + 5} Microsoft Teams.exe \n12 1 ${T}\n`))
      .toEqual([p(10, 4, 0), p(11, 10, 5, 'Microsoft Teams.exe'), { pid: 12, ppid: 1, created: T }]);
  });

  it('kills only tools: a browser or Excel the chat opened stays, with everything it started', () => {
    const list = [p(200, 100, 1000, 'powershell.exe'), p(201, 200, 2000, 'chrome.exe'), p(202, 201, 2100, 'chrome.exe'),
      p(203, 201, 2200, 'node.exe'), p(204, 200, 2300, 'EXCEL.EXE'), p(205, 200, 2400, 'cmd.exe'), p(206, 205, 2500, 'mcp-server-postgres.exe')];
    expect(ids(descendants(list, root))).toEqual([200, 205, 206]);
  });

  it('finds the whole tree of a dead engine: MCP server, shell, and what the shell started', () => {
    const list = [p(1, 0, -99999), p(200, 100, 1000), p(201, 200, 2000), p(300, 100, 1500), p(999, 1, 500)];
    expect(ids(descendants(list, root))).toEqual([200, 201, 300]);
  });

  it('never takes a live process holding the engine\'s pid, nor what it started', () => {
    const list = [p(100, 1, 2000), p(200, 100, 1000), p(201, 100, 2500)];
    expect(ids(descendants(list, root))).toEqual([200]);
  });

  it('a pid reused after the exit by a process already gone: its orphans are not ours', () => {
    expect(ids(descendants([p(200, 100, 1000), p(300, 100, 45000)], root))).toEqual([200]);
  });

  it('never takes a process older than its parent (its parent id is a reused one)', () => {
    const list = [p(200, 100, -60000), p(300, 200, 1000), p(400, 100, 1000), p(401, 400, -30000)];
    expect(ids(descendants(list, root))).toEqual([400]);
  });

  it('a live engine (the quit picture): the engine in the list is itself, not a reuser; its children, deepest first', async () => {
    const list = [p(100, 1, 0, 'claude.exe'), p(200, 100, 1000), p(201, 200, 2000, 'cmd.exe'), p(202, 201, 3000), p(204, 200, 2300, 'EXCEL.EXE'), p(999, 1, 500)];
    expect(ids(descendants(list, root))).toEqual([]); // as a dead engine: pid 100 is someone else's now
    expect(ids(descendants(list, root, { live: true }))).toEqual([200, 201, 202]);
    const kids = snapshotTrees([100], 5000, async () => list);
    expect(kids(100)).toEqual([]); // nothing pictured yet: never awaited
    await waitFor(() => kids(100).length > 0, 'the picture');
    expect(kids(100)).toEqual([202, 201, 200]);
    expect(kids(555)).toEqual([]); // not in the picture
    expect(snapshotTrees([], 5000, async () => { throw new Error('no list without engines'); })(100)).toEqual([]);
  });

  it('nothing left: empty', () => {
    expect(descendants([p(5, 1, 0)], root)).toEqual([]);
  });

  it('a list that could not be read is never acted on', async () => {
    expect(await reapTree(root, { chatId: 'c', what: 't' }, { list: async () => null })).toBe(0);
  });

  it('kills the child an exited process left running (the real list, the real taskkill)', async () => {
    const out = path.join(tmp('reap'), 'child.txt');
    const keep = 'setTimeout(() => {}, 300000)';
    // detached: a Node parent's own job would kill the child with it; claude.exe and the shells have no such job
    const script = `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(keep)}], { detached: ${process.platform === 'win32'}, stdio: 'ignore', windowsHide: true });`
      + ` require('node:fs').writeFileSync(${JSON.stringify(out)}, String(c.pid)); setTimeout(() => process.exit(0), 300);`;
    const created = Date.now();
    const parent = spawn(process.execPath, ['-e', script], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    await new Promise(r => parent.once('exit', r));
    const child = Number(fs.readFileSync(out, 'utf8'));
    try {
      expect(alive(child)).toBe(true);
      expect(await reapTree({ pid: parent.pid ?? 0, created, exited: Date.now() }, { chatId: 'c', what: 'test' })).toBe(1);
      await waitFor(() => !alive(child), 'the orphan killed', 60000);
    } finally { killStray(child); }
  }, 150000); // WMI list 3-40 s + taskkill on a loaded box

  it('the host quit cleanup kills a terminated engine and its child (Windows reaper or POSIX process group)', async () => {
    const dir = tmp('quit-reap');
    const out = path.join(dir, 'child.txt');
    const keep = 'setTimeout(() => {}, 300000)';
    const script = `const c = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(keep)}], { detached: ${process.platform === 'win32'}, stdio: 'ignore', windowsHide: true });`
      + ` require('node:fs').writeFileSync(${JSON.stringify(out)}, String(c.pid)); ${keep};`;
    const created = Date.now();
    const parent = spawn(process.execPath, ['-e', script], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    const child = Number(await waitFor(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8'), 'the child started'));
    const was = process.env.SB_QUIT_REAP_DONE;
    process.env.SB_QUIT_REAP_DONE = dir;
    try {
      expect(alive(child)).toBe(true);
      parent.kill();
      if (process.platform !== 'win32') {
        // POSIX quit uses the engine's process group; the group remains owned after its leader exits.
        killTrees([parent.pid]);
        await waitFor(() => !alive(child), 'the process-group orphan killed', 5000);
        return;
      }
      reapAfterQuit([{ pid: parent.pid ?? 0, created, exited: Date.now() }]); // what killTreesWithin does at the cap: the kill, then the reaper
      // a reaper that never ends says how far it got (its PowerShell never ran, the WMI list never came back, or the
      // kills hung): 11-22 s at 85% CPU plus 8 WMI loops (2026-10-14), one full check still waited 183 s for nothing
      const at = (ph: string) => fs.existsSync(path.join(dir, `${parent.pid}.${ph}`));
      await waitFor(() => at('done'), 'the reaper done', 180000).catch((e: Error) => {
        throw new Error(`${e.message}: ${at('listed') ? 'process list taken, the kills did not end' : at('started') ? 'its PowerShell ran, the WMI process list never came back' : 'its PowerShell never ran (not started, or killed)'}`);
      });
      await waitFor(() => !alive(child), 'the orphan killed', 5000);
    } finally {
      if (was === undefined) delete process.env.SB_QUIT_REAP_DONE; else process.env.SB_QUIT_REAP_DONE = was;
      killStray(child);
    }
  }, 200000); // PowerShell start + WMI list, 3-40 s on a loaded box, more at 100% CPU

  it('the quit reaper takes many engines in one script, far under the 32 767-character command line', () => {
    const roots = Array.from({ length: 20 }, (_, i) => ({ pid: 1000 + i, created: T + i, exited: T + 60000 }));
    const encoded = Buffer.from(quitReapScript(roots, 'C:\\done'), 'utf16le').toString('base64');
    expect(encoded.length).toBeLessThan(16000);
    expect(quitReapScript(roots.slice(0, 1))).toContain(`,@(1000, ${T}, ${T + 60000})`); // one engine stays a triple
  });
});

describe('psToList (macOS/Linux process list, ADR 0054)', () => {
  it('retains group ownership after reparenting and preserves user programs and their tool children', () => {
    const list = parseProcList(psToList('200 1 100 00:10 node\n201 200 100 00:09 sh\n202 200 100 00:08 Google Chrome\n203 202 100 00:07 node\n300 1 300 00:05 node\n', T + 20000, true));
    expect(ids(descendants(list, root))).toEqual([200, 201]);
    expect(list.find(p => p.pid === 203)?.ppid).toBe(202);
    expect(list.find(p => p.pid === 300)?.ppid).toBe(1);
  });
  it('never bypasses a live user program that changed its process group after starting a tool', () => {
    const list = parseProcList(psToList('200 100 200 00:10 Google Chrome\n201 200 100 00:09 node\n', T + 20000, true));
    expect(list.find(p => p.pid === 201)?.ppid).toBe(200);
    expect(descendants(list, root)).toEqual([]);
  });
  it('etime and full comm paths become parseProcList lines; bad lines skipped', () => {
    const out = psToList('    1     0 3-00:00:00 /sbin/launchd\n  812     1    01:05 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n  900   812 00:02 node\ngarbage\n', 1_000_000_000);
    expect(parseProcList(out)).toEqual([
      { pid: 1, ppid: 0, created: 1_000_000_000 - 259_200_000, name: 'launchd' },
      { pid: 812, ppid: 1, created: 1_000_000_000 - 65_000, name: 'Google Chrome' },
      { pid: 900, ppid: 812, created: 1_000_000_000 - 2_000, name: 'node' },
    ]);
  });
});
