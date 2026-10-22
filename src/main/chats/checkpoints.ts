// Per-turn file checkpoints (ADR 0103): before a chat's turn in a git repository the app records the working tree as it
// is (tracked and untracked files, .gitignore respected) in a commit object kept under refs/sb/checkpoints/<chat>/<n>,
// never on a branch: the user's index, HEAD and branches are untouched (a temporary index file, git commit-tree,
// git update-ref). When the turn ends its files are recorded again (afterTree). "Annulla l'ultimo turno" puts back only
// what that turn changed: a path the turn changed, deleted or created goes back to the checkpoint, unless it changed
// again since the turn ended (the user's or another chat's later edit is never reverted); ignored files (builds,
// node_modules) and nested repositories stay as they are. Before it touches a file, the undo records the tree as it is
// under refs/sb/undo/<chat>/<time>, so an undo itself can be reverted with git. Why: agents run with the full default permissions (ADR 0085), and an undo is the safety net that needs no
// popup. Used by ChatManager (deliverNow before a turn, undoTurn); pinned by test/unit/chats/checkpoints.test.ts.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 15_000;
/** checkpoints kept per chat (older refs are deleted; their objects go with git's own gc) */
export const KEEP = 30;
/** the identity of a checkpoint commit: never pushed (it lives only under refs/sb/), so no real identity is needed */
const IDENTITY = { GIT_AUTHOR_NAME: 'second-brain', GIT_AUTHOR_EMAIL: 'checkpoint@localhost', GIT_COMMITTER_NAME: 'second-brain', GIT_COMMITTER_EMAIL: 'checkpoint@localhost' };

/** pathspecs read as literal file names: a name with * [ or :( is never a pattern */
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };
/** a nested repository in the tree (git add -A records it as one entry) */
const GITLINK = '160000';

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]}: ${String(stderr || error.message).trim().slice(0, 300)}`)); else resolve(String(stdout));
    });
  });
}

/** commit: the files before the turn; after: the tree when the turn ended (afterTree), absent while it runs or when
 *  that record failed */
export interface Checkpoint { commit: string; at: number; root: string; after?: string }

/** The repository's top folder for cwd, or null (not a git work tree). */
export async function repoRoot(cwd: string): Promise<string | null> {
  try { return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() || null; } catch { return null; }
}

/** The working tree as a tree object, through a copy of the real index (its stat cache keeps it fast); nothing of the
 *  user's changes. */
async function worktreeTree(root: string): Promise<string> {
  const real = path.resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).trim());
  const tmp = path.join(os.tmpdir(), `sb-cp-${crypto.randomBytes(6).toString('hex')}.index`);
  try {
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    await git(root, ['add', '-A', '--', '.'], env);
    return (await git(root, ['write-tree'], env)).trim();
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Records the working tree of the repository at cwd; null when cwd is no git work tree or git fails. `knownRoot`: the
 *  repository's top folder from an earlier checkpoint of the same chat (one git start less before each turn: every
 *  git call here runs between the user's Enter and the engine). */
export async function snapshot(cwd: string, ref: string, knownRoot?: string): Promise<Checkpoint | null> {
  const root = knownRoot && fs.existsSync(knownRoot) ? knownRoot : await repoRoot(cwd);
  if (!root) return null;
  const [tree, head] = await Promise.all([worktreeTree(root), git(root, ['rev-parse', '-q', '--verify', 'HEAD']).then(s => s.trim(), () => '')]);
  const commit = (await git(root, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'second-brain checkpoint'], IDENTITY)).trim();
  await git(root, ['update-ref', ref, commit]);
  return { commit, at: Date.now(), root };
}

/** The working tree's tree object when a turn ends (Checkpoint.after); null when git fails. */
export async function afterTree(root: string): Promise<string | null> {
  try { return await worktreeTree(root); } catch { return null; }
}

/** Deletes refs of this chat's checkpoints beyond the newest `keep`. */
export async function prune(root: string, prefix: string, keep = KEEP): Promise<void> {
  const refs = (await git(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', prefix])).split('\n').filter(Boolean);
  for (const ref of refs.slice(keep)) await git(root, ['update-ref', '-d', ref]).catch(() => {});
}

/** skipped: paths the turn changed that changed again since it ended, or nested repositories, left as they are */
export interface UndoResult { restored: string[]; removed: string[]; skipped: string[] }

/** The paths that differ between two trees, with what the second has: 'A' = only in the second; gitlink = a nested
 *  repository on either side. */
async function changes(root: string, from: string, to: string): Promise<{ file: string; status: string; gitlink: boolean }[]> {
  const out = await git(root, ['diff', '--raw', '--no-renames', '-z', from, to]);
  const parts = out.split('\0');
  const list: { file: string; status: string; gitlink: boolean }[] = [];
  // -z --raw: ":<old mode> <new mode> <old sha> <new sha> <status>" NUL "<path>" NUL
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!, file = parts[i + 1]!;
    if (!meta.startsWith(':') || !file) continue;
    const [oldMode, newMode, , , status] = meta.slice(1).split(' ');
    list.push({ file, status: (status ?? '').slice(0, 1), gitlink: oldMode === GITLINK || newMode === GITLINK });
  }
  return list;
}

/** Puts back what the checkpoint's turn changed (see the header): a file the turn created is removed, one it changed or
 *  deleted comes back; a path changed again since the turn ended is skipped. Without cp.after (the turn's end was not
 *  recorded) every change since the checkpoint counts. backupRef records the files as they are first. */
export async function restore(cp: Checkpoint, backupRef: string): Promise<UndoResult> {
  const now = await worktreeTree(cp.root);
  const backup = (await git(cp.root, ['commit-tree', now, '-p', cp.commit, '-m', 'second-brain undo backup'], IDENTITY)).trim();
  await git(cp.root, ['update-ref', backupRef, backup]);
  const before = `${cp.commit}^{tree}`;
  const turn = await changes(cp.root, before, cp.after ?? now);
  const since = cp.after ? new Set((await changes(cp.root, cp.after, now)).map(c => c.file)) : new Set<string>();
  const restored: string[] = [], removed: string[] = [], skipped: string[] = [];
  const top = path.resolve(cp.root) + path.sep;
  for (const c of turn) {
    if (c.gitlink || since.has(c.file)) { skipped.push(c.file); continue; }
    if (c.status !== 'A') { restored.push(c.file); continue; }
    const abs = path.resolve(cp.root, c.file);
    if (!abs.startsWith(top)) { skipped.push(c.file); continue; }
    let st: fs.Stats | null = null;
    try { st = fs.lstatSync(abs); } catch { /* already gone */ }
    if (st?.isDirectory()) { skipped.push(c.file); continue; }
    if (st) fs.rmSync(abs, { force: true });
    removed.push(c.file);
  }
  // chunks: a long list must not exceed the command line
  for (let i = 0; i < restored.length; i += 200) await git(cp.root, ['restore', `--source=${cp.commit}`, '--worktree', '--', ...restored.slice(i, i + 200)], LITERAL);
  return { restored, removed, skipped };
}
