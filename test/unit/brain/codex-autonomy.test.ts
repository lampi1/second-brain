// Scoped autonomy is opt-in, canonical and protected. Tests use only temporary repositories and the real settings
// validator/resolver/adapter; no installed Codex, personal config, machine policy or network is changed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, fromSaved } from '../../../src/main/brain/config';
import { validate } from '../../../src/main/brain/settings-schema';
import { canonicalRepoRoot, codexPolicyFor, resolveCodexPolicy, setCodexAutonomyRoots } from '../../../src/main/brain/adapters/codex-policy';
import { codexLaunch } from '../../../src/main/brain/adapters/codex';
import { tmpDir } from './helpers';

function repo(parent = tmpDir(), name = 'repo'): string {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  return fs.realpathSync.native(root);
}
afterEach(() => setCodexAutonomyRoots(() => []));

describe('Codex autonomy scope', () => {
  it('refuses UNC, chained Windows aliases and linked git markers before following their targets', () => {
    const native = vi.spyOn(fs.realpathSync, 'native');
    try {
      expect(() => canonicalRepoRoot('//remote.invalid/share/repo')).toThrow();
      expect(native).not.toHaveBeenCalled();
      const root = repo(), other = repo();
      const alias = path.join(tmpDir(), 'alias');
      fs.symlinkSync(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
      native.mockClear();
      if (process.platform === 'win32') { expect(() => canonicalRepoRoot(alias)).toThrow(/senza collegamenti/); expect(native).not.toHaveBeenCalled(); }
      fs.rmdirSync(path.join(root, '.git'));
      fs.symlinkSync(path.join(other, '.git'), path.join(root, '.git'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => canonicalRepoRoot(root)).toThrow();
    } finally { native.mockRestore(); }
  });
  it('defaults to on-request and selects only the matching repository, never sibling prefixes', () => {
    const parent = tmpDir(), root = repo(parent), sibling = repo(parent, 'repo-other');
    const sub = path.join(root, 'src');
    fs.mkdirSync(sub);
    expect(resolveCodexPolicy(root, [])).toMatchObject({ approvalPolicy: 'on-request', sandbox: 'workspace-write', writableRoots: [] });
    expect(resolveCodexPolicy(sub, [root, sibling])).toEqual({ approvalPolicy: 'never', sandbox: 'workspace-write', writableRoots: [root] });
    expect(resolveCodexPolicy(sibling, [root]).approvalPolicy).toBe('on-request');
    expect(resolveCodexPolicy(path.join(parent, 'missing'), [root]).approvalPolicy).toBe('on-request');
    expect(resolveCodexPolicy(root, [path.join(parent, 'missing')]).approvalPolicy).toBe('on-request');
  });

  it('takes the narrowest selected root and never widens a read-only run', () => {
    const root = repo(), nested = repo(root, 'nested');
    expect(resolveCodexPolicy(nested, [root, nested]).writableRoots).toEqual([nested]);
    expect(resolveCodexPolicy(root, [root], true)).toEqual({ approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] });
  });

  it('does not follow an unselected sibling junction or retarget saved consent through a replacement junction', () => {
    const parent = tmpDir(), root = repo(parent), sibling = repo(parent, 'other');
    const link = path.join(root, 'escape');
    fs.symlinkSync(sibling, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(resolveCodexPolicy(link, [root]).approvalPolicy).toBe('on-request');
    fs.renameSync(root, `${root}-old`);
    fs.symlinkSync(sibling, root, process.platform === 'win32' ? 'junction' : 'dir');
    expect(resolveCodexPolicy(root, [root]).approvalPolicy).toBe('on-request');
    expect(fromSaved({ codexAutonomyRoots: [root] }).codexAutonomyRoots).toEqual([]);
  });

  it('validates explicit repositories and keeps writes behind the normal protected-setting proposal', () => {
    const root = repo();
    expect(validate('codexAutonomyRoots', [root])).toMatchObject({ ok: true, value: [canonicalRepoRoot(root)] });
    for (const value of ['root', ['relative'], [tmpDir()], [path.parse(root).root], Array(33).fill(root)])
      expect(validate('codexAutonomyRoots', value).ok).toBe(false);
    const store = new ConfigStore(tmpDir(), {});
    expect(store.get().codexAutonomyRoots).toEqual([]);
    expect(store.request('codexAutonomyRoots', [root], { by: 'agent' })).toHaveProperty('proposal');
    expect(store.get().codexAutonomyRoots).toEqual([]);
    expect(() => store.set({ codexAutonomyRoots: [root] }, { by: 'agent' })).toThrow(/protetta/);
    store.confirm(store.pending()[0]!.id, true);
    expect(store.get().codexAutonomyRoots).toEqual([root]);
  });

  it('reads changed settings live, passes the launch policy, and leaves user configuration outside the feature', () => {
    const root = repo();
    let roots: string[] = [];
    setCodexAutonomyRoots(() => roots);
    const launch = () => codexLaunch({ cwd: root, mcpUrl: null, appMcpUrl: null, domains: [], brain: false });
    expect(launch().approvalPolicy).toBe('on-request');
    roots = [root];
    expect(launch()).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write' });
    expect(launch().configArgs).toEqual(['-c', 'approval_policy=never', '-c', 'sandbox_mode=workspace-write', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.network_access=false']);
    expect(codexPolicyFor(root).writableRoots).toEqual([root]);
    roots = [];
    expect(codexPolicyFor(root).approvalPolicy).toBe('on-request');
  });

  it('refuses to retarget a pending proposal or a historical undo through a changed junction', () => {
    const parent = tmpDir(), root = repo(parent), other = repo(parent, 'other');
    const store = new ConfigStore(tmpDir(), {});
    store.request('codexAutonomyRoots', [root], { by: 'agent' });
    const pending = store.pending()[0]!;
    store.set({ codexAutonomyRoots: [root] });
    store.set({ codexAutonomyRoots: [] });
    const revoked = store.history().find(c => c.key === 'codexAutonomyRoots' && Array.isArray(c.after) && c.after.length === 0)!;
    fs.renameSync(root, `${root}-old`);
    fs.symlinkSync(other, root, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => store.confirm(pending.id, true)).toThrow(/cambiata|collegamenti/);
    expect(store.pending()[0]?.id).toBe(pending.id);
    expect(() => store.undo(revoked.id)).toThrow(/cambiata|collegamenti/);
    expect(store.get().codexAutonomyRoots).toEqual([]);
  });
});
