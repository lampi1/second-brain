// The folders a delegated chat may work in (src/main/agents/worktrees.ts, ADR 0083): the parent's folder or a worktree
// of the parent's repository, read from a real `git worktree list`; any other folder, and a folder of no repository,
// stays outside.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitWorktrees, withinParent } from '../../../src/main/agents/worktrees';

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
});
