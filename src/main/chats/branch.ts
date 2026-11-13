// The git branch of a chat's folder, read from disk only (no git process, no network): walks up from the folder to the
// first `.git`, follows a worktree's `.git` file ("gitdir: …") and reads HEAD ("ref: refs/heads/<branch>" → the
// branch; a detached HEAD → its short sha). Why: the "Stato" view shows which worktree branch each chat works on with
// zero tokens (owner, 2026-10-13: "a che punto siamo" ~8 times a day). Used by index.ts ('chat:branches').
import fs from 'node:fs';
import path from 'node:path';

const MAX_CWDS = 60;
const MAX_UP = 12;

function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** The branch checked out in `cwd` (or a parent of it); null when it is not in a git repository or HEAD is unreadable. */
export function gitBranch(cwd: string): string | null {
  // a network path (\\host\share) is never touched: a stat there would reach out and may hang the main process
  if (!cwd || !path.isAbsolute(cwd) || /^[\\/]{2}/.test(cwd)) return null;
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_UP; i++) {
    const dotGit = path.join(dir, '.git');
    let st: fs.Stats | null = null;
    try { st = fs.statSync(dotGit); } catch { st = null; }
    if (st) {
      let gitDir = dotGit;
      if (st.isFile()) {
        const m = readText(dotGit)?.match(/^gitdir:\s*(.+?)\s*$/m);
        if (!m) return null;
        gitDir = path.resolve(dir, m[1]!);
      }
      return headOf(readText(path.join(gitDir, 'HEAD')));
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** HEAD's text → the branch name, or a detached HEAD's short sha. */
export function headOf(head: string | null): string | null {
  const t = head?.trim();
  if (!t) return null;
  const ref = t.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (ref) return ref[1]!;
  return /^[0-9a-f]{40,64}$/i.test(t) ? t.slice(0, 7) : null;
}

/** Many folders at once (deduplicated, at most MAX_CWDS): folder → branch (null = none). */
export function gitBranches(cwds: unknown, read: (cwd: string) => string | null = gitBranch): Record<string, string | null> {
  const out = new Map<string, string | null>();
  if (!Array.isArray(cwds)) return {};
  for (const c of cwds) {
    if (typeof c !== 'string' || c.length > 1000 || out.has(c)) continue;
    if (out.size >= MAX_CWDS) break;
    out.set(c, read(c));
  }
  return Object.fromEntries(out);
}
