// guard-lib: what the two git hooks share (ADR 0061): the guard config of the repo (`guard.denyList`, `guard.email`),
// running tools/guard/scan.mjs, the identity check and the block message. The block message names file:line and the
// rule, never the matched value, and says how to fix it. Fail-closed: a config that cannot be read, a deny list that is
// set but missing, a scanner error all block. No dependencies.
// Used by scripts/guard-commit.mjs (pre-commit), scripts/guard-push.mjs (pre-push), scripts/setup-hooks.mjs
// (`npm run setup`), scripts/doctor.mjs and scripts/setup-pc.mjs (guardStatus); tested in test/unit/guard-commit-hook.test.ts and guard-push-hook.test.ts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'guard', 'scan.mjs');
export const HOOKS_PATH = '.githooks';

/** A guard problem that blocks: the message is printed as it is (never a stack). */
export class GuardError extends Error {}

/** git in `cwd`; returns { status, stdout (string or Buffer), stderr }. Never a shell. */
export function git(args, cwd, { input, buffer = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: buffer ? undefined : 'utf8', maxBuffer: 1 << 30, windowsHide: true });
  if (r.error) throw new GuardError(`guard: git could not run (${r.error.message})`);
  return { status: r.status, stdout: r.stdout, stderr: String(r.stderr ?? '') };
}

/** git that must succeed: a failure blocks with git's last error line. */
export function gitOk(args, cwd, opts) {
  const r = git(args, cwd, opts);
  if (r.status !== 0) throw new GuardError(`guard: git ${args[0]} failed (${r.stderr.trim().split('\n').pop() || `exit ${r.status}`})`);
  return r.stdout;
}

/** One git config value: null when unset (exit 1); any other failure blocks. */
export function configValue(key, cwd, type) {
  const r = git(['config', ...(type ? [`--type=${type}`] : []), '--get', key], cwd);
  if (r.status === 1) return null;
  if (r.status !== 0) throw new GuardError(`guard: cannot read git config ${key} (${r.stderr.trim() || `exit ${r.status}`})`);
  return r.stdout.trim() || null;
}

/** %NAME% → its environment value (git does not expand them; the documented Windows path uses %LOCALAPPDATA%). */
export function expandEnv(p, env = process.env) {
  return p.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, n) => env[n] ?? m);
}

/** The repo's guard config: { denyList: absolute path | null, email: string | null }. */
export function readGuardConfig(cwd) {
  const raw = configValue('guard.denyList', cwd, 'path');
  const email = configValue('guard.email', cwd);
  return { denyList: raw ? path.resolve(cwd, expandEnv(raw)) : null, email: email ? email.toLowerCase() : null };
}

/** The scanner's --deny arguments: none when guard.denyList is unset (built-in rules only); a deny list that is set
 *  but missing or unreadable blocks, never skips. */
export function denyArgs(cfg) {
  if (!cfg.denyList) return [];
  try { fs.readFileSync(cfg.denyList); } catch (e) {
    throw new GuardError([
      `guard: BLOCKED, guard.denyList is set but the file cannot be read (${e.code ?? e.message}): ${cfg.denyList}`,
      '  fix: restore the private deny list at that path, or point the config to it: git config guard.denyList "<path>"',
      '  (unset it only on a PC that has no private list: git config --unset guard.denyList)',
    ].join('\n'));
  }
  return ['--deny', cfg.denyList];
}

/** `Name <mail> 123 +0100` → mail (lowercase). */
export function identEmail(ident) {
  const m = /<([^>]*)>/.exec(ident ?? '');
  return m ? m[1].trim().toLowerCase() : '';
}

/** Identity lines that differ from guard.email; the wrong address itself is never printed (it may be a work one). */
export function identityProblems(expected, idents) {
  if (!expected) return [];
  return idents.filter(i => i.email !== expected).map(i => `  ${i.where}: ${i.who} e-mail is not guard.email`);
}

export function identityFix(expected, pushing) {
  return [
    `  fix: git config user.email "${expected}"   (and user.name: the public name you want on the commits)`,
    pushing
      ? '  then rewrite the commits listed above, e.g. the last one: git commit --amend --no-edit --reset-author; several: git rebase -i <base> and amend each, or squash them'
      : '  then commit again',
  ].join('\n');
}

