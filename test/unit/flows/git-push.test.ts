// Exercise real local Git isolation while intercepting the final network command; no remote or real credential is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';
import type { ChildProcess, ExecFileOptionsWithStringEncoding } from 'node:child_process';
const calls = vi.hoisted(() => [] as { args: string[]; cwd: string; env: NodeJS.ProcessEnv }[]);
const remote = vi.hoisted(() => ({ path: '' }));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof ChildProcessModule>();
  return { ...original, execFile: (file: string, args: string[], options: ExecFileOptionsWithStringEncoding, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess => {
    calls.push({ args, cwd: String(options.cwd), env: options.env! });
    if (args.includes('push') && remote.path) return original.execFile(file, args.map(arg => arg.startsWith('https://dev.azure.com/') ? remote.path : arg), options, callback);
    if (args.includes('push')) { queueMicrotask(() => callback(null, 'Done', '')); return {} as ChildProcess; }
    return original.execFile(file, args, options, callback);
  } };
});
import { pushRunBranch, runBranch } from '../../../src/main/flows/git-push';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); calls.length = 0; remote.path = ''; });
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
  const authorize = vi.fn(), result = await pushRunBranch({ workspace, runId, organization: 'contoso', project: 'Example', repositoryId: runId, token: 'fixture-token', beforePush: vi.fn(), authorize, signal: new AbortController().signal });
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

it('pushes one new commit over more than 256 MiB of existing remote history without copying the old pack', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'push-large-')); dirs.push(workspace);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(workspace, 'init', '--template=');
  // Incompressible committed history exceeds the previous bundle limit. Only a tiny test is new on the fix branch.
  const fd = fs.openSync(path.join(workspace, 'history.bin'), 'w');
  try { for (let i = 0; i < 257; i++) fs.writeSync(fd, randomBytes(1024 * 1024)); } finally { fs.closeSync(fd); }
  git(workspace, 'add', 'history.bin');
  git(workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.hooksPath=', 'commit', '-m', 'Large shared history');
  remote.path = path.join(workspace, 'remote.git');
  git(workspace, 'clone', '--bare', '--local', '.', remote.path);
  const runId = '11111111-2222-3333-4444-555555555555', branch = runBranch(runId);
  git(workspace, 'checkout', '-b', branch.slice(11));
  fs.writeFileSync(path.join(workspace, 'regression.txt'), 'One new regression test.'); git(workspace, 'add', 'regression.txt');
  git(workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.hooksPath=', 'commit', '-m', 'Regression');
  const beforeSize = Number(git(remote.path, 'count-objects', '-v').match(/^size: (\d+)$/m)![1]);
  const beforePush = vi.fn(), result = await pushRunBranch({ workspace, runId, organization: 'contoso', project: 'Example', repositoryId: runId, token: 'fixture-token', beforePush, authorize: () => {}, signal: new AbortController().signal });
  expect(git(remote.path, 'rev-parse', branch)).toBe(result.commit);
  expect(beforePush).toHaveBeenCalledOnce();
  expect(calls.some(c => c.args.includes('bundle'))).toBe(false);
  // The local clone has only the common base; the receiver stores just the tiny new tree/commit/blob.
  const stored = git(remote.path, 'count-objects', '-v');
  expect(Number(stored.match(/^size: (\d+)$/m)![1]) - beforeSize).toBeLessThan(64);
}, 60_000);

