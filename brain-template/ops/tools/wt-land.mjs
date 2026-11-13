// wt-land: bring the work of an {{BRAIN_NAME}} worktree into main, the same way every time (07-10/10: 48 hand-made merge
// commands in 8 chats, 2 aborted, now.md overwritten 3 times with `checkout --ours`). Local git only, never pushes.
//   status            every worktree: commits not in main, uncommitted files, last commit (what is still stranded)
//   land <worktree>   (name under .claude/worktrees/ or a path) 1. refuses uncommitted work; 2. merges main into the
//                     branch: conflicts in append-only logs (ai-errors, ai-wins, bug-log, journal days, measures) are
//                     joined line by line, now.md takes main's copy (its lines are written only in main by mem.mjs),
//                     any other conflict aborts the merge and is reported; 3. runs the offline tests of the folders the
//                     branch changed; 4. refuses if the fixed context grew past the budget (brain-lint); 5. fast-forwards
//                     main (main's own pending changes are committed first as "auto:", like the Stop hook).
//                     --dry: only says what would happen (git merge-tree, nothing written).
// Usage: node "{{BRAIN}}/ops/tools/wt-land.mjs" status | land <worktree> [--dry]   (--repo: tests)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LOGS = /^(ai-errors\.md|ai-wins\.md|bug-log\.md|measures\.jsonl|journal\/\d{4}-\d{2}-\d{2}\.md)$/;
const TESTS = [
  [/^(harness\/cursor\/|\.claude\/hooks\/)/, 'harness/cursor/test.mjs'],
  [/^harness\/compare\//, 'harness/compare/test.mjs'],
  [/^ops\/tools\//, 'ops/tools/test.mjs'],
];
const BUDGET = 15000;
const SENSITIVE = /(^|\/)(\.env[^/]*|[^/]*\.env|credentials\.md)$|\.{{BRAIN_NAME}}\.env/i;

const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120000 });
const out = (r) => (r.stdout || '').trim();

export function worktrees(repo) {
  const list = [];
  let cur = null;
  for (const l of out(git(repo, 'worktree', 'list', '--porcelain')).split('\n')) {
    if (l.startsWith('worktree ')) list.push(cur = { path: l.slice(9) });
    else if (l.startsWith('branch ')) cur.branch = l.slice(7).replace('refs/heads/', '');
  }
  return list.slice(1); // the first is the main checkout
}

export function status(repo) {
  return worktrees(repo).filter(w => w.branch).map(w => {
    const ahead = Number(out(git(repo, 'rev-list', '--count', `main..${w.branch}`))) || 0;
    const dirty = out(git(w.path, 'status', '--porcelain')).split('\n').filter(Boolean).length;
    const last = out(git(repo, 'log', '-1', '--format=%cs %s', w.branch));
    return { name: path.basename(w.path), path: w.path, branch: w.branch, ahead, dirty, last };
  });
}

const resolvePath = (repo, which) => {
  const p = fs.existsSync(which) ? path.resolve(which) : path.join(repo, '.claude', 'worktrees', which);
  // real paths: git prints long names, a temp path may use the 8.3 short name
  const real = q => { try { return fs.realpathSync.native(q).toLowerCase(); } catch { return path.resolve(q).toLowerCase(); } };
  const w = worktrees(repo).find(x => real(x.path) === real(p));
  if (!w) throw new Error(`"${which}" non è un worktree di ${repo} (vedi \`status\`)`);
  return w;
};

