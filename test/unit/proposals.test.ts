// Process-boundary tests for isolated proposals. No network calls, real pushes, PRs or application restarts.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { githubRepository, productPath, ProposalService, type ProposalDeps } from '../../src/main/improve/proposals';

const base = 'a'.repeat(40), head = 'b'.repeat(40), newer = 'c'.repeat(40);
const root = fs.mkdtempSync(path.join(import.meta.dirname, 'proposal-fixture-'));
const repo = path.join(root, 'repository');
fs.mkdirSync(repo);
afterAll(() => {
  if (!root.startsWith(path.join(import.meta.dirname, 'proposal-fixture-'))) throw new Error('Unexpected fixture root');
  fs.rmSync(root, { recursive: true, force: true });
});

function fixture(overrides: { dirty?: boolean; file?: string; guard?: boolean; quality?: boolean; reviews?: boolean; changed?: boolean; remoteBase?: string; publishFails?: boolean; ghUnavailable?: boolean; prState?: string; wrongBranch?: boolean } = {}) {
  const calls: { command: string; args: string[] }[] = [];
  let snapshots = 0;
  let branch = '';
  const run: NonNullable<ProposalDeps['run']> = async (_cwd, command, raw) => {
    const args = command === 'git' ? raw.slice(5) : raw;
    calls.push({ command, args });
    if (command === 'gh' && overrides.ghUnavailable) throw new Error('ENOENT or unauthenticated; private command diagnostic');
    if (args[0] === 'worktree') { branch = args[3]!; fs.mkdirSync(args[4]!, { recursive: true }); return ''; }
    if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) return root;
    if (args[0] === 'rev-parse') return args[1] === 'HEAD' ? (overrides.changed && ++snapshots > 2 ? newer : head) : base;
    if (args[0] === 'status') return overrides.dirty ? ' M src/a.ts' : '';
    if (args[0] === 'symbolic-ref') return overrides.wrongBranch ? 'main' : branch;
    if (args[0] === 'merge-base') return base;
    if (args[0] === 'rev-list') return args.includes('--merges') ? '' : head;
    if (args[0] === 'diff-tree') return args.includes('--raw') ? ':100644 100644 abc def M src/a.ts' : `${overrides.file ?? 'src/a.ts'}\0`;
    if (args[0] === 'diff') return args.includes('--name-only') ? 'src/a.ts\0' : 'diff --git a/src/a.ts b/src/a.ts\n+safe change';
    if (args[0] === 'remote') return 'git@github.com:example/product.git';
    if (args[0] === 'ls-remote') return args.at(-1) === 'refs/heads/main' ? `${overrides.remoteBase ?? base}\trefs/heads/main` : '';
    if (args[0] === 'push' && overrides.publishFails) throw new Error('Command failed');
    if (args[0] === 'pr') return args[1] === 'list' ? (overrides.prState ? JSON.stringify([{ url: 'https://github.com/example/product/pull/12', state: overrides.prState, headRefOid: head }]) : '[]') : 'https://github.com/example/product/pull/12';
    return '';
  };
  let scanned: string[] = [];
  const deps: ProposalDeps = { repo, workspaceRoot: path.join(root, String(Math.random())), baseBranch: 'main', emit: () => {}, run, startWork: async () => {},
    guard: async (_cwd, commits) => { scanned = commits; return overrides.guard !== false; },
    verified: async () => ({ quality: overrides.quality !== false, reviews: overrides.reviews !== false }),
  };
  const service = new ProposalService(deps);
  return { service, calls, deps, scanned: () => scanned };
}

