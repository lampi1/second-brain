// `npm run check:branch`, the light check of a branch (ADR 0027): typecheck, lint of the changed files, the unit tests
// related to the changes (vitest --changed against the merge base with main) and only the e2e specs that touch the
// changed area (mapped below; a small smoke set when nothing maps; never the whole e2e), plus the publish guard on the
// changed files (test/unit/publish-guard.test.ts with SB_GUARD_FILES). Green on a clean tree, it
// records the tip as "tested (light)" through scripts/check-pass.mjs --kind light. The full `npm run check` stays the
// gate of main and of `npm run promote`: a branch needs only this one to be merged. Used by package.json
// "check:branch"; changedSpecs() is unit-tested in test/unit/check-branch.test.ts.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Run when nothing maps, or when a change touches the whole app (contract, bootstrap, build). */
export const SMOKE = ['smoke.spec.ts'];
/** Above this many mapped specs the change is broad: the smoke set runs, the full check on main covers the rest. */
export const MAX_SPECS = 6;

// files every part of the app goes through: no spec owns them, the smoke set boots the whole app
const GLOBAL = [
  /^src\/shared\/contract\.ts$/, /^src\/preload\//, /^src\/main\/(index|wiring|services|ipc|window|demo|demo-wiring)\.ts$/,
  /^src\/renderer\/(App|main)\.tsx$/, /^src\/renderer\/(index\.html|sb\.ts|env\.d\.ts)$/, /^src\/renderer\/styles\//,
  /^scripts\/build\.mjs$/, /^package(-lock)?\.json$/, /^(vite|playwright)\.config\.ts$/, /^tsconfig\.json$/,
  /^test\/e2e\/(helpers|fixture-server)\.ts$/,
];
// areas whose specs do not name every file they cover
const AREAS = [
  [/^src\/main\/improve\//, ['improve.spec.ts']],
  [/^src\/main\/devops\//, ['devops.spec.ts']],
  [/^src\/main\/skills\//, ['skills.spec.ts']],
  [/^src\/main\/run\//, ['codeblocks.spec.ts', 'command-asks.spec.ts']],
  [/^src\/main\/browser\//, ['browser.spec.ts', 'browser-envs.spec.ts', 'browser-handoff.spec.ts']],
  [/^src\/main\/mcp\//, ['browser.spec.ts']],
  [/^src\/main\/brain\//, ['brain.spec.ts']],
  [/^src\/main\/chats\//, ['chats.spec.ts']],
  [/^src\/renderer\/brain\//, ['brain-ui.spec.ts']],
];
// names too common to point at one spec when a spec mentions them ("service.ts" is in many headers)
const GENERIC = new Set(['index', 'service', 'tools', 'demo', 'api', 'model', 'ui', 'store', 'types', 'lib', 'helpers']);
// changes that no e2e spec can see
const NO_E2E = [/^docs\//, /\.md$/, /^test\/unit\//, /^test\/live\//, /^scripts\/(?!build\.mjs)/, /^\.github\//, /^eslint\.config\./, /^vitest\.config\./];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The e2e specs a set of changed paths (repo-relative, any slash) needs, and why, in one line each.
 *  specs: every spec file name with its source text. */
export function changedSpecs(changed, specs) {
  const names = new Set(specs.map(s => s.name));
  const hits = new Map(); // spec → score
  let mine = new Set(); // the specs the file in hand maps to
  const add = (spec, n = 1) => { if (names.has(spec)) { hits.set(spec, (hits.get(spec) ?? 0) + n); mine.add(spec); } };
  const why = [];
  let global = false, unmapped = false;
  for (const raw of changed) {
    const f = raw.replace(/\\/g, '/');
    if (/^test\/e2e\/[^/]+\.spec\.ts$/.test(f)) { add(path.posix.basename(f), 10); continue; }
    if (/^test\/e2e\/.+-snapshots\//.test(f)) { add(f.split('/')[2].replace(/-snapshots$/, ''), 10); continue; }
    if (GLOBAL.some(r => r.test(f))) { global = true; why.push(`${f}: whole app → smoke`); continue; }
    if (NO_E2E.some(r => r.test(f))) continue;
    for (const [r, list] of AREAS) if (r.test(f)) list.forEach(s => add(s, 2));
    const stem = path.posix.basename(f).replace(/\.[^.]+$/, '');
    const parent = path.posix.basename(path.posix.dirname(f));
    // a spec named like the file (mail.ts → mail.spec.ts, store/improve.ts → improve.spec.ts)
    add(`${stem.toLowerCase()}.spec.ts`, 3);
    // a spec that names the file: "components/ImprovePage.tsx", "run/asks.ts", "ChatTile.tsx" (not "service.ts")
    const base = path.posix.basename(f);
    const said = GENERIC.has(stem) ? new RegExp(`\\b${escape(`${parent}/${base}`)}\\b`) : new RegExp(`(^|[^\\w-])${escape(base)}\\b`);
    for (const s of specs) if (said.test(s.text)) add(s.name, 2);
    // a fixture folder or file a spec uses (test/fixtures/devops/…, test/fixtures/fake-claude.mjs)
    const fixture = /^test\/fixtures\/([^/]+)/.exec(f)?.[1];
    if (fixture) for (const s of specs) if (s.text.includes(fixture)) add(s.name, 2);
    if (mine.size) why.push(`${f} → ${[...mine].join(', ')}`);
    else { unmapped = true; why.push(`${f}: no spec names it → smoke`); }
  }
  let picked = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  if (picked.length > MAX_SPECS) {
    why.push(`${picked.length} specs touched: the ${MAX_SPECS} closest run, the full check on main covers the rest`);
    picked = picked.slice(0, MAX_SPECS);
  }
  if (global || unmapped) {
    for (const s of SMOKE) if (names.has(s) && !picked.includes(s)) picked.push(s);
  }
  return { specs: picked, why };
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

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
  console.log(`check:branch on ${branch} (base ${mainRef} ${base.slice(0, 7)}): ${changed.length} changed files`);
  const dir = path.join(repo, 'test', 'e2e');
  const specs = fs.readdirSync(dir).filter(f => f.endsWith('.spec.ts')).map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  const plan = changedSpecs(changed, specs);
  for (const w of plan.why) console.log(`  ${w}`);
  console.log(`e2e: ${plan.specs.length ? plan.specs.join(' ') : 'none'}`);

  run('start', 'node', ['scripts/check-pass.mjs', '--start']);
  run('typecheck', 'npm', ['run', 'typecheck']);
  const lintAll = changed.some(f => /^(eslint\.config\.|package(-lock)?\.json$|tsconfig\.json$)/.test(f));
  const lintable = changed.filter(f => /\.(ts|tsx|mjs|js|cjs)$/.test(f) && fs.existsSync(f));
  if (lintAll) run('lint', 'npx', ['eslint', '.']);
  else if (lintable.length) run('lint', 'npx', ['eslint', '--no-warn-ignored', ...lintable]);
  run('unit', 'npx', ['vitest', 'run', '--changed', base, '--passWithNoTests']);
  // the product sync publishes the changed files too: the publish guard on them (seconds), so a private name blocks
  // the branch, not main after the merge (2026-10-14); the full scan stays in `npm run check`
  const present = changed.filter(f => fs.existsSync(f));
  if (present.length) {
    process.env.SB_GUARD_FILES = present.join('\n');
    run('publish guard', 'npx', ['vitest', 'run', 'test/unit/publish-guard.test.ts']);
  }
  if (plan.specs.length) {
    run('build', 'node', ['scripts/build.mjs']);
    run('e2e', 'node', ['scripts/e2e.mjs', ...plan.specs.map(s => `test/e2e/${s}`)]);
  }
  run('record', 'node', ['scripts/check-pass.mjs', '--kind', 'light']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