// Join an append-only log: main's lines, then the branch's new lines not already there (order kept).
// Any failure (stage unreadable, output too big, binary) throws: never a log written with one side missing.
function unionFile(wt, file) {
  const big = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  const staged = new Set(out(git(wt, 'ls-files', '-u', '--', file)).split('\n').filter(Boolean).map(l => l.split(/\s+/)[2]));
  const stage = n => {
    if (!staged.has(String(n))) return ''; // add/add: no base
    const r = spawnSync('git', ['-C', wt, 'show', `:${n}:${file}`], big);
    if (r.status !== 0 || r.error) throw new Error(`stage ${n} di ${file} illeggibile`);
    return r.stdout;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-land-'));
  try {
    // main (stage 3) first, then the branch's new lines (stage 2)
    const [b, o, t] = [1, 2, 3].map(n => { const f = path.join(dir, String(n)); fs.writeFileSync(f, stage(n)); return f; });
    const r = spawnSync('git', ['merge-file', '-p', '--union', t, b, o], big);
    if (r.status !== 0 || r.error) throw new Error(`unione di ${file} fallita: ${r.stderr || r.error}`);
    fs.writeFileSync(path.join(wt, file), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  git(wt, 'add', '--', file);
}

// Merge main into the worktree's branch: logs joined, now.md from main, any other conflict → abort and throw.
function mergeMain(w, log, mainState = 'main non toccato') {
  const m = git(w.path, 'merge', '--no-edit', 'main');
  if (m.status === 0) return;
  const conflicted = out(git(w.path, 'diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean);
  const real = conflicted.filter(f => !LOGS.test(f) && f !== 'now.md');
  if (!conflicted.length || real.length) {
    git(w.path, 'merge', '--abort');
    throw new Error(`conflitto da risolvere a mano in ${real.join(', ') || '(merge fallito)'}: merge annullato, ${mainState}\n${out(m)}${m.stderr}`);
  }
  try {
    for (const f of conflicted) {
      if (f === 'now.md') { git(w.path, 'checkout', '--theirs', '--', f); git(w.path, 'add', '--', f); } else unionFile(w.path, f);
    }
  } catch (e) { git(w.path, 'merge', '--abort'); throw new Error(`${e.message}: merge annullato, ${mainState}`); }
  const c = git(w.path, 'commit', '--no-edit', '-q');
  if (c.status !== 0) { git(w.path, 'merge', '--abort'); throw new Error(`commit del merge fallito: ${c.stderr}`); }
  log(`conflitti risolti: ${conflicted.map(f => (f === 'now.md' ? 'now.md (copia di main)' : `${f} (righe unite)`)).join(', ')}`);
}

const fixedChars = root => {
  const r = spawnSync(process.execPath, [path.join(root, 'ops', 'tools', 'brain-lint.mjs'), '--json'], { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(r.stdout).fixedTotal; } catch { return null; }
};

export function land(repo, which, { dry = false, runTests = true, log = console.log } = {}) {
  const w = resolvePath(repo, which);
  const dirty = out(git(w.path, 'status', '--porcelain'));
  if (dirty) throw new Error(`il worktree ha modifiche non committate, prima il commit:\n${dirty}`);
  const changed = out(git(repo, 'diff', '--name-only', `main...${w.branch}`)).split('\n').filter(Boolean);
  if (!changed.length && Number(out(git(repo, 'rev-list', '--count', `main..${w.branch}`))) === 0) return log(`${w.branch}: niente da portare in main`);

  if (dry) {
    const mt = git(repo, 'merge-tree', '--write-tree', '--name-only', 'main', w.branch);
    // output: tree id, the conflicted paths, a blank line, then messages
    const lines = (mt.stdout || '').split('\n');
    const conflicts = mt.status === 1 ? lines.slice(1, lines.indexOf('', 1) > 0 ? lines.indexOf('', 1) : undefined).filter(Boolean) : [];
    const real = conflicts.filter(f => !LOGS.test(f) && f !== 'now.md');
    return log(`${w.branch}: ${changed.length} file cambiati (${changed.slice(0, 8).join(', ')}${changed.length > 8 ? '…' : ''}); conflitti: ${conflicts.length ? conflicts.join(', ') : 'nessuno'}${real.length ? ` → si fermerebbe su ${real.join(', ')}` : ''}`);
  }

  // 2. main into the branch
  mergeMain(w, log);

  // 3. tests of the touched folders
  if (runTests) {
    for (const t of [...new Set(TESTS.filter(([re]) => changed.some(f => re.test(f))).map(([, t]) => t))]) {
      if (!fs.existsSync(path.join(w.path, t))) continue;
      const r = spawnSync(process.execPath, [path.join(w.path, t)], { cwd: w.path, encoding: 'utf8', timeout: 600000, input: '' });
      if (r.status !== 0) throw new Error(`test falliti (${t}), main non toccato:\n${(r.stdout + r.stderr).trim().split('\n').slice(-15).join('\n')}`);
      log(`test ok: ${t} · ${out(r).split('\n').pop()}`);
    }
    // 4. fixed context never grows past the budget
    const before = fixedChars(repo), after = fixedChars(w.path);
    if (before !== null && after !== null && after > before && after > BUDGET) throw new Error(`contesto fisso ${before} → ${after} caratteri (budget ${BUDGET}): prima accorcia, main non toccato`);
  }

  // 5. fast-forward main; main's own pending changes first committed like the Stop hook does
  const head = out(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'));
  if (head !== 'main') throw new Error(`il checkout principale è su "${head}", non su main: niente fast-forward`);
  let ff = git(repo, 'merge', '--ff-only', w.branch);
  if (ff.status !== 0) {
    const pending = out(git(repo, 'status', '--porcelain', '-uall')).split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
    if (pending.some(p => SENSITIVE.test(p))) throw new Error('main ha file sensibili non ignorati: niente commit automatico, main non toccato');
    if (pending.length) { git(repo, 'add', '-A', '--', '.', ':(exclude).claude/worktrees'); git(repo, 'commit', '-q', '-m', `auto: before landing ${w.branch} (${pending.slice(0, 3).join(', ')}${pending.length > 3 ? ` +${pending.length - 3}` : ''})`); }
    // main may have moved: merge it again into the branch (logs/now.md as above), then retry once
    mergeMain(w, log, pending.length ? `main ha solo il commit "auto:" ${out(git(repo, 'rev-parse', '--short', 'main'))} con le sue modifiche in sospeso` : 'main non toccato');
    ff = git(repo, 'merge', '--ff-only', w.branch);
    if (ff.status !== 0) throw new Error(`fast-forward di main fallito: ${ff.stderr.trim()}`);
  }
  log(`${w.branch} portato in main: ${out(git(repo, 'log', '-1', '--format=%h %s', 'main'))}`);
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--repo');
  const repo = i >= 0 ? argv[i + 1] : '{{BRAIN}}';
  try {
    if (argv[0] === 'status') {
      const s = status(repo).sort((a, b) => b.ahead + b.dirty - (a.ahead + a.dirty));
      const open = s.filter(x => x.ahead || x.dirty);
      console.log(`Worktree di {{BRAIN_NAME}}: ${s.length}, con lavoro non in main: ${open.length}`);
      for (const x of open) console.log(`- ${x.name}: ${x.ahead} commit non in main, ${x.dirty} file non committati · ultimo: ${x.last}`);
    } else if (argv[0] === 'land' && argv[1]) {
      land(repo, argv[1], { dry: argv.includes('--dry') });
    } else {
      console.log('usage: node ops/tools/wt-land.mjs status | land <worktree> [--dry]');
      process.exitCode = 1;
    }
  } catch (e) { console.error(`wt-land: ${e.message}`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
