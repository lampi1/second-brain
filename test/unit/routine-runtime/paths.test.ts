// The terminal runs directory (packages/routine-runtime/src/paths.ts): per-OS default, env override, per-routine
// layout. The app's Routine section reads the same function, so its answer is pinned here.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPackagesDir, defaultRunsDir, routinePaths } from '../../../packages/routine-runtime/src/index';

describe('defaultRunsDir', () => {
  it('follows the OS conventions', () => {
    expect(defaultRunsDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\routine-runtime\\runs');
    expect(defaultRunsDir({}, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\routine-runtime\\runs');
    expect(defaultRunsDir({}, 'linux', '/home/u')).toBe('/home/u/.local/state/routine-runtime/runs');
    expect(defaultRunsDir({ XDG_STATE_HOME: '/state' }, 'linux', '/home/u')).toBe('/state/routine-runtime/runs');
    expect(defaultRunsDir({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Application Support/routine-runtime/runs');
  });
  it('ROUTINE_RUNS_DIR wins', () => {
    expect(defaultRunsDir({ ROUTINE_RUNS_DIR: 'my-runs' }, 'linux', '/home/u')).toBe(path.resolve('my-runs'));
  });
  it('one runs root per routine, refusing unsafe ids', () => {
    const p = routinePaths('/runs', 'demo');
    expect(p.runsRoot).toBe(path.join('/runs', 'demo'));
    expect(p.workspace('r1')).toBe(path.join('/runs', 'demo', 'r1', 'workspace'));
    expect(() => routinePaths('/runs', '../x')).toThrow();
  });
});

describe('defaultPackagesDir', () => {
  it('sits beside the default runs folder and ignores ROUTINE_RUNS_DIR (secrets never follow an env var)', () => {
    expect(defaultPackagesDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ROUTINE_RUNS_DIR: 'D:\\elsewhere' }, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\routine-runtime\\packages');
    expect(defaultPackagesDir({}, 'linux', '/home/u')).toBe('/home/u/.local/state/routine-runtime/packages');
  });
});
