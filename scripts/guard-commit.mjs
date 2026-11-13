// guard-commit: the pre-commit net (ADR 0061). Scans only what is being committed: the staged content of the added and
// changed files, exported from the index (the commit's own index when git uses a temporary one) to a temp folder, with
// tools/guard/scan.mjs, the staged .guardallow and, when `guard.denyList` is set, the private deny list (set but
// missing → blocked). When `guard.email` is set, the author and committer e-mail must be that one. Seconds, so a bad
// line is caught where it is written; the full check of every commit is the pre-push net (scripts/guard-push.mjs).
// Exit 0 → the commit goes on; 1 → blocked, with file:line + rule (never the value) and the fix.
// Run by .githooks/pre-commit (installed by `npm run setup`); tested in test/unit/guard-commit-hook.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GuardError, blockMessage, denyArgs, gitOk, git, identEmail, identityFix, identityProblems, readGuardConfig, runScan } from './guard-lib.mjs';

export function guardCommit(cwd = process.cwd()) {
  const top = gitOk(['rev-parse', '--show-toplevel'], cwd).trim();
  const cfg = readGuardConfig(top);
  const deny = denyArgs(cfg);

  const idents = ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'].map(v => ({ where: 'this commit', who: v === 'GIT_AUTHOR_IDENT' ? 'author' : 'committer', email: identEmail(gitOk(['var', v], top)) }));
  const wrong = identityProblems(cfg.email, idents);
  if (wrong.length) throw new GuardError(['guard: BLOCKED, the commit identity is not the one set in guard.email', ...wrong, identityFix(cfg.email, false)].join('\n'));

  const files = gitOk(['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRT'], top)
    .split('\0').filter(Boolean);
  if (!files.length) return { files: 0 };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guard-commit-'));
  try {
    const stage = path.join(tmp, 'stage');
    fs.mkdirSync(stage);
    // the index's bytes (what the commit will hold), not the working tree's
    gitOk(['checkout-index', '-z', '--stdin', `--prefix=${stage.replace(/\\/g, '/')}/`], top, { input: files.join('\0') });
    const allow = path.join(tmp, 'guardallow');
    const staged = git(['cat-file', 'blob', ':.guardallow'], top, { buffer: true });
    fs.writeFileSync(allow, staged.status === 0 ? staged.stdout : '');
    const findings = runScan([stage, '--no-skip', '--allow', allow, ...deny]);
    if (findings.length) {
      throw new GuardError(blockMessage(findings, where => {
        const p = path.join(stage, where);
        return fs.existsSync(p) ? { path: where, buf: fs.readFileSync(p) } : null;
      }));
    }
    return { files: files.length };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { guardCommit(); } catch (e) {
    console.error(e instanceof GuardError ? e.message : `guard: BLOCKED, the pre-commit check failed (${e?.message ?? e})`);
    process.exit(1);
  }
}
