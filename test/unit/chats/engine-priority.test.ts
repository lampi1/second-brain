// Engines run below the app's priority (jobguard.ts lowerEnginePriority, 2026-10-27 freezes): a real Claude session on
// the fake CLI comes up below normal, what it starts inherits that, and a refused or missing pid never breaks a start.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { lowerEnginePriority } from '../../../src/main/chats/jobguard';
import { log } from '../../../src/main/log';
import { FAKE, recSink, tmp, waitFor } from './helpers';

const BELOW = os.constants.priority.PRIORITY_BELOW_NORMAL;
const open: ClaudeSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); vi.restoreAllMocks(); });

describe('engine CPU priority', () => {
  it('a Claude engine starts below normal priority, below the app itself', async () => {
    const s = new ClaudeSession({ chatId: 'c_prio', cwd: tmp('cwd'), claudePath: FAKE, sessionId: '11111111-2222-4333-8444-555555555555' }, recSink());
    open.push(s);
    s.start();
    const pid = await waitFor(() => s.pid, 'engine pid');
    expect(os.getPriority(pid)).toBe(BELOW);
    // the app's own priority is untouched (a CI runner may start it above normal: nice -10 on macOS)
    expect(os.getPriority(pid)).toBeGreaterThan(os.getPriority());
  });

  it('a child of a lowered process inherits its priority (the MCP servers, shells and taskkill an engine starts)', () => {
    const r = spawnSync(process.execPath, ['-e', `const os=require('os');os.setPriority(${BELOW});const c=require('child_process').spawnSync(process.execPath,['-e','process.stdout.write(String(require("os").getPriority()))']);process.stdout.write(String(c.stdout))`], { encoding: 'utf8' });
    expect(Number(r.stdout)).toBe(BELOW);
  });

  it('no pid or a refusal: false, the start goes on, one warning only', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    expect(lowerEnginePriority(undefined)).toBe(false);
    const refuse = () => { throw new Error('EPERM'); };
    expect(lowerEnginePriority(123, refuse)).toBe(false);
    expect(lowerEnginePriority(124, refuse)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const set = vi.fn();
    expect(lowerEnginePriority(125, set)).toBe(true);
    expect(set).toHaveBeenCalledWith(125, BELOW);
  });
});
