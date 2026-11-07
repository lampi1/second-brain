// `npm run check:quick`, the "ready to try" check of a branch (owner, 2026-11-07: "rifai i test mille volte"):
// typecheck, lint of the changed files, only the tests that import a changed file directly, share its name or name it
// as a string (no transitive graph, unlike `vitest --changed`), and the doc freshness tests when the change touches
// what they read. Deleted and renamed files pick the tests of their old path; a changed source no test reaches fails.
// Records nothing: `npm run check:branch` stays the gate before a merge, run once. Used by package.json "check:quick";
// test/unit/check-quick.test.ts checks how it picks the tests.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chunks, DOC_TESTS } from './check-branch.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

/** characters of file names per command line: well below cmd.exe's 8191 (same budget as check:branch) */
const ARG_CHARS = 6000;
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const TEST_FILE = /\.test\.ts$/;
/** a changed path the doc freshness tests read: src (tool scan, Guida anchors hash code anywhere), docs, the README */
const DOC_INPUTS = /^(src\/|docs\/|README\.md$|scripts\/readme-check\.mjs$)/;

const posix = p => p.split(path.sep).join('/');
const stem = p => posix(p).replace(SOURCE_EXT, '').replace(/\/index$/, '');

/** type-only imports (`import type …`, `import { type A, type B } …`): erased at run time, the typecheck covers them */
const TYPE_ONLY = /\bimport\s+type\s[^;]*?\bfrom\s*['"][^'"]+['"]|\bimport\s*\{\s*(?:type\s+[\w$]+(?:\s+as\s+[\w$]+)?\s*,?\s*)+\}\s*from\s*['"][^'"]+['"]/g;

