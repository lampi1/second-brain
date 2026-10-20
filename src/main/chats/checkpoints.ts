// Per-turn file checkpoints (ADR 0103): before a chat's turn in a git repository the app records the working tree as it
// is (tracked and untracked files, .gitignore respected) in a commit object kept under refs/sb/checkpoints/<chat>/<n>,
// never on a branch: the user's index, HEAD and branches are untouched (a temporary index file, git commit-tree,
// git update-ref). "Annulla l'ultimo turno" puts the files back as they were before that turn: changed or deleted files
// are restored from the checkpoint, files the turn created are removed; ignored files (builds, node_modules) stay as
// they are. Why: agents run with the full default permissions (ADR 0085), and an undo is the safety net that needs no
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

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]}: ${String(stderr || error.message).trim().slice(0, 300)}`)); else resolve(String(stdout));
    });
  });
}

export interface Checkpoint { commit: string; at: number; root: string }

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

/** Records the working tree of the repository at cwd; null when cwd is no git work tree or git fails. */
export async function snapshot(cwd: string, ref: string): Promise<Checkpoint | null> {
  const root = await repoRoot(cwd);
  if (!root) return null;
  const tree = await worktreeTree(root);
  const head = await git(root, ['rev-parse', '-q', '--verify', 'HEAD']).then(s => s.trim(), () => '');
  const commit = (await git(root, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'second-brain checkpoint'], IDENTITY)).trim();
  await git(root, ['update-ref', ref, commit]);
  return { commit, at: Date.now(), root };
}

/** Deletes refs of this chat's checkpoints beyond the newest `keep`. */
export async function prune(root: string, prefix: string, keep = KEEP): Promise<void> {
  const refs = (await git(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', prefix])).split('\n').filter(Boolean);
  for (const ref of refs.slice(keep)) await git(root, ['update-ref', '-d', ref]).catch(() => {});
}

export interface UndoResult { restored: string[]; removed: string[] }

/** Puts the files back as the checkpoint recorded them: what changed or was deleted since is restored, what was created
 *  since is removed; ignored files stay. */
export async function restore(cp: Checkpoint): Promise<UndoResult> {
  const now = await worktreeTree(cp.root);
  const out = await git(cp.root, ['diff', '--name-status', '--no-renames', '-z', `${cp.commit}^{tree}`, now]);
  const parts = out.split('\0').filter(Boolean);
  const restored: string[] = [], removed: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!, file = parts[i + 1]!;
    if (status === 'A') removed.push(file); else restored.push(file);
  }
  for (const file of removed) {
    const abs = path.resolve(cp.root, file);
    if (!abs.startsWith(path.resolve(cp.root) + path.sep)) continue;
    fs.rmSync(abs, { force: true });
  }
  // chunks: a long list must not exceed the command line
  for (let i = 0; i < restored.length; i += 200) await git(cp.root, ['restore', `--source=${cp.commit}`, '--worktree', '--', ...restored.slice(i, i + 200)]);
  return { restored, removed };
}
