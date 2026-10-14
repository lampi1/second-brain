// release.ts: the stable-only variables the launcher sets (SB_RELEASE, SB_RELEASE_ID, SB_ENGINE_CLAUDE) are read once
// and never reach a child of the app; a build run from a repo checkout is never a release, whatever it inherited
// (2026-10-13: a dev instance started from a stable chat took the stable userData and rewrote the Start Menu shortcut).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initRelease, isCheckout, releaseEngine, releaseId, takeStableEnv } from '../../src/main/release';

const dir = (name: string, git?: 'dir' | 'file'): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `sb-rel-${name}-`));
  if (git === 'dir') fs.mkdirSync(path.join(d, '.git'));
  if (git === 'file') fs.writeFileSync(path.join(d, '.git'), 'gitdir: elsewhere');
  return d;
};
const STABLE = { SB_RELEASE: '0.1.0-abc1234', SB_RELEASE_ID: '0.1.0-abc1234', SB_ENGINE_CLAUDE: 'C:\\rel\\claude.exe' };
const saved = { ...process.env };
afterEach(() => { for (const k of Object.keys(STABLE)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('release env', () => {
  it('a release folder is the stable app: read once, then gone from the environment', () => {
    const env: NodeJS.ProcessEnv = { ...STABLE, PATH: 'p', SB_USER_DATA: 'u' };
    expect(takeStableEnv(env, dir('release'))).toEqual({ release: '0.1.0-abc1234', engine: 'C:\\rel\\claude.exe' });
    expect(env).toEqual({ PATH: 'p', SB_USER_DATA: 'u' }); // the user's own SB_* stay
  });

  it('a repo checkout (a clone or a worktree) is never a release, even with SB_RELEASE inherited from a stable chat', () => {
    expect(isCheckout(dir('clone', 'dir'))).toBe(true);
    expect(isCheckout(dir('worktree', 'file'))).toBe(true);
    for (const repo of [dir('clone', 'dir'), dir('worktree', 'file')]) {
      const env: NodeJS.ProcessEnv = { ...STABLE };
      expect(takeStableEnv(env, repo)).toEqual({ release: null, engine: null });
      expect(env).toEqual({}); // and its own children do not get it either
    }
  });

  it('after init no child the app starts inherits them; the process still knows what it is', () => {
    Object.assign(process.env, STABLE);
    initRelease(dir('release'));
    expect(releaseId()).toBe('0.1.0-abc1234');
    expect(releaseEngine()).toBe('C:\\rel\\claude.exe');
    const seen = execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(${JSON.stringify(Object.keys(STABLE))}.map(k => process.env[k] ?? null)))`],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    expect(JSON.parse(seen)).toEqual([null, null, null]);
    Object.assign(process.env, STABLE); // a dev build started from that stable app's chat
    initRelease(dir('worktree', 'file'));
    expect(releaseId()).toBeNull();
    expect(process.env.SB_RELEASE).toBeUndefined();
  });
});
