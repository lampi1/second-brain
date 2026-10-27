// The built `routine` command (packages/routine-runtime/scripts/build.mjs → routine.mjs + routine-mcp.mjs), run as a
// separate Node process from a clean folder, like on a VM: --help, --engine cursor refused, and a two-step package run
// to the end by a stand-in `claude` found on PATH (claude.cmd + its npm cli.js on Windows, a shell script elsewhere),
// with no app, no brain, no network, no tokens. ADR 0175.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from './fakes';

const PKG = path.resolve(__dirname, '../../../packages/routine-runtime');
let dist = '';

const routine = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [path.join(dist, 'routine.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000, windowsHide: true });

/** A folder that makes `claude` resolve to the demo's stand-in CLI. */
function fakeClaudeOnPath(): string {
  const bin = tempDir('routine-bin-');
  const fake = path.join(PKG, 'demo', 'fake-claude.mjs');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n');
    const cli = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code');
    fs.mkdirSync(cli, { recursive: true });
    fs.copyFileSync(fake, path.join(cli, 'cli.js'));
    fs.writeFileSync(path.join(cli, 'package.json'), '{"type":"module"}');
  } else {
    fs.copyFileSync(fake, path.join(bin, 'fake-claude.mjs'));
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
  }
  return bin;
}

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

  it('runs a package from a clean folder with `claude` from PATH', () => {
    const work = tempDir('routine-vm-');
    fs.writeFileSync(path.join(work, 'routine.json'), JSON.stringify({
      format: 'second-brain-routine', schemaVersion: 1,
      routine: { id: 'vm-smoke', title: 'VM smoke', inputs: [{ name: 'topic', default: 'x' }], steps: [
        { id: 'one', title: 'One', prompt: 'Look at {{topic}}.' }, { id: 'two', title: 'Two', prompt: 'Report.' }] },
    }));
    const bin = fakeClaudeOnPath();
    const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
    const run = routine(['run', work, '--runs-dir', path.join(work, 'runs')], { [pathKey]: `${bin}${path.delimiter}${process.env[pathKey] ?? ''}` });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const runDir = /Folder: (.+)/.exec(run.stdout)![1]!.trim();
    expect(fs.readdirSync(path.join(runDir, 'steps'))).toEqual(['01-one', '02-two']);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')).status).toBe('done');
    expect(run.stdout).toContain(`Report: ${path.join(runDir, 'report.md')}`);
  }, 90_000);
});