describe('publication boundary', () => {
  it('does not resume a proposal while its initial work chat is still starting', async () => {
    const f = fixture(); let starts = 0, release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.deps.startWork = async () => { starts++; if (starts === 1) { entered(); await gate; } };
    const creating = f.service.create(); await started;
    try { await expect(f.service.resume(f.service.list()[0]!.id)).rejects.toThrow(/in corso/); }
    finally { release(); await creating; }
    expect(starts).toBe(1);
  });
  it('only accepts credential-free GitHub clone URLs', () => {
    expect(githubRepository('git@github.com:example/product.git')?.slug).toBe('example/product');
    expect(githubRepository('https://github.com/example/product.git')?.url).toBe('https://github.com/example/product.git');
    for (const remote of ['https://<user>:<password>@github.com/example/product.git', 'https://other.example/example/product.git', 'file:///repo', 'https://github.com/../product']) expect(githubRepository(remote)).toBe(null);
  });
  it('blocks personal, credential, traversal and out-of-scope paths', () => {
    for (const file of ['brain/me.md', 'brain-template/me.md', 'src/notes/customer.md', '.env', 'src/.env.local', 'src/credentials.ts', '../private.md', 'src/../../secret', 'journal/today.md', 'src/private.key']) expect(productPath(file), file).toBe(false);
    expect(productPath('src/renderer/components/Feature.tsx')).toBe(true);
  });
  it('preparation/inspection does not push, call GitHub or change the active checkout', async () => {
    const f = fixture(); const p = await f.service.create();
    const ready = await f.service.refresh(p.id);
    expect(ready.phase, ready.problem ?? '').toBe('ready'); expect(ready.diff).toContain('safe change');
    expect(f.scanned()).toEqual([head]);
    expect(f.calls.some(c => c.command === 'gh' || ['push', 'checkout', 'switch', 'add', 'commit'].includes(c.args[0]!))).toBe(false);
    expect(f.calls.find(c => c.args[0] === 'worktree')?.args).toContain(base);
  });
  it.each([{ dirty: true }, { file: 'brain/me.md' }, { guard: false }])('hides diffs and never publishes when unsafe: %j', async options => {
    const f = fixture(options); const p = await f.service.create();
    const result = await f.service.refresh(p.id);
    expect(result.phase).toBe('blocked'); expect(result.diff).toBe(null);
    expect(f.calls.some(c => c.args[0] === 'push')).toBe(false);
  });
  it('requires exact-commit quality checks and fresh reviews', async () => {
    const f = fixture({ reviews: false }); const p = await f.service.create();
    expect((await f.service.refresh(p.id)).phase).toBe('editing');
    expect((await f.service.openPullRequest({ id: p.id, reviewedHead: head })).phase).toBe('blocked');
    expect(f.calls.some(c => c.command === 'gh')).toBe(false);
  });
  it('refuses a changed head even after the user reviewed an earlier commit', async () => {
    const f = fixture({ changed: true }); const p = await f.service.create();
    await f.service.refresh(p.id);
    const result = await f.service.openPullRequest({ id: p.id, reviewedHead: head });
    expect(result.phase).toBe('blocked'); expect(f.calls.some(c => c.args[0] === 'push')).toBe(false);
  });
  it('refuses local main history that is not already on GitHub', async () => {
    const f = fixture({ remoteBase: newer }); const p = await f.service.create();
    await f.service.refresh(p.id);
    expect((await f.service.openPullRequest({ id: p.id, reviewedHead: head })).phase).toBe('blocked');
    expect(f.calls.some(c => c.args[0] === 'push')).toBe(false);
  });
  it('publishes an immutable commit only on the explicit action and returns the validated PR URL', async () => {
    const f = fixture(); const p = await f.service.create(); await f.service.refresh(p.id);
    const published = await f.service.openPullRequest({ id: p.id, reviewedHead: head });
    expect(published.phase).toBe('published'); expect(published.url).toBe('https://github.com/example/product/pull/12');
    const push = f.calls.find(c => c.args[0] === 'push')!;
    expect(push.args.at(-1)).toBe(`${head}:refs/heads/${p.branch}`);
    expect(push.args).not.toContain('--force');
    expect(push.args).toContain('--no-follow-tags');
    const n = f.calls.length; await f.service.openPullRequest({ id: p.id, reviewedHead: head }); expect(f.calls.length).toBe(n);
  });
  it('conserves the proposal on publication failure without leaking command diagnostics', async () => {
    const f = fixture({ publishFails: true }); const p = await f.service.create(); await f.service.refresh(p.id);
    const result = await f.service.openPullRequest({ id: p.id, reviewedHead: head });
    expect(result.phase).toBe('blocked'); expect(result.directory).toBe(p.directory); expect(result.problem).not.toContain('Command failed');
  });
  it('keeps the change local with a clear message when gh is absent or not authenticated', async () => {
    const f = fixture({ ghUnavailable: true }); const p = await f.service.create(); await f.service.refresh(p.id);
    const result = await f.service.openPullRequest({ id: p.id, reviewedHead: head });
    expect(result.phase).toBe('blocked'); expect(result.problem).toContain('GitHub non è pronto');
    expect(result.problem).not.toContain('private command diagnostic');
    expect(f.calls.some(c => c.args[0] === 'push' || (c.command === 'gh' && c.args[0] === 'pr'))).toBe(false);
  });
  it('recovers isolated work after restart and invalidates all cached checks/diffs', async () => {
    const f = fixture(); const p = await f.service.create(); await f.service.refresh(p.id);
    const restored = new ProposalService(f.deps).list()[0]!;
    expect(restored.id).toBe(p.id); expect(restored.directory).toBe(p.directory);
    expect(restored.phase).toBe('editing'); expect(restored.head).toBe(null); expect(restored.diff).toBe(null);
    expect(restored.privacy.state).toBe('pending');
    expect(fs.readFileSync(path.join(f.deps.workspaceRoot, 'proposals.json'), 'utf8')).not.toContain('safe change');
  });
  it('does not expose callback diagnostics that may contain private data', async () => {
    const f = fixture(); f.deps.guard = async () => { throw new Error('private diagnostic'); };
    const p = await f.service.create(); const result = await f.service.refresh(p.id);
    expect(result.phase).toBe('blocked'); expect(result.problem).not.toContain('private diagnostic');
  });
  it('keeps intact proposals available when another worktree is missing after restart', async () => {
    const f = fixture(); const one = await f.service.create(); const two = await f.service.create();
    fs.renameSync(one.directory, `${one.directory}-moved`);
    const restored = new ProposalService(f.deps).list();
    expect(restored.find(p => p.id === one.id)?.phase).toBe('blocked');
    expect(restored.find(p => p.id === two.id)?.phase).toBe('editing');
  });
  it.each(['CLOSED', 'MERGED'])('recovers a %s PR without claiming that it is open or creating a duplicate', async state => {
    const f = fixture({ prState: state }); const p = await f.service.create(); await f.service.refresh(p.id);
    const result = await f.service.openPullRequest({ id: p.id, reviewedHead: head });
    expect(result.publication).toBe(state === 'CLOSED' ? 'closed' : 'merged');
    expect(f.calls.some(c => c.command === 'gh' && c.args[0] === 'pr' && c.args[1] === 'create')).toBe(false);
  });
  it('recovers a merged PR after restart even when remote main has advanced', async () => {
    const f = fixture({ prState: 'MERGED', remoteBase: newer }); const p = await f.service.create();
    const restarted = new ProposalService(f.deps); const refreshed = await restarted.refresh(p.id);
    expect(refreshed.phase, refreshed.problem ?? '').toBe('ready');
    const result = await restarted.openPullRequest({ id: p.id, reviewedHead: head });
    expect(result.publication).toBe('merged');
    expect(f.calls.some(c => c.args[0] === 'push')).toBe(false);
  });
  it('never starts work on another checked-out branch during creation or recovery', async () => {
    const f = fixture({ wrongBranch: true }); let starts = 0;
    f.deps.startWork = async () => { starts++; };
    const p = await f.service.create(); expect(p.phase).toBe('blocked');
    await f.service.resume(p.id); expect(starts).toBe(0);
  });
});
