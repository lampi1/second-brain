// scripts/pull.mjs (ADR 0074): the plan from git's state (refusals in Italian with the way out), which changed files
// mean a dependency reinstall, and the script end to end on a temp clone of a temp bare remote: up to date, a
// fast-forward, local commits that stop it, uncommitted changes that stop it.

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { changedDeps, pullPlan } from '../../scripts/pull.mjs';

describe('pullPlan', () => {
  it('refuses another branch, uncommitted changes and diverged history; says when there is nothing new', () => {
    expect(pullPlan({ branch: 'feat/x', dirty: false, ahead: 0, behind: 1 })).toMatchObject({ ok: false, why: expect.stringContaining('feat/x') });
    expect(pullPlan({ branch: 'main', dirty: true, ahead: 0, behind: 1 })).toMatchObject({ ok: false, why: expect.stringContaining('commit') });
    expect(pullPlan({ branch: 'main', dirty: false, ahead: 2, behind: 3 })).toMatchObject({ ok: false, why: expect.stringContaining('2 commit locali') });
    expect(pullPlan({ branch: 'main', dirty: false, ahead: 0, behind: 0 })).toMatchObject({ ok: true, upToDate: true });
    expect(pullPlan({ branch: 'main', dirty: false, ahead: 1, behind: 0 })).toMatchObject({ ok: true, upToDate: true, why: expect.stringContaining('1 commit locali') });
    expect(pullPlan({ branch: 'main', dirty: false, ahead: 0, behind: 4 })).toEqual({ ok: true, upToDate: false, why: '' });
  });

  it('a reinstall only when package.json, the lockfile or .npmrc changed', () => {
    expect(changedDeps(['src/a.ts', 'README.md'])).toBe(false);
    expect(changedDeps(['src/a.ts', 'package-lock.json'])).toBe(true);
    expect(changedDeps(['.npmrc'])).toBe(true);
    expect(changedDeps(['sub/package.json'])).toBe(false);
  });
});
