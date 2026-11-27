// Per-turn file checkpoints (ADR 0103): before a chat's turn in a git repository the app records the working tree as it
// is (tracked and untracked files, .gitignore respected) in a commit object kept under refs/sb/checkpoints/<chat>/<n>,
// never on a branch: the user's index, HEAD and branches are untouched (a temporary index file, git commit-tree,
// git update-ref). When the turn ends its files are recorded again (afterTree). "Annulla l'ultimo turno" puts back only
// what that turn changed: a path the turn changed, deleted or created goes back to the checkpoint, unless it changed
// again since the turn ended (the user's or another chat's later edit is never reverted); ignored files (builds,
// node_modules) and nested repositories stay as they are. Before it touches a file, the undo records the tree as it is
// under refs/sb/undo/<chat>/<time>, so an undo itself can be reverted with git. Why: agents run with the full default permissions (ADR 0085), and an undo is the safety net that needs no
// popup. Before a turn a tree that matches HEAD has HEAD as its checkpoint after one git status (turnCheckpoint, ADR 0368).
// Used by ChatManager (deliverNow before a turn, undoTurn, and turnFiles for a run's receipts, ADR 0130); pinned
// by the e2e since its real-git unit tests were removed (docs/tests/load-sensitive-removed.md), and turnCheckpoint by
// test/unit/chats/turn-checkpoint.test.ts (git mocked).
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
export interface Checkpoint {
  commit: string; at: number; root: string; after?: string;
  /** A later turn was allowed to write before this end read finished: undo must preserve every current file. */
  afterUncertain?: true;
}

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

/** Records the working tree of the repository at cwd; null when cwd is no git work tree or git fails. The tree and
 *  HEAD are read together: every git call here runs between the user's Enter and the engine. */
export async function snapshot(cwd: string, ref: string, knownRoot?: string): Promise<Checkpoint | null> {
  const root = knownRoot ?? await repoRoot(cwd);
  if (!root) return null;
  const [tree, head] = await Promise.all([worktreeTree(root), git(root, ['rev-parse', '-q', '--verify', 'HEAD']).then(s => s.trim(), () => '')]);
  const commit = (await git(root, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'second-brain checkpoint'], IDENTITY)).trim();
  await git(root, ['update-ref', ref, commit]);
  return { commit, at: Date.now(), root };
}

/** What `git status --porcelain=v2 --branch -z` says (parseStatus): HEAD's commit (null before the first commit) and
 *  whether anything differs from it (a change, a staged file, an untracked file .gitignore does not hide). */
export interface WorktreeStatus { head: string | null; changed: boolean }

/** Pure, for the tests: the porcelain v2 output read as HEAD and «changed». Headers start with "# "; every other entry is
 *  a change. */
export function parseStatus(out: string): WorktreeStatus {
  let head: string | null = null, changed = false;
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    if (entry.startsWith('# ')) {
      const m = /^# branch\.oid ([0-9a-f]{40,64})$/.exec(entry);
      if (m) head = m[1]!;
      continue;
    }
    changed = true;
  }
  return { head, changed };
}

/** The pre-turn checkpoint with a cheap check first (ADR 0368): one `git status` (the files' stat cache, no hashing).
 *  Nothing differs from HEAD: HEAD itself is the checkpoint (its tree is the files as they are), its ref written in the
 *  background, so a turn on an engine that cannot hold its writes (every one but Claude) starts at once. Something
 *  changed (or no commit yet): the full snapshot, as before. `root`: the repository's top folder when already known (no
 *  rev-parse). Null when cwd is no git work tree or git fails. */
export async function turnCheckpoint(cwd: string, ref: string, root?: string | null): Promise<Checkpoint | null> {
  const top = root ?? await repoRoot(cwd);
  if (!top) return null;
  let status: WorktreeStatus;
  try { status = parseStatus(await git(top, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--ignore-submodules=dirty'])); }
  catch { return snapshot(top, ref, top); }
  if (status.changed || !status.head) return snapshot(top, ref, top);
  // the ref keeps the commit alive if the branch later moves away from it; prune() counts it like the others
  const head = status.head;
  void git(top, ['update-ref', ref, head]).catch(() => {});
  return { commit: head, at: Date.now(), root: top };
}

/** The working tree's tree object when a turn ends (Checkpoint.after); null when git fails. */
export async function afterTree(root: string): Promise<string | null> {
  try { return await worktreeTree(root); } catch { return null; }
}

/** Deletes refs of this chat's checkpoints beyond the newest `keep`. Newest by the checkpoint's own time, the ref's last
 *  segment (`…/<Date.now()>`): a clean tree's checkpoint is HEAD (turnCheckpoint), whose commit date may be days old, so
 *  git's creatordate would put the newest checkpoints first in line for deletion (ADR 0368). */
export async function prune(root: string, prefix: string, keep = KEEP): Promise<void> {
  const refs = (await git(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', prefix])).split('\n').filter(Boolean);
  for (const ref of byCheckpointTime(refs).slice(keep)) await git(root, ['update-ref', '-d', ref]).catch(() => {});
}

/** Pure, for the tests: refs newest first by their numeric last segment; a ref without one keeps git's order, last. */
export function byCheckpointTime(refs: readonly string[]): string[] {
  const at = (ref: string): number => { const n = Number(ref.slice(ref.lastIndexOf('/') + 1)); return Number.isFinite(n) && n > 0 ? n : -1; };
  return refs.map((ref, i) => ({ ref, i, t: at(ref) })).sort((a, b) => b.t - a.t || a.i - b.i).map(x => x.ref);
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

/** The repo-relative paths a checkpoint's turn changed, created or deleted (cp.after must be recorded): the run's
 *  receipts (agents/receipts.ts, ADR 0130). */
export async function turnFiles(cp: Checkpoint): Promise<string[]> {
  if (!cp.after) throw new Error('the turn end is not recorded');
  return (await changes(cp.root, `${cp.commit}^{tree}`, cp.after)).map(c => c.file);
}

/** The repo-relative paths that differ between two recorded trees of the repository at root (a follow-up turn's files:
 *  the previous turn's end against its own end, ADR 0282). */
export async function treeFiles(root: string, from: string, to: string): Promise<string[]> {
  return from === to ? [] : (await changes(root, from, to)).map(c => c.file);
}

/** Puts back what the checkpoint's turn changed (see the header): a file the turn created is removed, one it changed or
 *  deleted comes back; a path changed again since the turn ended is skipped. Without cp.after (the turn's end was not
 *  recorded) every change since the checkpoint counts. backupRef records the files as they are first. */
export async function restore(cp: Checkpoint, backupRef: string): Promise<UndoResult> {
  const now = await worktreeTree(cp.root);
  const backup = (await git(cp.root, ['commit-tree', now, '-p', cp.commit, '-m', 'second-brain undo backup'], IDENTITY)).trim();
  await git(cp.root, ['update-ref', backupRef, backup]);
  const before = `${cp.commit}^{tree}`;
  // A timed-out barrier let a later turn write during this checkpoint's end read. Neither the late tree nor the
  // missing-end fallback can identify this turn's changes safely; retain the backup but never restore those files.
  if (cp.afterUncertain) return { restored: [], removed: [], skipped: (await changes(cp.root, before, now)).map(c => c.file) };
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
