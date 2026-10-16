// Shared setup for the guard hook tests (guard-commit-hook.test.ts, guard-push-hook.test.ts; ADR 0061): temp git repos
// with the repo's .githooks on, a bare remote each, git isolated from the user's global config, setup steps that must
// succeed (`setup`), and the rule-matching values built at run time so no test file matches them itself. A new repo is a copy of one `git init` made per file
// (no git spawn per repo): spawns are slow on Windows under load and the hooks already spawn several per commit.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect } from 'vitest';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const HOOKS = path.join(ROOT, '.githooks').replace(/\\/g, '/');
export const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guard-hooks-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

// values the rules match, assembled here so no line of these files matches them
export const SECRET = 'AK' + 'IA' + 'QWERTYUIOPASDFGH';
export const MAIL = 'mario.rossi' + '@' + 'acme-corp.it';
export const WORD = 'Zorb' + 'quix';
export const NOREPLY = 'dev' + '@users.noreply.github.com';

// git with no global/system config and no GIT_* leaking from a parent git (a hook running the tests)
export const env = (() => {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) e[k] = v;
  const empty = path.join(base, 'empty.gitconfig');
  fs.writeFileSync(empty, '');
  return { ...e, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
})();
export const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
/** A git setup step (config, add, tag, a commit with the hooks off) that must succeed. git writes .git/config and
 *  .git/index through a lock file renamed over them; on a loaded Windows machine another process (Defender, the
 *  indexer) holding that file for a moment fails the rename after git's own short retries ("could not write config
 *  file .git/config: Permission denied", exit 4). Unchecked, that left guard.email unset and a commit the test expects
 *  blocked went through (main's check, 2026-10-16). So: retried a few times, then asserted with git's output. */
export const setup = (cwd: string, ...args: string[]) => {
  let r = git(cwd, ...args);
  for (let i = 1; r.status !== 0 && i < 6; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * i);
    r = git(cwd, ...args);
  }
  expect(r.status, `setup step failed: git ${args.join(' ')}
${r.out}`).toBe(0);
  return r;
};

// one working repo and one bare repo, initialised once; each test repo is a copy of them
const TPL = path.join(base, 'tpl');
const TPL_BARE = path.join(base, 'tpl.git');
fs.mkdirSync(TPL);
setup(TPL, 'init', '-q', '-b', 'main');
setup(base, 'init', '-q', '--bare', '-b', 'main', TPL_BARE);

let n = 0;
/** A repo with the hooks on and a bare remote; `hooks: false` leaves them off (to make commits the hooks would block). */
export function repo({ hooks = true } = {}) {
  const id = ++n;
  const dir = path.join(base, `r${id}`);
  const remote = path.join(base, `r${id}.git`);
  fs.cpSync(TPL, dir, { recursive: true });
  fs.cpSync(TPL_BARE, remote, { recursive: true });
  const fwd = (p: string) => p.replace(/\\/g, '/');
  fs.appendFileSync(path.join(dir, '.git', 'config'), [
    '[user]', '\tname = Dev', `\temail = ${NOREPLY}`,
    '[core]', '\tautocrlf = false', ...(hooks ? [`\thooksPath = ${HOOKS}`] : []),
    '[remote "origin"]', `\turl = ${fwd(remote)}`, '\tfetch = +refs/heads/*:refs/remotes/origin/*', '',
  ].join('\n'));
  const write = (f: string, s: string) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  /** the commit under test: its result is what the test checks (the add before it is setup) */
  const commit = (msg: string) => { setup(dir, 'add', '-A'); return git(dir, 'commit', '-q', '-m', msg); };
  return {
    id, dir, remote, write, commit,
    git: (...a: string[]) => git(dir, ...a),
    /** a step that must succeed (see `setup`) */
    setup: (...a: string[]) => setup(dir, ...a),
    /** a commit that is setup, not under test (hooks off) */
    committed: (msg: string) => { setup(dir, 'add', '-A'); return setup(dir, 'commit', '-q', '-m', msg); },
    push: () => git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/main'),
    /** a deny list file for this repo, named by guard.denyList */
    deny: (body: string | Buffer) => { const f = path.join(base, `deny${id}.txt`); fs.writeFileSync(f, body); setup(dir, 'config', 'guard.denyList', f); return f; },
  };
}

export const neverShows = (out: string) => { for (const v of [SECRET, MAIL, WORD]) expect(out).not.toContain(v); };

/** Per-test timeout: each commit or push runs the hook (node + several git spawns), slow on a loaded Windows machine. */
export const SLOW = 120_000;
