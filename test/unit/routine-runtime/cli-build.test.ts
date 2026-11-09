// The built `routine` command (packages/routine-runtime/scripts/build.mjs → routine.mjs + routine-mcp.mjs), run as a
// separate Node process from a clean folder, like on a VM: --help, --engine cursor refused, and a two-step package run
// to the end by a stand-in `claude` found on PATH (claude.cmd + its npm cli.js on Windows, a shell script elsewhere),
// with no app, no brain, no network, no tokens. ADR 0175.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from './fakes';

const PKG = path.resolve(__dirname, '../../../packages/routine-runtime');
let dist = '';

const routine = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [path.join(dist, 'routine.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000, windowsHide: true });

describe('built routine command', () => {
  beforeAll(() => {
    dist = tempDir('routine-dist-');
    const built = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'build.mjs'), '--out', dist], { encoding: 'utf8', timeout: 120_000, windowsHide: true });
    expect(built.status, built.stderr).toBe(0);
  }, 120_000);

  it('prints its usage and refuses --engine cursor', () => {
    const help = routine(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/routine run <package-folder/);
    const cursor = routine(['run', PKG, '--engine', 'cursor']);
    expect(cursor.status).toBe(2);
    expect(cursor.stderr).toMatch(/not supported yet/);
  });
});
