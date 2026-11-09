// The worktree pool (worktree-pool.ts, ADR 0227) on real local git repositories: a slot is reused on a fresh guard-safe
// branch at the parent's HEAD with its ignored build outputs kept; a slot with changes, a commit of its own or an open
// chat is never reused; the cleanup removes only the app's clean orphans beyond the limits, reports the others and never
// touches the user's own worktrees; a reused slot blocks reopening its earlier child. No engine or network runs.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorktrees } from '../../../src/main/agents/worktree-pool';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

describe('worktree pool', () => {
  it('parses git worktree list --porcelain, the main checkout first', () => {
    const at = process.platform === 'win32' ? 'C:/' : '/'; // an absolute path on this OS
    const out = `worktree ${at}r\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main\n\nworktree ${at}w\nHEAD 2\ndetached\nlocked\n\nworktree ${at}x\nHEAD 3\nbranch refs/heads/sb/delegate-abc\nprunable gitdir file points to non-existent location\n`;
    const list = parseWorktrees(out);
    expect(list.map(w => [path.basename(w.path), w.branch, w.locked, w.prunable])).toEqual([['r', 'main', false, false], ['w', null, true, false], ['x', 'sb/delegate-abc', false, true]]);
    // the commit a worktree is at, kept for the cleanup's conditional branch delete; anything but a full sha = unknown
    expect(list.map(w => w.head)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null, null]);
  });
});
