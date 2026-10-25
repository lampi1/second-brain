// Exercise real local Git isolation while intercepting the final network command; no remote or real credential is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';
import type { ChildProcess, ExecFileOptionsWithStringEncoding } from 'node:child_process';
const calls = vi.hoisted(() => [] as { args: string[]; cwd: string; env: NodeJS.ProcessEnv }[]);
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof ChildProcessModule>();
  return { ...original, execFile: (file: string, args: string[], options: ExecFileOptionsWithStringEncoding, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess => {
    calls.push({ args, cwd: String(options.cwd), env: options.env! });
    if (args.includes('push')) { queueMicrotask(() => callback(null, 'Done', '')); return {} as ChildProcess; }
    return original.execFile(file, args, options, callback);
  } };
});
import { pushRunBranch, runBranch } from '../../../src/main/flows/git-push';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); calls.length = 0; });
it('publishes only the fixed run branch from an isolated repository and never runs source fsmonitor', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'push-source-')); dirs.push(workspace);
  const runId = '11111111-2222-3333-4444-555555555555', branch = runBranch(runId);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--template='); git('checkout', '-b', branch.slice(11));
  fs.writeFileSync(path.join(workspace, 'sample.txt'), 'sample'); git('add', 'sample.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.hooksPath=', 'commit', '-m', 'Fixture');
  const commit = git('rev-parse', 'HEAD'), marker = path.join(workspace, 'hook-ran');
  const script = path.join(workspace, 'fsmonitor.sh'); fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
  git('config', 'core.fsmonitor', script);
  const authorize = vi.fn(), result = await pushRunBranch({ workspace, runId, organization: 'contoso', project: 'Example', repositoryId: runId, token: 'fixture-token', authorize, signal: new AbortController().signal });
  expect(result).toEqual({ branch, commit }); expect(fs.existsSync(marker)).toBe(false);
  const push = calls.find(c => c.args.includes('push'))!; expect(push.cwd).not.toBe(workspace);
  expect(push.args.at(-1)).toBe(`${commit}:${branch}`); expect(push.args).not.toContain('--force'); expect(push.args).not.toContain('--tags');
  expect(push.env.GIT_CONFIG_VALUE_0).toBe('Authorization: Bearer fixture-token');
  for (const call of calls.filter(c => c.cwd === workspace)) { expect(JSON.stringify(call.env)).not.toContain('fixture-token'); expect(call.env.GIT_NO_LAZY_FETCH).toBe('1'); expect(call.args).not.toContain('status'); expect(call.args).not.toContain('bundle'); }
  expect(authorize.mock.calls.length).toBeGreaterThan(4);
});
it('does not accept arbitrary ref names as a host run identity', () => {
  for (const value of ['main', '../main', 'refs/heads/main', '--all']) expect(() => runBranch(value)).toThrow('host run identity');
});