it('pushes a partial restart on its inherited checkout with no user git switch and retains ownership receipts', async () => {
  const { FlowService } = await import('../../../src/main/flows/service');
  const { branchLineage } = await import('../../../src/main/flows/branch-lineage');
  const { DevOpsWriter } = await import('../../../src/main/flows/devops-writer');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'push-restart-')); dirs.push(workspace);
  const flow = new FlowService({ file: path.join(workspace, 'flow.json'), contextKey: 'test', resolveReport: (b, id) => ({ ...b, id, completed: true, summary: 'Branch committed', evidence: ['result: committed test'] }) });
  flow.propose({ expectedRevision: 0, definition: { id: 'fix', title: 'Fix', description: 'Branch then publish', aliases: [], scope: {}, steps: ['branch', 'publish'].map(id => ({ id, title: id, kind: 'agent', instructions: id, inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], effect: 'read-only', timeoutMs: 60000, maxAttempts: 2 })) } });
  flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  let source = flow.start({ flowId: 'fix', flowVersion: 1, subjectKey: 'test', inputs: { workspace }, scope: {} }, 'owner');
  const branch = runBranch(source.id), git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--template='); git('checkout', '-b', branch.slice(11));
  fs.writeFileSync(path.join(workspace, 'test.txt'), 'Test'); git('add', 'test.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.hooksPath=', 'commit', '-m', 'Test');
  source = flow.bindAgent(source.id, source.revision, 'branch', { chatId: 'worker', chatRunId: 'chat-run', taskVersion: 1 }, 'owner');
  source = flow.report({ runId: source.id, expectedRevision: source.revision, stepId: 'branch', reportId: 'report' }, 'owner');
  const version = flow.snapshot().versions[0]!;
  const next = flow.restart({ runId: source.id, expectedRevision: source.revision, mode: 'from-step', stepId: 'publish', targetVersion: 1, targetDigest: version.digest, acknowledgeEffects: true });
  const repo = '11111111-2222-3333-4444-555555555555';
  let liveCommit: string | undefined;
  const writer = new DevOpsWriter({ file: path.join(workspace, 'ledger.json'), token: async () => 'fixture-token', request: async url => Response.json(url.includes('/refs?') ? { value: liveCommit ? [{ name: branch, objectId: liveCommit }] : [] } : { id: repo, project: { name: 'Example' } }) });
  const context = { runId: next.id, branchRunIds: branchLineage(next, flow.snapshot().runs), workspace, workspaceInput: 'workspace', workItemId: 42, grant: { organization: 'contoso', projects: ['Example'], ops: ['git-push'] as ['git-push'], fields: [], pushTargets: [{ project: 'Example', repositoryId: repo, workspaceInput: 'workspace' }] } };
  expect(next.id).not.toBe(source.id);
  const receipt = await writer.execute(context, { op: 'push-branch', project: 'Example', repositoryId: repo });
  expect(receipt.branch).toBe(branch); expect(git('symbolic-ref', 'HEAD')).toBe(branch);
  expect(writer.operationsFor(next.id)[0]).toMatchObject({ state: 'done' });
  liveCommit = String(receipt.commit);
  // A later partial restart may publish an already-owned ref, but a foreign or changed ref stays forbidden.
  const again = flow.restart({ runId: next.id, expectedRevision: next.revision, mode: 'from-step', stepId: 'publish', targetVersion: 1, targetDigest: version.digest, acknowledgeEffects: true });
  const context2 = { ...context, runId: again.id, branchRunIds: branchLineage(again, flow.snapshot().runs) };
  await expect(writer.execute(context2, { op: 'push-branch', project: 'Example', repositoryId: repo })).resolves.toMatchObject({ branch });
  liveCommit = 'f'.repeat(40);
  await expect(writer.execute(context2, { op: 'push-branch', project: 'Example', repositoryId: repo })).rejects.toThrow('changed outside');
});

it('never marks dispatch for a wrong checkout', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'push-wrong-')); dirs.push(workspace);
  execFileSync('git', ['init', '--template='], { cwd: workspace, stdio: 'ignore' });
  const beforePush = vi.fn(), runId = '11111111-2222-3333-4444-555555555555';
  await expect(pushRunBranch({ workspace, runId, organization: 'contoso', project: 'Example', repositoryId: runId, token: 'fixture-token', beforePush, authorize: () => {}, signal: new AbortController().signal })).rejects.toThrow('host-owned branch');
  expect(beforePush).not.toHaveBeenCalled(); expect(calls.some(c => c.args.includes('push'))).toBe(false);
});
