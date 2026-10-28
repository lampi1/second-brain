// Where the terminal host (`routine` CLI) keeps its runs (ADR 0175): one runs root per routine under a per-OS default
// directory, the same layout as the app's `<userData>/routine-runs/<routineId>/`. The app's Routine section reads it
// too, to list the runs started from a terminal on this machine. `ROUTINE_RUNS_DIR` overrides the default.
import os from 'node:os';
import path from 'node:path';
import type { Paths } from './ports';

export const RUNS_DIR_ENV = 'ROUTINE_RUNS_DIR';

/** The CLI's default runs directory: Windows `%LOCALAPPDATA%\routine-runtime\runs`, macOS
 *  `~/Library/Application Support/routine-runtime/runs`, Linux `$XDG_STATE_HOME/routine-runtime/runs` (default
 *  `~/.local/state/routine-runtime/runs`); `ROUTINE_RUNS_DIR` wins when set. */
export function defaultRunsDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  const override = env[RUNS_DIR_ENV]?.trim();
  if (override) return path.resolve(override);
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA?.trim() || path.win32.join(home, 'AppData', 'Local'), 'routine-runtime', 'runs');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'routine-runtime', 'runs');
  return path.posix.join(env.XDG_STATE_HOME?.trim() || path.posix.join(home, '.local', 'state'), 'routine-runtime', 'runs');
}

/** Where the app exports filled packages for the terminal (ADR 0176): beside the runs directory's default, Windows
 *  `%LOCALAPPDATA%\routine-runtime\packages` (no override: secrets never go to a folder an env var points at). */
export function defaultPackagesDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(p.dirname(defaultRunsDir({ ...env, [RUNS_DIR_ENV]: '' }, platform, home)), 'packages');
}

/** The lock folder every terminal shares (locks.ts), whatever its runs directory: Windows
 *  `%LOCALAPPDATA%\routine-runtime\locks` (no override, so `--runs-dir` never splits it). */
export function defaultLocksDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(p.dirname(defaultRunsDir({ ...env, [RUNS_DIR_ENV]: '' }, platform, home)), 'locks');
}

/** The run folders of one routine under a runs directory: `<dir>/<routineId>/<runId>/`, its workspace inside. */
export function routinePaths(runsDir: string, routineId: string): Paths {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(routineId) || routineId.includes('..')) throw new Error('Invalid routine id');
  const runsRoot = path.join(runsDir, routineId);
  return { runsRoot, workspace: runId => path.join(runsRoot, runId, 'workspace') };
}
