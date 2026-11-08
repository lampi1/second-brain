// `npm run check:quick`, a branch's gate before the merge (owner, 2026-11-07: "rifai i test mille volte"):
// typecheck, lint of the changed files, only the tests that import a changed file directly, share its name or name it
// as a string (no transitive graph, unlike `vitest --changed`), and the doc freshness tests when the change touches
// what they read. Deleted and renamed files pick the tests of their old path; a changed source no test reaches turns
// the closing line into "green WITHOUT tests" (owner, 2026-11-07: restyles touch mostly untested renderer files).
// Records nothing; with the e2e specs of the touched part it is all a branch needs before the merge (owner, 2026-11-08),
// the full `npm run check` runs on main after a batch of merges. Used by package.json "check:quick";
// test/unit/check-quick.test.ts checks how it picks the tests.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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

let tsLib;
const ts = () => (tsLib ??= createRequire(import.meta.url)('typescript'));

/** fs calls and the argument that is the path they create: a file a test writes into a temp dir is not one it uses */
const DEST_ARG = new Map([
  ...['writeFileSync', 'writeFile', 'appendFileSync', 'mkdirSync', 'mkdir'].map(f => [f, 0]),
  ...['copyFileSync', 'copyFile', 'cpSync', 'cp', 'renameSync', 'rename', 'symlinkSync'].map(f => [f, 1]),
]);

/**
 * The string literals a test's code holds (comments and strings quoted inside strings, like fixtures, never count),
 * plus each call's consecutive string arguments joined by '/' (path.join(ROOT, 'scripts', 'logs.mjs') ->
 * 'scripts/logs.mjs'): the paths a test really passes to spawn, exec, readFile or import. The path an fs call creates
 * (fs.writeFileSync(path.join(dir, 'ops', 'tools', 'x.mjs'), …)) is skipped: it names the test's own temp file.
 */
export function codeStrings(text) {
  const t = ts();
  const out = [];
  const isLit = n => t.isStringLiteral(n) || t.isNoSubstitutionTemplateLiteral(n);
  const visit = n => {
    if (isLit(n)) out.push(n.text);
    else if (t.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map(s => s.literal.text));
    const call = t.isCallExpression(n) || t.isNewExpression(n);
    const args = call ? [...(n.arguments ?? [])] : [];
    for (let i = 0; i + 1 < args.length; i++) if (isLit(args[i]) && isLit(args[i + 1])) out.push(`${args[i].text}/${args[i + 1].text}`);
    const callee = call && (t.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression);
    const dest = callee && t.isIdentifier(callee) ? args[DEST_ARG.get(callee.text) ?? -1] : undefined;
    t.forEachChild(n, c => { if (c !== dest) visit(c); });
  };
  visit(t.createSourceFile('test.ts', text, t.ScriptTarget.Latest, false, t.ScriptKind.TS));
  return out;
}
/**
 * A changed source a unit test must cover: not a declaration, not test code of another kind (e2e, shots, live); unit
 * test helpers, fixtures and root config files count (a config no unit test reads, like vitest.config.ts, says WITHOUT).
 */
