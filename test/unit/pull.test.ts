// scripts/pull.mjs (ADR 0074): the plan from git's state (refusals in Italian with the way out), which changed files
// mean a dependency reinstall, and the script end to end on a temp clone of a temp bare remote: up to date, a
// fast-forward, local commits that stop it, uncommitted changes that stop it.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('scripts/pull.mjs on a temp clone', () => {
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pull-'));
    const remote = path.join(root, 'remote.git'), up = path.join(root, 'up'), me = path.join(root, 'me');
    g(root, 'init', '-q', '--bare', '-b', 'main', remote);
    g(root, 'clone', '-q', remote, up);
    g(up, 'checkout', '-q', '-b', 'main');
    fs.mkdirSync(path.join(up, 'scripts'));
    fs.copyFileSync(path.resolve('scripts/pull.mjs'), path.join(up, 'scripts', 'pull.mjs'));
    fs.writeFileSync(path.join(up, 'a.txt'), '1');
    g(up, 'add', '-A'); g(up, 'commit', '-q', '-m', 'first'); g(up, 'push', '-q', 'origin', 'main');
    g(root, 'clone', '-q', remote, me);
    const push = (msg: string) => { fs.writeFileSync(path.join(up, `${msg}.txt`), msg); g(up, 'add', '-A'); g(up, 'commit', '-q', '-m', msg); g(up, 'push', '-q', 'origin', 'main'); };
    const runAt = (script: string, ...extra: string[]) => {
      const result = spawnSync(process.execPath, [script, '--json', '--no-build', ...extra], { cwd: me, encoding: 'utf8', windowsHide: true });
      if (result.error) throw result.error;
      try { return JSON.parse(result.stdout.trim()); }
      catch (cause) { throw new Error(`pull.mjs returned invalid JSON (exit ${result.status}, signal ${result.signal}): stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}`, { cause }); }
    };
    const run = (...extra: string[]) => runAt(path.join(me, 'scripts', 'pull.mjs'), ...extra);
    return { root, me, push, run, runAt };
  };

  it('executes through a symlinked checkout path, as with macOS temporary directories', () => {
    const t = setup(), linked = path.join(t.root, 'linked-checkout');
    try {
      // A directory junction avoids elevated symlink permissions on Windows.
      fs.symlinkSync(t.me, linked, 'junction');
      expect(t.runAt(path.join(linked, 'scripts', 'pull.mjs'), '--check')).toMatchObject({ ok: true, check: true, behind: 0 });
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
  });

  it('nothing new, then a fast-forward with the commit list, never a reinstall for plain files', () => {
    const t = setup();
    expect(t.run()).toMatchObject({ ok: true, upToDate: true });
    t.push('second'); t.push('third');
    const r = t.run();
    expect(r).toMatchObject({ ok: true, upToDate: false, behind: 2, depsReinstalled: false, built: false });
    expect(r.commits.map((c: string) => c.split(' ')[1])).toEqual(['third', 'second']);
    expect(g(t.me, 'log', '-1', '--format=%s')).toBe('third');
    fs.rmSync(t.root, { recursive: true, force: true });
  });

  it('--check counts what GitHub has and changes nothing (ADR 0075)', () => {
    const t = setup();
    expect(t.run('--check')).toMatchObject({ ok: true, check: true, behind: 0, canUpdate: false });
    t.push('news');
    const before = g(t.me, 'rev-parse', 'HEAD');
    const r = t.run('--check');
    expect(r).toMatchObject({ ok: true, behind: 1, canUpdate: true, message: expect.stringContaining('1 aggiornamento') });
    expect(r.commits[0]).toMatch(/ news$/);
    expect(g(t.me, 'rev-parse', 'HEAD')).toBe(before);
    expect(r.depsChanged).toBe(false);
    // an untracked file: fine for a dev pull, a change for a stable copy's promotion (--strict)
    fs.writeFileSync(path.join(t.me, 'stray.txt'), 'x');
    expect(t.run('--check')).toMatchObject({ ok: true, canUpdate: true });
    expect(t.run('--check', '--strict')).toMatchObject({ ok: false, message: expect.stringContaining('non salvate') });
    fs.rmSync(path.join(t.me, 'stray.txt'));
    fs.writeFileSync(path.join(t.me, 'a.txt'), 'changed');
    expect(t.run('--check')).toMatchObject({ ok: false, message: expect.stringContaining('non salvate') });
    fs.rmSync(t.root, { recursive: true, force: true });
  });

  it('local commits or uncommitted changes stop it and leave main where it was', () => {
    const t = setup();
    t.push('theirs');
    fs.writeFileSync(path.join(t.me, 'a.txt'), 'changed');
    expect(t.run()).toMatchObject({ ok: false, message: expect.stringContaining('non salvate') });
    g(t.me, 'commit', '-q', '-am', 'mine');
    const before = g(t.me, 'rev-parse', 'HEAD');
    expect(t.run()).toMatchObject({ ok: false, message: expect.stringContaining('commit locali') });
    expect(g(t.me, 'rev-parse', 'HEAD')).toBe(before);
    fs.rmSync(t.root, { recursive: true, force: true });
  });
});
