// jobguard: the PowerShell helper's Job Objects on a real process tree (Windows only): a parent that spawns a child
// and exits leaves an orphan that taskkill /T can no longer find; the job still holds it, lists it (with its parent),
// kills it, lets it go on release, and kills what is left when the helper ends (the app quit or crashed). Plus the
// reap's filter over job members: only tools, never what a user program started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobGuard, parseMembers, type JobMember } from '../../../src/main/chats/jobguard';
import { jobTools } from '../../../src/main/chats/proctree';
import { alive, tmp, waitFor } from './helpers';

const win = process.platform === 'win32';

/** A node parent that waits for go() (called once it is in the job: a child born before would be outside it, which a
 *  fixed delay could not promise under a loaded full run), starts a long-lived child, writes its pid, then exits. The
 *  child is detached, like a Start-Process orphan: a plain node child sits in its parent's libuv kill-on-close job and
 *  died with the parent, which made the test fail under load (the job listed nothing or a dying pid). */
function orphanTree(dir: string): { parent: number; go: () => void; childPid: () => number | null } {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const out = path.join(dir, `child-${tag}.txt`), goFile = path.join(dir, `go-${tag}`);
  const code = `const fs = require('fs'); const t = setInterval(() => { if (!fs.existsSync(${JSON.stringify(goFile)})) return; clearInterval(t); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: true }); c.unref(); fs.writeFileSync(${JSON.stringify(out + '.tmp')}, String(c.pid)); fs.renameSync(${JSON.stringify(out + '.tmp')}, ${JSON.stringify(out)}); setTimeout(() => process.exit(0), 300); }, 50);`;
  const p = spawn(process.execPath, ['-e', code], { stdio: 'ignore', windowsHide: true });
  return {
    parent: p.pid!,
    go: () => fs.writeFileSync(goFile, ''),
    childPid: () => (fs.existsSync(out) ? Number(fs.readFileSync(out, 'utf8')) || null : null),
  };
}

const m = (pid: number, ppid: number, name: string): JobMember => ({ pid, ppid, name });

describe('jobguard', () => {
  const guards: JobGuard[] = [];
  const strays: number[] = [];
  afterEach(() => {
    for (const g of guards.splice(0)) g.stop();
    for (const pid of strays.splice(0)) { try { process.kill(pid); } catch { /* gone */ } }
    delete process.env.SB_JOBGUARD;
  });

  it('parses job members and skips bad parts', () => {
    expect(parseMembers('12:4:node.exe|x|34:12:Microsoft Teams.exe|')).toEqual([m(12, 4, 'node.exe'), m(34, 12, 'Microsoft Teams.exe')]);
  });

  it('reaps only tools: not the engine, not Excel, not what a browser started', () => {
    const list = [m(100, 1, 'claude.exe'), m(200, 100, 'powershell.exe'), m(201, 200, 'chrome.exe'), m(202, 201, 'node.exe'),
      m(203, 200, 'EXCEL.EXE'), m(204, 999, 'node.exe'), m(205, 100, 'cmd.exe')];
    expect(jobTools(list, 100).map(x => x.pid)).toEqual([200, 204, 205]);
  });

  it('is off under tests unless asked (no helper, every call a no-op)', async () => {
    const g = new JobGuard();
    g.start();
    expect(g.state).toBe('off');
    expect(await g.add(process.pid)).toBeNull();
    expect(await g.kill(1)).toBe(false);
  });

  it.runIf(win)('kills an orphan that outlived its parent, after listing it with its parent', async () => {
    process.env.SB_JOBGUARD = '1';
    const g = new JobGuard(); guards.push(g);
    g.start(tmp('jg-cache'));
    expect(await g.ready()).toBe(true);
    const t = orphanTree(tmp('jg-kill'));
    const job = await g.add(t.parent);
    expect(job).not.toBeNull();
    t.go();
    const child = await waitFor(() => t.childPid(), 'child pid', 15000);
    strays.push(child);
    await waitFor(() => !alive(t.parent), 'parent exit', 15000);
    const members = await g.members(job);
    expect(members.map(x => x.pid)).toContain(child);
    expect(members.find(x => x.pid === child)).toMatchObject({ ppid: t.parent, name: 'node.exe' });
    expect(await g.kill(job)).toBe(true);
    await waitFor(() => !alive(child), 'orphan killed with the job', 10000);
    expect(g.has(job)).toBe(false);
  }, 60000);

  it.runIf(win)('release leaves the job alive; the helper ending kills the jobs it still holds', async () => {
    process.env.SB_JOBGUARD = '1';
    const g = new JobGuard(); guards.push(g);
    g.start();
    expect(await g.ready()).toBe(true);
    const dir = tmp('jg-rel');
    const kept = orphanTree(dir), held = orphanTree(dir);
    const keptJob = await g.add(kept.parent), heldJob = await g.add(held.parent);
    expect(keptJob && heldJob && keptJob !== heldJob).toBeTruthy();
    kept.go(); held.go();
    const keptChild = await waitFor(() => kept.childPid(), 'kept child', 15000);
    const heldChild = await waitFor(() => held.childPid(), 'held child', 15000);
    strays.push(keptChild, heldChild);
    await g.release(keptJob);
    g.stop();
    await waitFor(() => !alive(heldChild), 'held child killed when the helper ends', 10000);
    expect(alive(keptChild)).toBe(true);
  }, 60000);
});
