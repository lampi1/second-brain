// The worktree pool (worktree-pool.ts, ADR 0227) on real local git repositories: a slot is reused on a fresh guard-safe
// branch at the parent's HEAD with its ignored build outputs kept; a slot with changes, a commit of its own or an open
// chat is never reused; the cleanup removes only the app's clean orphans beyond the limits, reports the others and never
// touches the user's own worktrees; a reused slot blocks reopening its earlier child. No engine or network runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatSummary, NewChat, WorktreeLimits } from '../../../src/shared/contract';
import { GitSession, DelegateWorktrees, cleanRepository } from '../../../src/main/agents/worktrees';
import { WorktreePool, parseWorktrees, privateGitDir } from '../../../src/main/agents/worktree-pool';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (cwd: string, message: string) => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message); };
const writer = { tools: { allow: ['edit' as const] }, ceiling: null };

function fixture(limits: WorktreeLimits = { perRepo: 6, total: 20, diskGb: 40 }) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pool-'))); roots.push(root);
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'bin/\n'); fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n'); commit(repo, 'initial');
  const busy = new Set<string>();
  let clock = Date.now();
  const pool = new WorktreePool({ file: path.join(root, 'pool.json'), limits: () => limits, inUse: r => [...busy].some(b => b.toLowerCase() === r.toLowerCase()),
    knownCwds: () => [repo], now: () => clock });
  const source = async () => cleanRepository(repo, null, new GitSession());
  return { root, repo, pool, busy, source, later: (ms: number) => { clock += ms; } };
}

