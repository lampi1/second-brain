// The folders a delegated chat may work in (src/main/agents/worktrees.ts, ADR 0083): the parent's folder or a worktree
// of the parent's repository, read from a real `git worktree list`; any other folder, and a folder of no repository,
// stays outside. A forged `.git/worktrees/<id>/gitdir` (empty, prunable, or pointing at another repository) adds nothing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitWorktrees, listedWorktrees, withinParent } from '../../../src/main/agents/worktrees';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });

describe('worktrees', () => {
  it('lists the repository\'s worktrees and lets a child work in one of them, never elsewhere', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wt-'))); roots.push(root);
    const repo = path.join(root, 'repo'), wt = path.join(root, 'wt', 'feat'), other = path.join(root, 'other');
    fs.mkdirSync(repo); fs.mkdirSync(other);
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'feat');
    fs.mkdirSync(path.join(wt, 'src'));
    const trees = await gitWorktrees(repo);
    expect(trees.map(p => fs.realpathSync(p)).sort()).toEqual([repo, wt].sort());
    // from the main checkout: its worktree is fine, a folder outside the repository is not
    expect(withinParent(repo, path.join(wt, 'src'), trees)).toBe(true);
    expect(withinParent(repo, other, trees)).toBe(false);
    // from the worktree: the main checkout is the same repository
    expect(withinParent(wt, repo, await gitWorktrees(wt))).toBe(true);
    // no repository: only the folder itself
    expect(await gitWorktrees(other)).toEqual([]);
  });
  it('ignores forged worktree entries: empty, prunable, missing, or of another repository', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wt-'))); roots.push(root);
    const repo = path.join(root, 'repo'), foreign = path.join(root, 'foreign'), plain = path.join(root, 'plain');
    fs.mkdirSync(repo); fs.mkdirSync(foreign); fs.mkdirSync(plain);
    for (const r of [repo, foreign]) {
      git(r, 'init', '-q');
      git(r, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    }
    const parent = path.join(repo, 'pkg'); fs.mkdirSync(parent);
    const forge = (id: string, gitdir: string) => {
      fs.mkdirSync(path.join(repo, '.git', 'worktrees', id), { recursive: true });
      fs.writeFileSync(path.join(repo, '.git', 'worktrees', id, 'gitdir'), gitdir + '\n');
    };
    forge('empty', '/.git');                               // listed as `worktree ` (empty path)
    forge('gone', path.join(plain, '.git'));               // prunable: the gitdir points nowhere
    forge('other', path.join(foreign, '.git'));            // an existing repository, but not this one
    const trees = await gitWorktrees(parent);
    expect(trees.map(p => fs.realpathSync(p))).toEqual([repo]);
    expect(trees).not.toContain(process.cwd());
    expect(withinParent(parent, plain, trees)).toBe(false);
    expect(withinParent(parent, foreign, trees)).toBe(false);
    expect(withinParent(parent, path.join(foreign, 'x'), trees)).toBe(false);
    // the repository root stays reachable from a subfolder (its main checkout is a worktree); a missing folder is not
    expect(withinParent(parent, repo, trees)).toBe(true);
    expect(withinParent(parent, path.join(repo, 'missing'), trees)).toBe(false);
    // a forged list handed in by hand still needs an existing folder
    expect(withinParent(parent, path.join(root, 'nowhere'), [root])).toBe(false);
  });

  it('reads only usable entries from the porcelain list', () => {
    const abs = path.resolve('/a/b'), other = path.resolve('/c');
    const out = [`worktree ${abs}`, 'HEAD 1', 'branch refs/heads/main', '', 'worktree ', 'HEAD 0', 'detached',
      'prunable gitdir file points to non-existent location', '', `worktree ${other}`, 'bare', '', 'worktree rel/x', '',
      `worktree ${path.resolve('/d')}`, 'HEAD 0', 'prunable', ''].join('\n');
    expect(listedWorktrees(out)).toEqual([abs]);
  });
});
