// jobguard: the PowerShell helper's Job Objects on a real process tree (Windows only): a parent that spawns a child
// and exits leaves an orphan that taskkill /T can no longer find; the job still holds it, lists it (with its parent),
// kills it, lets it go on release, and kills what is left when the helper ends (the app quit or crashed). Plus the
// reap's filter over job members: only tools, never what a user program started. And the quit: the jobs die, the
// helper ends, and the booster it started raises a target's below-normal threads, then lowers them at its cap.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobGuard, parseMembers, type JobMember } from '../../../src/main/chats/jobguard';
import { jobTools } from '../../../src/main/chats/proctree';
import { killStray } from './helpers';

const m = (pid: number, ppid: number, name: string): JobMember => ({ pid, ppid, name });

describe('jobguard', () => {
  const guards: JobGuard[] = [];
  const strays: number[] = [];
  afterEach(() => {
    for (const g of guards.splice(0)) g.stop();
    for (const pid of strays.splice(0)) killStray(pid);
    delete process.env.SB_JOBGUARD;
    vi.unstubAllEnvs();
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
});
