// Host-only publication of a run's exact fix branch. Local git never receives credentials; the push uses an isolated
// bare repository with no user config, hooks, remote aliases or agent-provided URL/refspec. DevOpsWriter owns the grant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
export const runBranch = (runId: string): string => {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error('Invalid host run identity for git push');
  return `refs/heads/fix/routine-${runId}`;
};
export class HostPushPreconditionError extends Error {}
export interface HostPush { workspace: string; runId: string; /** an ancestor of (or equal to) the branch HEAD; default HEAD */ commit?: string; organization: string; project: string; repositoryId: string; token: string; beforePush(): void; authorize(): void; signal: AbortSignal }
export async function pushRunBranch(p: HostPush): Promise<{ branch: string; commit: string }> {
  const branch = runBranch(p.runId), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-push-'));
  const capture = path.join(directory, 'capture.git');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
  const git = (cwd: string, args: string[], auth = false, mutation = false): Promise<string> => {
    p.authorize();
    if (p.signal.aborted) throw new HostPushPreconditionError('Push cancelled before dispatch');
    if (mutation) p.beforePush();
    return new Promise((resolve, reject) => execFile('git', ['--no-replace-objects', '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', ...args], {
      cwd, env: { ...env, ...(auth ? { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${p.token}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '', GIT_CONFIG_KEY_2: 'http.followRedirects', GIT_CONFIG_VALUE_2: 'false' } : {}) },
      signal: p.signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error('Host git operation failed; inspect repository state before retrying (credentials and provider output withheld)')) : resolve(stdout.trim())));
  };
  try {
    const root = fs.realpathSync(p.workspace);
    if (await git(root, ['symbolic-ref', '--quiet', 'HEAD']) !== branch) throw new HostPushPreconditionError(`Checkout the host-owned branch ${branch} before pushing`);
    const head = await git(root, ['rev-parse', '--verify', 'HEAD']), commit = p.commit ?? head;
    if (!/^[a-f0-9]{40,64}$/.test(head) || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid local commit');
    const objects = fs.realpathSync(path.resolve(root, await git(root, ['rev-parse', '--git-path', 'objects'])));
    if (/[\r\n]/.test(objects)) throw new Error('Unsafe Git object directory');
    // Source-side calls above only read refs/paths. All object traversal runs with host-created configuration:
    // never run status, filters, fsmonitor or packing against the agent-editable .git/config/config.worktree.
    await git(directory, ['init', '--bare', '--template=', capture]);
    fs.writeFileSync(path.join(capture, 'objects', 'info', 'alternates'), `${objects}\n`, { mode: 0o600 });
    if (await git(capture, ['rev-parse', '--verify', `${commit}^{commit}`]) !== commit) throw new Error('HEAD is not a readable commit');
    if (commit !== head) await git(capture, ['merge-base', '--is-ancestor', commit, head]).catch(() => { throw new HostPushPreconditionError(`Commit ${commit} is not on ${branch}`); });
    await git(capture, ['update-ref', branch, commit]);
    const url = `https://dev.azure.com/${encodeURIComponent(p.organization)}/${encodeURIComponent(p.project)}/_git/${p.repositoryId}`;
    // Native send-pack negotiates objects already on the remote; never bundle/copy the complete repository.
    // All traversal still uses host-owned config with no hooks, lazy fetching or source-repository credentials.
    // Exactly one branch, no force, deletion, mirror or tags. Normal fast-forward checks protect concurrent edits.
    await git(capture, ['push', '--porcelain', '--no-follow-tags', url, `${commit}:${branch}`], true, true);
    return { branch, commit };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