const needsCover = f => !/\.d\.[cm]?ts$/.test(f) && (!f.startsWith('test/') || /^test\/(unit|fixtures)\//.test(f));
/** root configs a test reads without naming them: a test that builds an ESLint instance loads eslint.config.js */
const IMPLICIT = [{ file: /^eslint\.config\.[cm]?js$/, reader: /\bnew\s+ESLint\s*\(/ }];
/** a test's folder under test/unit ('chats' for test/unit/chats/x.test.ts, '' at the top), or its own folder in src/ */
const testFolder = t => { const d = path.posix.dirname(t); return d === 'test/unit' ? '' : d.startsWith('test/unit/') ? d.slice('test/unit/'.length) : d; };
/** whether a same-name test counts as covering `f`: its folder is one of f's folders (test/unit/chats -> src/main/chats) */
const nameCovers = (t, f) => { const r = testFolder(t); return r !== '' && `/${path.posix.dirname(f)}/`.includes(`/${r}/`); };
/** `export … from './x'` (re-exports of any module; type-only ones are erased at run time) */
const REEXPORT = /\bexport\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
const MODULE_EXT = ['ts', 'tsx', 'mts', 'mjs', 'js', 'cjs'];
const groupBy = (list, key) => list.reduce((m, f) => m.set(key(f), [...(m.get(key(f)) ?? []), f]), new Map());
/** 'scripts/logs.mjs' for scripts/logs.mjs: the folder and the name, a bare 'check.mjs' is too loose */
const relOf = f => { const dir = path.posix.basename(path.posix.dirname(f)); return dir === '.' ? path.posix.basename(f) : `${dir}/${path.posix.basename(f)}`; };
/** Whether `p` (a path a test uses, maybe '../..'-relative) ends with `rel`; `loose` compares without the extension. */
const endsWith = (p, rel, loose) => {
  const [a, b] = loose ? [stem(p), stem(rel)] : [p, rel];
  return a === b || a.endsWith(`/${b}`);
};
/** The paths shell hook files run ('exec node "$(dirname "$0")/../scripts/guard-commit.mjs"'), comment lines skipped. */
export const hookPaths = text => text.split('\n').filter(l => !l.trimStart().startsWith('#'))
  .flatMap(l => l.match(/(?:[\w.-]+\/)+[\w.-]+\.(?:mjs|cjs|js)\b/g) ?? []);

/**
 * The tests to run for `changed` (repo-relative paths): changed test files, tests importing a changed file directly
 * (or a module re-exporting it, through any chain of re-exports), tests with the same name as a changed file
 * (foo.ts -> foo.test.ts), tests naming it in a code string by folder and name ('scripts/logs.mjs', path.join(ROOT, 'scripts', 'logs.mjs'), an import in a
 * program run with node -e), tests loading a root config implicitly (IMPLICIT). A test also reaches what the helpers it
 * imports reach (`helpers`: non-test files under test/, e.g. the fake CLI fixtures), and what a hook folder runs when
 * its code names that folder (`hooks`: '.githooks' -> the scripts its hooks exec). `uncovered`: the changed sources no
 * test reaches that way; a same-name test covers only from one of the source's folders (nameCovers). `read(file)`
 * returns a file's text and may throw for a missing one.
 */
export function pickTests(changed, testFiles, read, { helpers = [], hooks = new Map() } = {}) {
  const sources = changed.filter(f => SOURCE_EXT.test(f) && !TEST_FILE.test(f));
  const byStem = groupBy(sources, stem);
  const byName = groupBy(sources, f => path.posix.basename(stem(f)));
  const named = sources.filter(f => !/^index\./.test(path.posix.basename(f)))
    .map(f => ({ f, rel: relOf(f), key: path.posix.basename(stem(f)) }));
  const helperByStem = new Map(helpers.map(h => [stem(h), h]));
  const readOr = f => { try { return read(f); } catch { return null; } };
  const texts = new Map();
  /** the file and text of the module at `target` ('src/shared/contract' -> contract.ts, else contract/index.ts) */
  const moduleAt = target => {
    if (!texts.has(target)) {
      const file = [...MODULE_EXT.map(e => `${target}.${e}`), ...MODULE_EXT.map(e => `${target}/index.${e}`)]
        .find(f => readOr(f) !== null);
      texts.set(target, file ? { file, text: readOr(file) } : null);
    }
    return texts.get(target);
  };
  const reexports = new Map();
  /**
   * the changed sources the module at `target` re-exports, through chains of re-exports of any module
   * (contract.ts -> export * from './contract/chats' -> chats.ts); `seen` stops a re-export cycle
   */
  const reexported = target => {
    if (!reexports.has(target)) {
      const hits = [], seen = new Set([target]), todo = [target];
      while (todo.length) {
        const mod = moduleAt(todo.pop());
        if (!mod) continue;
        for (const m of mod.text.matchAll(REEXPORT)) {
          const next = resolveSpecifier(mod.file, m[1]);
          if (next === null || seen.has(next)) continue;
          seen.add(next);
          hits.push(...(byStem.get(next) ?? []));
          todo.push(next);
        }
      }
      reexports.set(target, hits);
    }
    return reexports.get(target);
  };
  const implicit = sources.filter(f => IMPLICIT.some(i => i.file.test(f)));
  const memo = new Map();
  let cut = false;
  /**
   * the changed sources `file` reaches: its imports (and what an imported module re-exports), the paths in its code
   * strings, its helpers' and hooks'. A result cut short by an import cycle is not cached.
   */
  const reach = (file, stack = new Set()) => {
    if (memo.has(file)) return memo.get(file);
    if (stack.has(file)) { cut = true; return []; }
    stack.add(file);
    const outer = cut;
    cut = false;
    const text = read(file), hits = [];
    for (const s of specifiers(text)) {
      const target = resolveSpecifier(file, s);
      if (target === null) continue;
      hits.push(...(byStem.get(target) ?? []), ...reexported(target));
      if (helperByStem.has(target)) hits.push(...reach(helperByStem.get(target), stack));
    }
    for (const f of implicit) if (IMPLICIT.some(i => i.file.test(f) && i.reader.test(text))) hits.push(f);
    const candidates = named.filter(n => text.includes(n.key));
    const dirs = [...hooks.keys()].filter(d => text.includes(d));
    if (candidates.length || dirs.length) {
      const strings = codeStrings(text);
      // a program in a string (node -e, String.raw): its imports are paths the test runs
      const programs = strings.filter(s => /\b(?:import|from)\b/.test(s)).flatMap(specifiers);
      for (const n of candidates) {
        if (strings.some(s => endsWith(s, n.rel)) || programs.some(s => endsWith(s, n.rel, true))) hits.push(n.f);
      }
      for (const d of dirs.filter(d => strings.some(s => endsWith(s, d)))) {
        for (const n of named) if (hooks.get(d).some(p => endsWith(p, n.rel))) hits.push(n.f);
      }
    }
    stack.delete(file);
    if (!cut) memo.set(file, hits);
    cut ||= outer;
    return hits;
  };
  const picked = new Set(changed.filter(f => TEST_FILE.test(f) && testFiles.includes(f)));
  const covered = new Set();
  for (const t of testFiles) {
    // a same-name test runs, but covers the source only from one of its folders (chats/claude.test.ts is not
    // packages/routine-runtime/src/claude.ts's test)
    const same = byName.get(path.posix.basename(t).replace(TEST_FILE, '')) ?? [];
    const hits = sources.length ? reach(t) : [];
    if (same.length || hits.length) picked.add(t);
    for (const f of [...hits, ...same.filter(f => nameCovers(t, f))]) covered.add(f);
  }
  return { tests: [...picked].sort(), uncovered: sources.filter(f => needsCover(f) && !covered.has(f)) };
}

/** The tests to run for `changed`: see pickTests. */
export const relatedTests = (changed, testFiles, read, opts) => pickTests(changed, testFiles, read, opts).tests;

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
  const helpers = git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'test/unit', 'test/fixtures')
    .split('\n').filter(f => SOURCE_EXT.test(f) && !TEST_FILE.test(f) && fs.existsSync(f));
  // git hooks are the one place tests run scripts from a non-JS file (guard-commit-hook.test.ts commits through them)
  const hookDir = '.githooks';
  const hooks = new Map(fs.existsSync(hookDir)
    ? [[hookDir, fs.readdirSync(hookDir).flatMap(f => hookPaths(fs.readFileSync(path.join(hookDir, f), 'utf8')))]] : []);
  const picked = pickTests(changed, testFiles, f => fs.readFileSync(f, 'utf8'), { helpers, hooks });
  const { tests } = picked;
  const uncovered = picked.uncovered.filter(f => present.includes(f));
  const docs = needsDocTests(changed) ? DOC_TESTS.filter(f => !tests.includes(f)) : [];
  console.log(`\n${tests.length} related test files${docs.length ? ` + ${docs.length} doc freshness tests` : ''}`);
  for (const files of chunks([...tests, ...docs], ARG_CHARS)) run('unit', 'npx', ['vitest', 'run', ...files]);
  if (docs.length) run('readme', 'node', ['scripts/readme-check.mjs', '--base', base]);
  console.log(`\n${verdict(uncovered, Math.round((Date.now() - started) / 1000))}`);
}

/** The closing line: plain green only when every changed source has a test; else green for typecheck and lint only. */
export function verdict(uncovered, seconds) {
  const merge = 'Before the merge: the e2e specs of the touched part, under the e2e lock (docs/agents/rules.md rule 7)';
  if (!uncovered.length) return `check:quick green in ${seconds} s: ready to try. ${merge}`;
  const more = uncovered.length > 10 ? ` and ${uncovered.length - 10} more` : '';
  return `check:quick green WITHOUT tests: ${uncovered.slice(0, 10).join(', ')}${more} (typecheck and lint only), in ${seconds} s. ${merge}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
