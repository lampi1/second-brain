// Records a green `npm run check` (ADR 0020): `--start` is the first step of the check script (it notes the commit
// being checked), the plain call is the last one, so it runs only when every step passed; `--kind light` marks the
// light check of a branch (`npm run check:branch`, ADR 0027; entries without a kind are full). Writes the commit into
// <git-common-dir>/sb-checks.json (shared by every worktree, never committed), where the "Migliora l'app" section reads
// which branches are tested. A check on uncommitted changes proves nothing about a commit, and a commit made while the
// check ran was never checked: then it records nothing. Used by package.json "check" and scripts/check-branch.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
// per worktree (its own git dir): two worktrees checking at once never read each other's start
const startFile = () => path.join(path.resolve(git('rev-parse', '--git-dir')), 'sb-check-start.json');
try {
  if (process.argv.includes('--start')) {
    fs.writeFileSync(startFile(), JSON.stringify({ sha: git('rev-parse', 'HEAD'), clean: !git('status', '--porcelain') }));
    process.exit(0);
  }
  let start = null;
  try { start = JSON.parse(fs.readFileSync(startFile(), 'utf8')); fs.rmSync(startFile(), { force: true }); } catch { /* none */ }
  const sha = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain') || (start && !start.clean)) { console.log('check green, not recorded: uncommitted changes'); process.exit(0); }
  if (!start || start.sha !== sha) { console.log(`check green, not recorded: HEAD changed during the check (${String(start?.sha ?? '?').slice(0, 7)} -> ${sha.slice(0, 7)})`); process.exit(0); }
  const file = path.join(path.resolve(git('rev-parse', '--git-common-dir')), 'sb-checks.json');
  let checks = {};
  try { checks = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first one */ }
  // light = `npm run check:branch` (ADR 0027); a full check is never downgraded by a later light one on the same commit
  const kind = process.argv.includes('--kind') && process.argv[process.argv.indexOf('--kind') + 1] === 'light' ? 'light' : 'full';
  const prev = checks[sha];
  if (kind === 'light' && prev && (prev.kind ?? 'full') === 'full') { console.log(`check green, ${sha.slice(0, 7)} already has a full check`); process.exit(0); }
  checks[sha] = { at: new Date().toISOString(), kind };
  const kept = Object.entries(checks).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 300);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(kept), null, 1));
  fs.renameSync(`${file}.tmp`, file);
  console.log(`check green, recorded for ${sha.slice(0, 7)}`);
} catch (e) { console.log(`check green, not recorded: ${e.message}`); }
