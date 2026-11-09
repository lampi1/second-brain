// release.ts: the stable-only variables the launcher sets (SB_RELEASE, SB_RELEASE_ID, SB_ENGINE_CLAUDE) are read once
// and never reach a child of the app; a build run from a repo checkout is never a release, whatever it inherited
// (2026-10-13: a dev instance started from a stable chat took the stable userData and rewrote the Start Menu shortcut).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCheckout, takeStableEnv } from '../../src/main/release';

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
});
