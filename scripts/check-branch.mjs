// `npm run check:branch`, the light check of a branch (ADR 0027): typecheck, lint of the changed files, the unit tests
// related to the changes (vitest --changed against the merge base with main) and the publish guard on the changed
// files (test/unit/publish-guard.test.ts with SB_GUARD_FILES). No e2e: since 2026-10-15 the e2e runs only on main, in
// the full `npm run check` (the test lease queued branches for hours behind e2e runs). Green on a clean tree, it
// records the tip as "tested (light)" through scripts/check-pass.mjs --kind light. The full `npm run check` stays the
// gate of main and of `npm run promote`: a branch needs only this one to be merged. Used by package.json
// "check:branch"; test/unit/check-branch.test.ts checks it starts no e2e.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

/** characters of file names per eslint call: well below cmd.exe's 8191 with the command and the separators */
const LINT_CHARS = 6000;
/** The list split so each part's names, joined by spaces, stay within max characters (a longer name goes alone). */
export function chunks(list, max) {
  const out = [];
  let part = [], size = 0;
  for (const f of list) {
    if (part.length && size + f.length + 1 > max) { out.push(part); part = []; size = 0; }
    part.push(f); size += f.length + 1;
  }
  if (part.length) out.push(part);
  return out;
}

function run(label, cmd, args) {
  console.log(`\n> ${label}: ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.log(`\ncheck:branch failed at ${label}`); process.exit(r.status ?? 1); }
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(repo);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const mainRef = ['main', 'master'].find(b => { try { git('rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } });
  if (!mainRef) { console.log('check:branch: no main branch here; run the full `npm run check`'); process.exit(1); }
  if (branch === mainRef) { console.log(`check:branch is for branches: on ${mainRef} run the full \`npm run check\``); process.exit(1); }
  const base = git('merge-base', 'HEAD', mainRef);
  const changed = [...new Set([
    ...git('-c', 'core.quotePath=false', 'diff', '--name-only', base).split('\n'),
    ...git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean))];
  console.log(`check:branch on ${branch} (base ${mainRef} ${base.slice(0, 7)}): ${changed.length} changed files; no e2e (only on main, ADR 0027)`);

  run('start', 'node', ['scripts/check-pass.mjs', '--start']);
  run('typecheck', 'npm', ['run', 'typecheck']);
  const lintAll = changed.some(f => /^(eslint\.config\.|package(-lock)?\.json$|tsconfig\.json$)/.test(f));
  const lintable = changed.filter(f => /\.(ts|tsx|mjs|js|cjs)$/.test(f) && fs.existsSync(f));
  if (lintAll) run('lint', 'npx', ['eslint', '.']);
  // in chunks: cmd.exe takes at most 8191 characters per command line (a large branch exceeded it on Windows, 2026-10-20)
  else for (const files of chunks(lintable, LINT_CHARS)) run('lint', 'npx', ['eslint', '--no-warn-ignored', ...files]);
  run('unit', 'npx', ['vitest', 'run', '--changed', base, '--passWithNoTests']);
  // the repo is public product (ADR 0061): the guard on the changed files (seconds, same scanner and deny list as the
  // hooks), so a private name blocks the branch, not main after the merge (2026-10-14); the full scan is in `npm run check`
  const present = changed.filter(f => fs.existsSync(f));
  if (present.length) {
    process.env.SB_GUARD_FILES = present.join('\n');
    run('publish guard', 'npx', ['vitest', 'run', 'test/unit/publish-guard.test.ts']);
  }
  run('record', 'node', ['scripts/check-pass.mjs', '--kind', 'light']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
