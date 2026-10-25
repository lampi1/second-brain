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
export interface HostPush { workspace: string; runId: string; organization: string; project: string; repositoryId: string; token: string; authorize(): void; signal: AbortSignal }
export async function pushRunBranch(p: HostPush): Promise<{ branch: string; commit: string }> {
  const branch = runBranch(p.runId), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-push-'));
  const capture = path.join(directory, 'capture.git'), bundle = path.join(directory, 'source.bundle'), bare = path.join(directory, 'bare.git');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
  const git = (cwd: string, args: string[], auth = false): Promise<string> => {
    p.authorize();
    return new Promise((resolve, reject) => execFile('git', ['--no-replace-objects', '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', ...args], {
      cwd, env: { ...env, ...(auth ? { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${p.token}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '', GIT_CONFIG_KEY_2: 'http.followRedirects', GIT_CONFIG_VALUE_2: 'false' } : {}) },
      signal: p.signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error('Host git operation failed; inspect repository state before retrying (credentials and provider output withheld)')) : resolve(stdout.trim())));
  };
  try {
    const root = fs.realpathSync(p.workspace);
    if (await git(root, ['symbolic-ref', '--quiet', 'HEAD']) !== branch) throw new Error(`Checkout the host-owned branch ${branch} before pushing`);
    const commit = await git(root, ['rev-parse', '--verify', 'HEAD']);
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid local commit');
    const objects = fs.realpathSync(path.resolve(root, await git(root, ['rev-parse', '--git-path', 'objects'])));
    if (/[\r\n]/.test(objects)) throw new Error('Unsafe Git object directory');
    // Source-side calls above only read refs/paths. All object traversal runs with host-created configuration:
    // never run status, filters, fsmonitor or packing against the agent-editable .git/config/config.worktree.
    await git(directory, ['init', '--bare', '--template=', capture]);
    fs.writeFileSync(path.join(capture, 'objects', 'info', 'alternates'), `${objects}\n`, { mode: 0o600 });
    if (await git(capture, ['rev-parse', '--verify', `${commit}^{commit}`]) !== commit) throw new Error('HEAD is not a readable commit');
    await git(capture, ['update-ref', branch, commit]);
    await git(capture, ['bundle', 'create', bundle, branch]);
    if (fs.statSync(bundle).size > 256 * 1024 * 1024) throw new Error('Repository bundle exceeds the host push limit');
    await git(directory, ['init', '--bare', '--template=', bare]);
    await git(bare, ['fetch', '--no-tags', bundle, `${branch}:${branch}`]);
    if (await git(bare, ['rev-parse', branch]) !== commit) throw new Error('Branch changed during push preparation');
    const url = `https://dev.azure.com/${encodeURIComponent(p.organization)}/${encodeURIComponent(p.project)}/_git/${p.repositoryId}`;
    // Exactly one branch, no force, deletion, mirror or tag options. Normal fast-forward checks protect concurrent edits.
    await git(bare, ['push', '--porcelain', '--no-follow-tags', url, `${commit}:${branch}`], true);
    return { branch, commit };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
