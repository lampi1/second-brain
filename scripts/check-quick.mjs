// `npm run check:quick`, the "ready to try" check of a branch (owner, 2026-11-07: "rifai i test mille volte"):
// typecheck, lint of the changed files, only the tests that import a changed file directly or share its name (no
// transitive graph, unlike `vitest --changed`), and the doc freshness tests when the change touches what they read.
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

/** The module specifiers a test file imports or mocks (static, dynamic, vi.mock). */
export function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock)\s*\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** A specifier of `testFile` resolved to a repo-relative path without extension, or null for a package. */
export function resolveSpecifier(testFile, spec) {
  if (spec.startsWith('@shared/')) return stem(`src/shared/${spec.slice('@shared/'.length)}`);
  if (!spec.startsWith('.')) return null;
  return stem(path.posix.normalize(path.posix.join(path.posix.dirname(posix(testFile)), spec)));
}

/**
 * The tests to run for `changed` (repo-relative paths): changed test files, tests importing a changed file directly,
 * tests with the same name as a changed file (foo.ts -> foo.test.ts). `read(file)` returns a test file's text.
 */
export function relatedTests(changed, testFiles, read) {
  const sources = changed.filter(f => SOURCE_EXT.test(f) && !TEST_FILE.test(f));
  const targets = new Set(sources.map(stem));
  const names = new Set(sources.map(f => path.posix.basename(stem(f))));
  const picked = new Set(changed.filter(f => TEST_FILE.test(f) && testFiles.includes(f)));
  for (const t of testFiles) {
    if (picked.has(t)) continue;
    if (names.has(path.posix.basename(t).replace(TEST_FILE, ''))) { picked.add(t); continue; }
    if (!targets.size) continue;
    if (specifiers(read(t)).some(s => targets.has(resolveSpecifier(t, s)))) picked.add(t);
  }
  return [...picked].sort();
}

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
  const changed = [...new Set([
    ...git('-c', 'core.quotePath=false', 'diff', '--name-only', base).split('\n'),
    ...git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean))].filter(f => fs.existsSync(f));
  console.log(`check:quick on ${branch} (base ${mainRef} ${base.slice(0, 7)}): ${changed.length} changed files`);

  run('typecheck', 'npm', ['run', 'typecheck']);
  const lintable = changed.filter(f => SOURCE_EXT.test(f));
  for (const files of chunks(lintable, ARG_CHARS)) run('lint', 'npx', ['eslint', '--no-warn-ignored', ...files]);

  const testFiles = git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'test/unit', 'src')
    .split('\n').filter(f => TEST_FILE.test(f) && fs.existsSync(f));
  const tests = relatedTests(changed, testFiles, f => fs.readFileSync(f, 'utf8'));
  const docs = needsDocTests(changed) ? DOC_TESTS.filter(f => !tests.includes(f)) : [];
  console.log(`\n${tests.length} related test files${docs.length ? ` + ${docs.length} doc freshness tests` : ''}`);
  for (const files of chunks([...tests, ...docs], ARG_CHARS)) run('unit', 'npx', ['vitest', 'run', ...files]);
  if (docs.length) run('readme', 'node', ['scripts/readme-check.mjs', '--base', base]);
  console.log(`\ncheck:quick green in ${Math.round((Date.now() - started) / 1000)} s: ready to try. Before the merge, once: npm run check:branch`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