describe('worktree pool', () => {
  it('parses git worktree list --porcelain, the main checkout first', () => {
    const out = 'worktree C:/r\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main\n\nworktree C:/w\nHEAD 2\ndetached\nlocked\n\nworktree C:/x\nHEAD 3\nbranch refs/heads/sb/delegate-abc\nprunable gitdir file points to non-existent location\n';
    const list = parseWorktrees(out);
    expect(list.map(w => [path.basename(w.path), w.branch, w.locked, w.prunable])).toEqual([['r', 'main', false, false], ['w', null, true, false], ['x', 'sb/delegate-abc', false, true]]);
    // the commit a worktree is at, kept for the cleanup's conditional branch delete; anything but a full sha = unknown
    expect(list.map(w => w.head)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null, null]);
  });

  it('reuses a free slot on a fresh guard-safe branch at the new HEAD, keeping its ignored build outputs', async () => {
    const f = fixture();
    const first = await f.pool.take(await f.source(), new GitSession());
    expect(first.reused).toBe(false);
    expect(first.branch).toMatch(/^sb\/delegate-[a-f0-9]{12}$/);
    expect(fs.existsSync(path.join(privateGitDir(first.root)!, 'second-brain-owned'))).toBe(true);
    fs.mkdirSync(path.join(first.root, 'bin')); fs.writeFileSync(path.join(first.root, 'bin', 'app.dll'), 'build');
    f.pool.release(first.root);
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'two\n'); commit(f.repo, 'second');
    const src = await f.source();
    const session = new GitSession();
    const again = await f.pool.take(src, session);
    expect(again).toMatchObject({ root: first.root, reused: true });
    expect(again.branch).not.toBe(first.branch);
    expect(git(again.root, 'rev-parse', 'HEAD')).toBe(src.head);
    expect(git(again.root, 'symbolic-ref', '--short', 'HEAD')).toBe(again.branch);
    expect(fs.readFileSync(path.join(again.root, 'bin', 'app.dll'), 'utf8')).toBe('build');
    // the old branch stays: nothing is lost
    expect(git(f.repo, 'branch', '--list', first.branch)).toContain(first.branch);
    // the slot's git policy probe, its identity and status, the base ref, its own commits, checkout -B, clean -fd, HEAD
    expect(session.spawns).toBeLessThanOrEqual(8);
  });

  it('never reuses a slot with changes, a commit of its own, an open chat or a lease', async () => {
    const f = fixture();
    const take = async () => f.pool.take(await f.source(), new GitSession());
    const dirty = await take(); f.pool.release(dirty.root);
    fs.writeFileSync(path.join(dirty.root, 'new.txt'), 'work');
    const committed = await take(); f.pool.release(committed.root);
    expect(committed.root).not.toBe(dirty.root);
    fs.writeFileSync(path.join(committed.root, 'a.txt'), 'mine\n'); commit(committed.root, 'child work');
    const open = await take(); f.pool.release(open.root);
    f.busy.add(open.root);
    const leased = await take();
    const fresh = await take();
    expect(new Set([dirty.root, committed.root, open.root, leased.root, fresh.root]).size).toBe(5);
    expect(fs.readFileSync(path.join(dirty.root, 'new.txt'), 'utf8')).toBe('work');
  });

  it('cleanup removes the app\'s clean orphans beyond the limit, reports work, never touches the user\'s worktrees', async () => {
    const f = fixture({ perRepo: 1, total: 20, diskGb: 40 });
    const legacy = (name: string, branch: string | null) => {
      const p = path.join(f.root, name);
      git(f.repo, 'worktree', 'add', '-q', ...(branch ? ['-b', branch] : ['--detach']), p, 'HEAD');
      return p;
    };
    const a = legacy('.second-brain-delegate-aaaaaa', 'sb/delegate-0123456789ab');
    const b = legacy('.second-brain-delegate-bbbbbb', 'sb/delegate-ba9876543210');
    const c = legacy('.second-brain-integration-cccccc', null);
    const dirty = legacy('.second-brain-delegate-dddddd', 'sb/delegate-dddddddddddd');
    fs.writeFileSync(path.join(dirty, 'wip.txt'), 'wip');
    const ahead = legacy('.second-brain-delegate-eeeeee', 'sb/delegate-eeeeeeeeeeee');
    fs.writeFileSync(path.join(ahead, 'a.txt'), 'ahead\n'); commit(ahead, 'unpushed');
    const user = legacy('feature-x', 'feature/x');
    f.later(3600_000); // past the "recently touched" guard
    const report = await f.pool.cleanup();
    const left = parseWorktrees(git(f.repo, 'worktree', 'list', '--porcelain')).map(w => path.basename(w.path));
    // one clean legacy worktree is adopted as the repository's one slot; the other clean ones go
    const kept = [a, b].filter(p => left.includes(path.basename(p)));
    expect(kept).toHaveLength(1);
    expect(left).not.toContain(path.basename(c));
    expect(left).toEqual(expect.arrayContaining([path.basename(dirty), path.basename(ahead), 'feature-x']));
    expect(report.repos[0]!.reported.map(r => [path.basename(r.path), r.why]).sort()).toEqual([[path.basename(dirty), 'changes'], [path.basename(ahead), 'unpushed']]);
    expect(report.repos[0]!.pool).toBe(1);
    expect(report.lastCleanup?.removed).toBe(2);
    expect(fs.existsSync(user)).toBe(true);
    // the removed worktree's branch had nothing of its own: deleted; the unpushed one's stays
    const removedBranch = kept[0] === a ? 'sb/delegate-ba9876543210' : 'sb/delegate-0123456789ab';
    expect(git(f.repo, 'branch', '--list', removedBranch)).toBe('');
    expect(git(f.repo, 'branch', '--list', 'sb/delegate-eeeeeeeeeeee')).toContain('eeeeeeeeeeee');
    // the adopted slot is reused by the next take
    const next = await f.pool.take(await f.source(), new GitSession());
    expect(next).toMatchObject({ root: kept[0], reused: true });
  });

  it('the timer only scans until the first manual cleanup, which it remembers', async () => {
    const f = fixture({ perRepo: 1, total: 1, diskGb: 1 });
    const p = path.join(f.root, '.second-brain-delegate-ffffff');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'sb/delegate-ffffffffffff', p, 'HEAD');
    f.later(3600_000);
    const report = await f.pool.autoCleanup();
    expect(fs.existsSync(p)).toBe(true);
    expect(report).toMatchObject({ auto: false, lastCleanup: null });
    expect(report.repos[0]).toMatchObject({ app: 1, worktrees: 1, pool: 0 });
    expect(report.repos[0]!.bytes).toBeGreaterThan(0);
    expect((await f.pool.cleanup()).auto).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(f.root, 'pool.json'), 'utf8')).manualAt).toEqual(expect.any(Number));
  });

  it('a cleanup asked during a scan runs after it, and says what it removed (0 too)', async () => {
    const f = fixture({ perRepo: 0, total: 0, diskGb: 1 });
    const p = path.join(f.root, '.second-brain-delegate-gggggg');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'sb/delegate-aaaaaaaaaaaa', p, 'HEAD');
    f.later(3600_000);
    const scan = f.pool.usage(true), clean = f.pool.cleanup();
    expect((await scan).lastCleanup).toBeNull();
    expect((await clean).lastCleanup?.removed).toBe(1);
    expect(fs.existsSync(p)).toBe(false);
    expect((await f.pool.cleanup()).lastCleanup?.removed).toBe(0);
  });

  it('commits a local non-app branch holds are not "unpushed": the worktree goes, the commits stay on that branch', async () => {
    const f = fixture({ perRepo: 0, total: 0, diskGb: 1 });
    const p = path.join(f.root, '.second-brain-delegate-hhhhhh');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'sb/delegate-bbbbbbbbbbbb', p, 'HEAD');
    fs.writeFileSync(path.join(p, 'a.txt'), 'kept\n'); commit(p, 'merged locally');
    const work = git(p, 'rev-parse', 'HEAD');
    git(f.repo, 'branch', 'feature/kept', work);
    f.later(3600_000);
    const report = await f.pool.cleanup();
    expect(report.repos[0]!.reported).toEqual([]);
    expect(fs.existsSync(p)).toBe(false);
    expect(git(f.repo, 'branch', '--list', 'sb/delegate-bbbbbbbbbbbb')).toBe('');
    expect(git(f.repo, 'rev-parse', 'feature/kept')).toBe(work);
  });

  it('a slot taken while a cleanup runs is not removed by it', async () => {
    const f = fixture({ perRepo: 0, total: 0, diskGb: 1 });
    const src = await f.source();
    const slot = await f.pool.take(src, new GitSession()); f.pool.release(slot.root);
    f.later(3600_000);
    // the removal waits behind this take (one operation per repository) and finds the slot taken again
    const clean = f.pool.cleanup();
    const again = await f.pool.take(src, new GitSession());
    expect(again.root).toBe(slot.root);
    await clean;
    f.pool.release(again.root);
    expect(fs.existsSync(slot.root)).toBe(true);
    expect(git(f.repo, 'branch', '--list', again.branch)).toContain(again.branch);
  });

  it('DelegateWorktrees takes pool slots; a reused slot blocks reopening its earlier child', async () => {
    const f = fixture();
    const service = new DelegateWorktrees(path.join(f.root, 'alloc.json'), () => null, f.pool);
    const parent = { id: 'parent', cwd: f.repo, run: { runId: 'run', taskVersion: 1 } } as ChatSummary;
    const one = await service.prepare(parent, { cwd: f.repo } as NewChat, writer); one.bind?.('child-1');
    const child1 = { id: 'child-1', parentId: 'parent', cwd: one.cwd } as ChatSummary;
    expect(service.reopenBlocked(child1)).toBeNull();
    expect(service.allocation(parent, child1).branch).toMatch(/^sb\/delegate-[a-f0-9]{12}$/);
    const two = await service.prepare(parent, { cwd: f.repo } as NewChat, writer); two.bind?.('child-2');
    expect(two.cwd).toBe(one.cwd);
    expect(service.reopenBlocked(child1)).toMatch(/another delegated chat/);
    expect(() => service.allocation(parent, child1)).toThrow();
    expect(service.allocation(parent, { ...child1, id: 'child-2' }).childId).toBe('child-2');
  });
});
