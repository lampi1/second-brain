// Which unit test files start real processes (ADR 0042): the full check (scripts/check.mjs) runs them alone, after the
// parallel e2e, because beside three Electron instances their spawns miss the test deadlines (2026-10-14: manager,
// resume and proctree on 7cb1a39; cursor-ledger, handoff and warm on e87f321). Found by a rule, not a list, so a new
// test is never chased one by one: a file is a process unit when it imports node:child_process, uses a fake engine
// fixture (test/fixtures/fake-*.mjs, FAKE / FAKE_CURSOR from test/unit/chats/helpers.ts), builds a ChatManager, or
// imports (for its code, at any depth) a src module that imports node:child_process. A file the rule cannot see goes
// in EXTRA. Checked by test/unit/e2e-workers.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Unit files that start processes in a way the rule below does not see (repo-relative, forward slashes). */
export const EXTRA = [];

const CHILD = /['"]node:child_process['"]/;
const SIGNS = [CHILD, /\bFAKE(_CURSOR)?\b|fake-[\w-]+\.mjs/, /new ChatManager\(/];

const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const noExt = f => f.replace(/\.(ts|tsx|mjs|js)$/, '');
/** The relative modules a file imports for their code (not `import type`), without extension. */
const imports = (mod, text) => [...text.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)]
  .map(m => noExt(path.resolve(path.dirname(mod), m[1])));

/** The process unit files, repo-relative with forward slashes, sorted. */
export function processUnits(repo = root) {
  // src modules that import node:child_process, then (to a fixed point) those importing one of them: a test reaches a
  // spawn through any depth (brain/live → brain/node → execFile); type-only imports never run code, so they don't count
  const src = new Map(walk(path.join(repo, 'src')).filter(f => /\.tsx?$/.test(f)).map(f => [noExt(f), fs.readFileSync(f, 'utf8')]));
  const spawners = new Set([...src].filter(([, text]) => CHILD.test(text)).map(([m]) => m));
  for (let grew = true; grew;) {
    grew = false;
    for (const [m, text] of src) {
      if (!spawners.has(m) && imports(m, text).some(d => spawners.has(d))) { spawners.add(m); grew = true; }
    }
  }
  const found = walk(path.join(repo, 'test', 'unit')).filter(f => /\.test\.ts$/.test(f)).filter(f => {
    const text = fs.readFileSync(f, 'utf8');
    return SIGNS.some(re => re.test(text)) || imports(noExt(f), text).some(d => spawners.has(d));
  }).map(f => path.relative(repo, f).split(path.sep).join('/'));
  return [...new Set([...found, ...EXTRA])].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(processUnits().join('\n'));
