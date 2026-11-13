// The review pack (token plan 2026-10-20, F5): what a reviewer or a test runner needs to know about a repository's
// change, gathered by the app with git (zero tokens) and put under a Sentinel's first message, instead of the 5-15 git
// calls each reviewer made to rediscover the branch, its base, the commits and the diff (zero-token-audit round 2
// measured ~4 200 git diff/show/grep calls a week, mostly reviewers), each re-reading the whole context. The review stays
// independent (ADR 0091): only the repository's facts, never the parent's reasoning. Read-only git (no index lock).
// Used by ChatManager.create (opts.reviewPack); pinned by test/unit/agents/review-pack.test.ts.
import { execFile } from 'node:child_process';

/** the diff shown whole up to this; beyond it, the files and how to read each one */
export const DIFF_MAX = 12_000;
const TIMEOUT = 8000;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

/** The branch a change is measured against: the remote's default, else main or master. */
async function baseOf(cwd: string): Promise<{ name: string; sha: string } | null> {
  const remoteHead = (await git(cwd, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  for (const name of [remoteHead, 'origin/main', 'main', 'origin/master', 'master'].filter((x): x is string => !!x)) {
    const sha = (await git(cwd, ['merge-base', 'HEAD', name]))?.trim();
    if (sha) return { name, sha };
  }
  return null;
}

/** The pack for a chat starting in cwd, or '' when cwd is not a repository or nothing changed against its base. */
export async function reviewPack(cwd: string, max = DIFF_MAX): Promise<string> {
  const top = (await git(cwd, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return '';
  const branch = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? '?';
  const base = await baseOf(top);
  if (!base) return '';
  const [commits, stat, untracked, diff] = await Promise.all([
    git(top, ['log', '--oneline', '--no-decorate', '-n', '30', `${base.sha}..HEAD`]),
    git(top, ['diff', '--stat', '--stat-width=120', base.sha]),
    git(top, ['ls-files', '--others', '--exclude-standard']),
    git(top, ['diff', '-U3', base.sha]),
  ]);
  const files = (untracked ?? '').split('\n').filter(Boolean);
  if (!commits?.trim() && !stat?.trim() && !files.length) return '';
  const lines = [
    `[app · review pack, gathered with git (zero tokens): the change to check in ${top}]`,
    `Branch ${branch}, base ${base.name} at ${base.sha.slice(0, 10)}.`,
    commits?.trim() ? `Commits since the base:\n${commits.trim()}` : 'No commits since the base: the change is in the working tree.',
    stat?.trim() ? `Changed files (against the base, working tree included):\n${stat.trim()}` : '',
    files.length ? `Untracked files: ${files.slice(0, 40).join(', ')}${files.length > 40 ? ` (+${files.length - 40})` : ''}` : '',
  ].filter(Boolean);
  const d = diff ?? '';
  if (d && d.length <= max) lines.push(`The diff:\n\`\`\`diff\n${d.trimEnd()}\n\`\`\``);
  else if (d) lines.push(`The diff is ${d.length} characters: read it per file with \`git diff ${base.sha.slice(0, 10)} -- <file>\`.`);
  return lines.join('\n');
}