/** Runs the scanner; returns its findings. Exit 0 → [], 2 → findings, anything else (or unreadable output) blocks. */
export function runScan(args) {
  const r = spawnSync(process.execPath, [SCAN, ...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  if (r.error || (r.status !== 0 && r.status !== 2)) {
    const why = r.error?.message ?? (String(r.stderr ?? '').trim().split('\n').pop() || `exit ${r.status}`);
    throw new GuardError(`guard: BLOCKED, the scan could not run (${why})`);
  }
  try {
    const out = JSON.parse(r.stdout);
    if (!Array.isArray(out.findings)) throw new Error('no findings array');
    return out.findings;
  } catch (e) { throw new GuardError(`guard: BLOCKED, the scan output is unreadable (${e.message})`); }
}

// rules a pin must never silence when the value is real: the fix is to remove (and rotate) it
const SECRET = new Set(['private-key', 'aws-key', 'github-token', 'anthropic-key', 'openai-key', 'google-key', 'slack-token',
  'jwt', 'azure-storage-key', 'azure-sas', 'conn-string-password', 'url-credentials', 'assigned-secret', 'pat-azure-devops']);

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** The block message. `contentOf(where)` → { path, buf } for a file finding (to print its .guardallow line), or null.
 *  Prints locations and rules only, never a matched value. */
export function blockMessage(findings, contentOf, { pushing = false } = {}) {
  const out = [`guard: BLOCKED, ${findings.length} finding${findings.length === 1 ? '' : 's'} (the matched text is never shown: open the line)`];
  const pins = new Map();
  let meta = false, secret = false, older = false, named = false, refs = false, tags = false;
  for (const f of findings.slice(0, 200)) {
    const m = /^commit ([0-9a-f]+) \(message\/author\)$/.exec(f.where);
    if (m) {
      meta = true;
      const part = f.line <= 2 ? 'author' : f.line <= 4 ? 'committer' : `message line ${f.line - 4}`;
      out.push(`  commit ${m[1]} ${part}  ${f.rule}`);
      continue;
    }
    out.push(`  ${f.where}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
    // names and tag text are never pinned (no content to hash): only renamed or reworded
    const name = f.where.endsWith(' (path)'), ref = f.where.startsWith('pushed ref '), tag = f.where.startsWith('tag object ');
    named ||= name; refs ||= ref; tags ||= tag;
    if (pushing && !name && !ref && !tag && f.where.includes('@')) older = true;
    if (SECRET.has(f.rule)) { secret = true; continue; }
    if (name || ref || tag) continue;
    const c = contentOf(f.where);
    if (c) pins.set(`${c.path} ${f.rule} sha256:${sha256(c.buf)}`, true);
  }
  if (findings.length > 200) out.push(`  ... ${findings.length - 200} more`);
  out.push('How to fix:');
  out.push('  - edit the line: neutral example text (example.com, a made-up name, a <placeholder>), then ' + (pushing ? 'commit the fix' : 'stage it again'));
  if (secret) out.push('  - a secret-shaped value: remove it; if it was ever real, rotate it. A test value: build it at run time');
  if (pins.size) {
    out.push('  - only a proven false positive, reviewed like code: add to .guardallow (pins this exact content):');
    for (const p of pins.keys()) out.push(`      ${p}`);
  }
  if (named) out.push('  - (path): a file or folder name (*** marks the matched part): rename it (git mv), then ' + (pushing ? 'rewrite the commits that carry the old name' : 'stage it again'));
  if (refs) out.push('  - pushed ref: a branch or tag name: rename the branch (git branch -m <new>) or the tag, and push that name');
  if (tags) out.push('  - tag object: an annotated tag\'s message or tagger: delete the tag (git tag -d <name>) and create it again');
  if (meta) out.push('  - a commit message or identity: reword it (git commit --amend, or git rebase -i <base>); .guardallow never silences commits');
  if (older) out.push('  - path@commit: the line is in a commit being pushed even if a later commit fixed it: squash or rewrite those commits before pushing');
  return out.join('\n');
}

/** What doctor and setup report: hooks active, deny list and identity config. Never throws. */
export function guardStatus(cwd) {
  try {
    if (git(['rev-parse', '--is-inside-work-tree'], cwd).stdout?.trim() !== 'true') return { repo: false };
    const hooksPath = configValue('core.hooksPath', cwd);
    const hooks = hooksPath === HOOKS_PATH && fs.existsSync(path.join(cwd, HOOKS_PATH, 'pre-commit')) && fs.existsSync(path.join(cwd, HOOKS_PATH, 'pre-push'));
    const cfg = readGuardConfig(cwd);
    let deny = 'unset';
    if (cfg.denyList) { try { fs.readFileSync(cfg.denyList); deny = 'ok'; } catch { deny = 'missing'; } }
    const userEmail = configValue('user.email', cwd)?.toLowerCase() ?? null;
    return { repo: true, hooks, hooksPath, deny, email: cfg.email ? 'set' : 'unset', userEmailMatches: cfg.email ? userEmail === cfg.email : null };
  } catch (e) { return { repo: true, error: e.message }; }
}

/** The optional per-PC commands, printed by setup (never run: the values are the user's). */
export const OPTIONAL_CONFIG = [
  '# optional, a private deny list (names that must never be published; it stays outside the repo):',
  'git config guard.denyList "<path to your deny list>"',
  '# optional, the only e-mail allowed on commits (e.g. your GitHub noreply address), and the identity to use:',
  'git config guard.email "<you>@users.noreply.github.com"',
  'git config user.name "<your public name>"',
  'git config user.email "<you>@users.noreply.github.com"',
];

/** Human lines for guardStatus. */
export function statusLines(s) {
  if (!s.repo) return ['guard: not a git checkout, hooks not installed'];
  if (s.error) return [`guard: ${s.error}`];
  return [
    `guard hooks: ${s.hooks ? `active (core.hooksPath ${HOOKS_PATH})` : 'NOT active: run npm run setup'}`,
    `guard deny list: ${s.deny === 'ok' ? 'set, readable' : s.deny === 'missing' ? 'set but MISSING: commits and pushes are blocked' : 'unset (built-in rules only)'}`,
    `guard e-mail: ${s.email === 'set' ? (s.userEmailMatches ? 'set, user.email matches' : 'set, user.email DIFFERS: commits are blocked') : 'unset (no identity check)'}`,
  ];
}
