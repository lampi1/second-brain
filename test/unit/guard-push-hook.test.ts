// The guard's pre-push hook (ADR 0061) on real temp repos: .githooks/pre-push (scripts/guard-push.mjs) blocks a bad
// commit message, a bad line in any commit being pushed (even one a later commit removed), a wrong identity, a deny word
// in a pushed ref name, a bad annotated tag and a deny list set but missing, and lets a clean push through; only the
// commits the remote lacks are scanned. Every block names the commit, file or ref and the rule, never the matched value.
// Setup and values: guard-hooks-helpers.ts; the pre-commit hook: guard-commit-hook.test.ts.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { base, git, HOOKS, MAIL, neverShows, NOREPLY, repo, SECRET, SLOW, WORD } from './guard-hooks-helpers';

describe('pre-push', () => {
  it('a clean push passes', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    expect(r.commit('feat: a').status).toBe(0);
    const p = r.push();
    expect(p.status, p.out).toBe(0);
  }, SLOW);

  it('a bad commit message blocks the push, never printing it', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    expect(r.commit(`feat: a\n\nasked by ${MAIL}`).status).toBe(0); // pre-commit sees no message
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/commit [0-9a-f]{8} message line 3 {2}email/);
    neverShows(p.out);
    expect(git(base, '--git-dir', r.remote, 'rev-parse', '--verify', '-q', 'refs/heads/main').status).not.toBe(0);
  }, SLOW);

  it('a bad line in any pushed commit blocks, even when a later commit removed it; only new commits are scanned', () => {
    const r = repo({ hooks: false });
    r.write('a.txt', 'a\n');
    r.committed('feat: a');
    r.setup('push', '-q', 'origin', 'HEAD:refs/heads/main'); // the remote has this one
    r.write('b.txt', `k = '${SECRET}'\n`);
    r.committed('feat: b');
    r.write('b.txt', 'gone\n');
    r.committed('fix: b');
    r.setup('config', 'core.hooksPath', HOOKS);
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/b\.txt@[0-9a-f]{8}:1 {2}aws-key/);
    expect(p.out).toContain('squash or rewrite');
    neverShows(p.out);
  }, SLOW);

  it('guard.email set: a pushed commit by another e-mail blocks', () => {
    const r = repo({ hooks: false });
    r.write('a.txt', 'a\n');
    r.setup('config', 'user.email', 'other' + '@users.noreply.github.com');
    r.committed('feat: a');
    r.setup('config', 'user.email', NOREPLY);
    r.setup('config', 'guard.email', NOREPLY);
    r.setup('config', 'core.hooksPath', HOOKS);
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/commit [0-9a-f]{8}: author e-mail is not guard.email/);
    expect(p.out).toContain('--reset-author');
  }, SLOW);

  it('a branch name with a deny word blocks even with no new commit, never printing it', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    expect(r.commit('feat: a').status).toBe(0);
    expect(r.push().status).toBe(0);
    r.deny(`${WORD}\n`);
    const p = r.git('push', '-q', 'origin', `HEAD:refs/heads/${WORD}-feature`);
    expect(p.status).not.toBe(0);
    expect(p.out).toContain('pushed ref 1 of 1, remote name:1  deny-list');
    neverShows(p.out);
  }, SLOW);

  it('an annotated tag: its message and tagger are scanned, even on a commit the remote has', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    expect(r.commit('feat: a').status).toBe(0);
    expect(r.push().status).toBe(0);
    r.setup('tag', '-a', 'v1', '-m', `release for ${MAIL}`);
    const p = r.git('push', '-q', 'origin', 'v1');
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/tag object [0-9a-f]{8} \(tagger\/message\):\d+ {2}email/);
    neverShows(p.out);

    r.setup('tag', '-d', 'v1');
    r.setup('config', 'user.email', 'other' + '@users.noreply.github.com');
    r.setup('tag', '-a', 'v2', '-m', 'release');
    r.setup('config', 'user.email', NOREPLY);
    r.setup('config', 'guard.email', NOREPLY);
    const t = r.git('push', '-q', 'origin', 'v2');
    expect(t.status).not.toBe(0);
    expect(t.out).toMatch(/tag object [0-9a-f]{8}: tagger e-mail is not guard.email/);
  }, SLOW);

  it('a forbidden file under a non-ASCII folder is caught by the push (raw paths)', () => {
    const r = repo({ hooks: false });
    r.write('cfg/è/.env', 'LEVEL=1\n');
    r.committed('chore: cfg');
    r.setup('config', 'core.hooksPath', HOOKS);
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/cfg\/è\/\.env@[0-9a-f]{8}  env-file/);
  }, SLOW);

  it('the same content under a second, forbidden path is caught by its name', () => {
    const r = repo({ hooks: false });
    r.write('a.txt', 'LEVEL=1\n');
    r.write('keys/.env', 'LEVEL=1\n');
    r.committed('chore: copy');
    r.setup('config', 'core.hooksPath', HOOKS);
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toMatch(/keys\/\.env@[0-9a-f]{8}  env-file/);
  }, SLOW);

  it('only the new commits are scanned: an old commit the remote already has does not block', () => {
    const r = repo({ hooks: false });
    r.write('a.txt', 'a\n');
    r.committed(`feat: a\n\nasked by ${MAIL}`);
    expect(r.git('push', '-q', 'origin', 'HEAD:refs/heads/main').status).toBe(0);
    r.setup('config', 'core.hooksPath', HOOKS);
    r.write('b.txt', 'b\n');
    expect(r.commit('feat: b').status).toBe(0);
    const p = r.push();
    expect(p.status, p.out).toBe(0);
    expect(p.out).toContain('1 new commit checked, clean');
  }, SLOW);

  it('a deny list set but missing blocks the push', () => {
    const r = repo({ hooks: false });
    r.write('a.txt', 'a\n');
    r.committed('feat: a');
    r.setup('config', 'guard.denyList', path.join(base, 'no-such-deny.txt'));
    r.setup('config', 'core.hooksPath', HOOKS);
    const p = r.push();
    expect(p.status).not.toBe(0);
    expect(p.out).toContain('guard.denyList is set but the file cannot be read');
  }, SLOW);
});
