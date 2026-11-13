// The guard on this repo's files (ADR 0061): the repo is public product, so its tracked files (and new ones not yet
// added; ignored ones never are) must carry no secret, personal or company data: names, hosts, e-mails, paths. Same
// scanner, allow file and deny list as the git hooks: tools/guard/scan.mjs, the repo's .guardallow and, when this
// repo's git config has `guard.denyList`, that private list. Set but missing → it FAILS (never a silent skip); unset (a
// PC with no private list, CI) → built-in rules only. Read-only: it scans a temp copy and prints only file:line + rule,
// never a matched value. A script, not a unit test, since unit tests start no git or process (docs/agents/rules.md §7).
// SB_GUARD_FILES (newline-separated repo paths): scan only those, the branch's changed files (scripts/check-branch.mjs);
// the allow file pins paths, so a subset is checked exactly as in the whole scan. Used by check-branch.mjs and check.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGuardConfig } from './guard-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.env.SB_GUARD_FILES ? new Set(process.env.SB_GUARD_FILES.split('\n').map(f => f.trim().replace(/\\/g, '/')).filter(Boolean)) : null;
const { denyList } = readGuardConfig(root);
if (denyList && !fs.existsSync(denyList)) {
  console.error('publish guard: git config guard.denyList is set but the file is missing: restore it (or unset the key on a PC with no private list)');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-publish-guard-'));
try {
  // an untracked nested repository (a git worktree under .claude/worktrees/) is listed as "dir/": its files are not this
  // repo's, and its own checkout scans them; only regular files are copied (a directory would throw EISDIR)
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter(f => f && !f.endsWith('/') && (!only || only.has(f)) && fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile());
  for (const f of new Set(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(tmp, f));
  }
  const args = [path.join(root, 'tools', 'guard', 'scan.mjs'), tmp, '--json', '--no-skip', '--allow', path.join(root, '.guardallow'), ...(denyList ? ['--deny', denyList] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 && r.status !== 2) { console.error(`publish guard: scan failed: ${r.stderr}`); process.exitCode = 1; }
  else {
    const found = JSON.parse(r.stdout).findings.map(f => `${f.where}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
    if (found.length) {
      // a finding: use a generic placeholder (example.com, "Studio Demo", a made-up name); see the line, not this output
      console.error(`publish guard: ${found.length} finding(s)\n${found.join('\n')}`);
      process.exitCode = 1;
    } else console.log(`publish guard: ${files.length} files, no finding`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