/** The module specifiers a test file imports or mocks at run time (static, dynamic, vi.mock; type-only ones skipped). */
export function specifiers(text) {
  const out = [];
  for (const m of text.replace(TYPE_ONLY, '').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock)\s*\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** A specifier of `testFile` resolved to a repo-relative path without extension, or null for a package. */
export function resolveSpecifier(testFile, spec) {
  if (spec.startsWith('@shared/')) return stem(`src/shared/${spec.slice('@shared/'.length)}`);
  if (!spec.startsWith('.')) return null;
  return stem(path.posix.normalize(path.posix.join(path.posix.dirname(posix(testFile)), spec)));
}

/**
 * The changed paths from `git diff --name-status -M` and `git ls-files --others`: `all` also holds deleted paths and
 * the old name of renamed ones (their importers must run), `present` only the paths the change leaves in place.
 */
export function changedPaths(nameStatus, untracked) {
  const all = [], present = [];
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    all.push(...paths);
    if (status.startsWith('R')) present.push(paths[1]);
    else if (status !== 'D') present.push(paths[0]);
  }
  const extra = untracked.split('\n').filter(Boolean);
  return { all: [...new Set([...all, ...extra])], present: [...new Set([...present, ...extra])] };
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A changed source a unit test must cover: not a root config file, not a declaration, not test code (e2e, fixtures). */
const needsCover = f => f.includes('/') && !f.startsWith('test/') && !/\.d\.[cm]?ts$/.test(f);
const groupBy = (list, key) => list.reduce((m, f) => m.set(key(f), [...(m.get(key(f)) ?? []), f]), new Map());

/**
 * The tests to run for `changed` (repo-relative paths): changed test files, tests importing a changed file directly,
 * tests with the same name as a changed file (foo.ts -> foo.test.ts), tests naming it as a string ('scripts/logs.mjs',
 * path.join(…, 'setup-hooks.mjs')). `uncovered`: the changed sources no test reaches that way. `read(file)` returns a
 * test file's text.
 */
export function pickTests(changed, testFiles, read) {
  const sources = changed.filter(f => SOURCE_EXT.test(f) && !TEST_FILE.test(f));
  const byStem = groupBy(sources, stem);
  const byName = groupBy(sources, f => path.posix.basename(stem(f)));
  // the folder and the name, as 'scripts/logs.mjs' or path.join(…, 'scripts', 'logs.mjs'): a bare 'check.mjs' is too loose
  const byString = sources.filter(f => !/^index\./.test(path.posix.basename(f))).map(f => {
    const dir = path.posix.basename(path.posix.dirname(f)), base = escape(path.posix.basename(f));
    const named = dir === '.' ? base : `${escape(dir)}(?:/|['"]\\s*,\\s*['"])${base}`;
    return [f, new RegExp(`(?<![\\w.-])${named}(?![\\w.-])`)];
  });
  const picked = new Set(changed.filter(f => TEST_FILE.test(f) && testFiles.includes(f)));
  const covered = new Set();
  for (const t of testFiles) {
    const hits = [...(byName.get(path.posix.basename(t).replace(TEST_FILE, '')) ?? [])];
    if (sources.length) {
      const text = read(t);
      for (const s of specifiers(text)) hits.push(...(byStem.get(resolveSpecifier(t, s)) ?? []));
      for (const [f, re] of byString) if (re.test(text)) hits.push(f);
    }
    if (hits.length) picked.add(t);
    for (const f of hits) covered.add(f);
  }
  return { tests: [...picked].sort(), uncovered: sources.filter(f => needsCover(f) && !covered.has(f)) };
}

/** The tests to run for `changed`: see pickTests. */
export const relatedTests = (changed, testFiles, read) => pickTests(changed, testFiles, read).tests;

/** Whether the change touches something the doc freshness tests (ADR 0208) read. */
export const needsDocTests = changed => changed.some(f => DOC_INPUTS.test(f));

function run(label, cmd, args) {
  console.log(`\n> ${label}: ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.log(`\ncheck:quick failed at ${label}`); process.exit(r.status ?? 1); }
}

function main() {
  const started = Date.now();
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(repo);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const mainRef = ['main', 'master'].find(b => { try { git('rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } });
  if (!mainRef) { console.log('check:quick: no main branch here'); process.exit(1); }
  const base = git('merge-base', 'HEAD', mainRef);
  // deleted paths and old names of renamed files stay in `all`: the tests importing them must run (and fail)
  const { all: changed, present } = changedPaths(
    git('-c', 'core.quotePath=false', 'diff', '--name-status', '-M', base),
    git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'));
  console.log(`check:quick on ${branch} (base ${mainRef} ${base.slice(0, 7)}): ${changed.length} changed files`);

  run('typecheck', 'npm', ['run', 'typecheck']);
  const lintable = present.filter(f => SOURCE_EXT.test(f) && fs.existsSync(f));
  for (const files of chunks(lintable, ARG_CHARS)) run('lint', 'npx', ['eslint', '--no-warn-ignored', ...files]);

  const testFiles = git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'test/unit', 'src')
    .split('\n').filter(f => TEST_FILE.test(f) && fs.existsSync(f));
  const picked = pickTests(changed, testFiles, f => fs.readFileSync(f, 'utf8'));
  const { tests } = picked;
  const uncovered = picked.uncovered.filter(f => present.includes(f));
  const docs = needsDocTests(changed) ? DOC_TESTS.filter(f => !tests.includes(f)) : [];
  console.log(`\n${tests.length} related test files${docs.length ? ` + ${docs.length} doc freshness tests` : ''}`);
  for (const files of chunks([...tests, ...docs], ARG_CHARS)) run('unit', 'npx', ['vitest', 'run', ...files]);
  if (docs.length) run('readme', 'node', ['scripts/readme-check.mjs', '--base', base]);
  // a changed source no test reaches is not "green": 0 tests run proves nothing about it
  if (uncovered.length) {
    console.log(`\ncheck:quick not green: no test covers ${uncovered.join(', ')}. Add a test that imports it, or run npm run check:branch`);
    process.exit(1);
  }
  console.log(`\ncheck:quick green in ${Math.round((Date.now() - started) / 1000)} s: ready to try. Before the merge, once: npm run check:branch`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
