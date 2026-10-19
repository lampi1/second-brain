// The local checkout a cloud agent starts from (ADR 0080): its GitHub remote and the branch it works on, read with git
// (read-only, no network), and "Porta in locale", which fetches the agent's branch into a NEW worktree beside the repo.
// v1 is for GitHub repos only (owner default, ADR 0080 §2): an Azure DevOps or other remote is refused with the reason,
// since sending work code to a vendor's cloud is the owner's policy call. The app never pushes (AGENTS.md rule 8):
// a branch that is not on the remote is refused ("fai tu il push"); the cloud agent pushes only its own branches.
// Used by service.ts.
import path from 'node:path';
import type { Exec } from './exec';

export interface RepoInfo { repo: string; url: string; branch: string; root: string }

/** "owner/name" of a GitHub remote URL (https or ssh), or why not (Italian). */
export function githubRepo(remote: string): { repo: string; url: string } | { why: string } {
  const r = remote.trim();
  if (/dev\.azure\.com|visualstudio\.com/i.test(r)) return { why: 'repo su Azure DevOps: gli agenti cloud per ora lavorano solo su GitHub (mandare codice di lavoro al cloud di un fornitore è una scelta del proprietario, ADR 0080)' };
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(r);
  if (!m) return { why: 'il remoto non è su GitHub: gli agenti cloud per ora lavorano solo su repository GitHub' };
  return { repo: `${m[1]}/${m[2]}`, url: `https://github.com/${m[1]}/${m[2]}` };
}

/** The checkout's GitHub repo and current branch, which must be on the remote already (the app never pushes). */
export async function repoInfo(exec: Exec, cwd: string): Promise<RepoInfo | { why: string }> {
  if (!cwd || !(path.isAbsolute(cwd) || path.win32.isAbsolute(cwd))) return { why: 'scegli la cartella di un repository (percorso assoluto)' };
  const root = await exec('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 });
  if (root.code !== 0) return { why: 'la cartella non è un repository git' };
  const remote = await exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 });
  if (remote.code !== 0) return { why: 'il repository non ha un remoto «origin»' };
  const gh = githubRepo(remote.stdout);
  if ('why' in gh) return gh;
  const head = await exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000 });
  const branch = head.stdout.trim();
  if (head.code !== 0 || !branch || branch === 'HEAD') return { why: 'il repository non è su un branch (HEAD staccato)' };
  const pushed = await exec('git', ['-C', cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { timeoutMs: 10_000 });
  if (pushed.code !== 0) return { why: `il branch «${branch}» non è su GitHub: fai tu il push prima (l’app non fa push)` };
  return { ...gh, branch, root: root.stdout.trim() };
}

/** A branch name the agent pushed, safe as a git ref and a folder name. */
export const SAFE_BRANCH = /^(?:cursor|codex|claude)\/[A-Za-z0-9._/-]{1,120}$/;

/** The new worktree's folder: <parent>/<repo>-wt/cloud-<branch with / as ->. */
export const worktreeDir = (root: string, branch: string): string =>
  path.join(path.dirname(root), `${path.basename(root)}-wt`, `cloud-${branch.replace(/[^A-Za-z0-9._-]+/g, '-')}`.slice(0, 100));

/** git fetch of the agent's branch, then a new worktree on it; never touches the checkout itself (a dirty tree stays). */
export async function fetchIntoWorktree(exec: Exec, root: string, branch: string): Promise<{ worktree: string; branch: string }> {
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) throw new Error(`branch non valido: ${branch}`);
  const dir = worktreeDir(root, branch);
  const f = await exec('git', ['-C', root, 'fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: 120_000 });
  if (f.code !== 0) throw new Error(`git fetch non riuscito: ${f.stderr.trim().slice(0, 300) || 'errore'}`);
  const w = await exec('git', ['-C', root, 'worktree', 'add', '-b', branch, dir, `origin/${branch}`], { timeoutMs: 60_000 });
  if (w.code !== 0) throw new Error(`worktree non creato: ${w.stderr.trim().slice(0, 300) || 'errore'}`);
  return { worktree: dir, branch };
}

/** A fresh worktree on the checkout's HEAD for `codex apply` (the diff lands there, never in a dirty tree). */
export async function freshWorktree(exec: Exec, root: string, name: string): Promise<{ worktree: string; branch: string }> {
  const branch = `codex/${name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}`;
  const dir = worktreeDir(root, branch);
  const w = await exec('git', ['-C', root, 'worktree', 'add', '-b', branch, dir, 'HEAD'], { timeoutMs: 60_000 });
  if (w.code !== 0) throw new Error(`worktree non creato: ${w.stderr.trim().slice(0, 300) || 'errore'}`);
  return { worktree: dir, branch };
}
