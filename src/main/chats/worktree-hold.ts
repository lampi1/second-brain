// The auto-close's check of a finished chat's git work (#357): a chat that left uncommitted changes, or commits that
// are on no remote branch, in the repository it worked in is not closed by itself, and its tile says why («Lavoro non
// salvato»). Why: an automatic close has no user in the loop; the worktree stays on disk, but the work silently leaves
// the user's view with the chat. Checked chats: the ones working in an app worktree (.second-brain-delegate-*), and the
// ones the app took a git checkpoint for (ADR 0103: their turns could write in a repository). Only repositories with a
// remote are checked: a local-only repository (the brain) has nothing to push, and its app-written notes change at
// any moment. The check runs git asynchronously (never on the window's thread, #336), one chat at a time, cached per
// chat by its activity stamp; while a chat is held it is checked again every RECHECK_MS, so a commit and a push made
// elsewhere release it. A git command that fails keeps the chat open (fail closed) and logs one warning with a hint.
// Pure but for the injected git; used by wiring.ts (the auto-close's external hold), pinned by
// test/unit/chats/worktree-hold.test.ts.
import path from 'node:path';
import { errText, log } from '../log';

export type WorkState = 'clean' | 'unsaved' | 'checking' | 'failed' | 'none';
export interface GitRun { exit: number | null; out: string; error?: string }
export interface WorkChat { id: string; cwd: string; stamp: string; checkpointAt?: number }

/** an app worktree's folder name (agents/worktree-pool.ts APP_DIR) */
const APP_DIR = /^\.second-brain-(?:delegate|integration)-[A-Za-z0-9]{6}$/;
/** a held or failed chat is checked again this often, so work saved elsewhere releases it */
export const RECHECK_MS = 60_000;

interface Entry { stamp: string; state: WorkState; at: number; detail?: string }

export class WorktreeHold {
  private readonly cache = new Map<string, Entry>();
  private readonly queue: WorkChat[] = [];
  private running = false;

  constructor(private readonly d: { git: (cwd: string, args: string[]) => Promise<GitRun>; now?: () => number; changed?: (chatId: string) => void }) {}

  /** Whether the chat's work is a candidate for the check at all. */
  static checked(c: Pick<WorkChat, 'cwd' | 'checkpointAt'>): boolean {
    return !!c.cwd && path.isAbsolute(c.cwd) && (APP_DIR.test(path.basename(c.cwd)) || typeof c.checkpointAt === 'number');
  }

  /** The chat's last known state, at once; an unknown or outdated one is checked in the background ('checking' until
   *  then: the chat waits, never closes on a guess). */
  state(c: WorkChat): WorkState {
    if (!WorktreeHold.checked(c)) return 'none';
    const now = this.now(), e = this.cache.get(c.id);
    const stale = !e || e.stamp !== c.stamp || ((e.state === 'unsaved' || e.state === 'failed') && now - e.at >= RECHECK_MS);
    if (stale) this.enqueue(c);
    if (!e || e.stamp !== c.stamp) return 'checking';
    return e.state;
  }

  /** What a held chat left (for its tile and the log), null when nothing. */
  detail(chatId: string): string | null { return this.cache.get(chatId)?.detail ?? null; }

  /** A closed chat leaves the cache. */
  forget(chatId: string): void { this.cache.delete(chatId); }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  private enqueue(c: WorkChat): void {
    if (this.queue.some(q => q.id === c.id && q.stamp === c.stamp)) return;
    const i = this.queue.findIndex(q => q.id === c.id);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.push(c);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let c = this.queue.shift(); c; c = this.queue.shift()) {
        const before = this.cache.get(c.id)?.state;
        const e = await this.check(c);
        this.cache.set(c.id, e);
        if (e.state !== before) this.d.changed?.(c.id);
      }
    } finally { this.running = false; }
  }

  /** git status + commits on no remote, in the chat's repository. */
  async check(c: WorkChat): Promise<Entry> {
    const at = this.now(), base = { stamp: c.stamp, at };
    try {
      const top = await this.d.git(c.cwd, ['rev-parse', '--show-toplevel']);
      // not (or no longer) a repository: nothing to save there
      if (top.exit !== 0) return { ...base, state: 'clean' };
      const remotes = await this.d.git(c.cwd, ['remote']);
      if (remotes.exit !== 0) throw new Error(remotes.error ?? 'git remote failed');
      if (!remotes.out.trim()) return { ...base, state: 'clean' };
      const st = await this.d.git(c.cwd, ['status', '--porcelain=v1', '--untracked-files=normal']);
      if (st.exit !== 0) throw new Error(st.error ?? 'git status failed');
      const changed = st.out.split(/\r?\n/).filter(l => l.trim()).length;
      const ahead = await this.d.git(c.cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
      // a repository with no commit yet has no HEAD: its files are the changes above
      const unpushed = ahead.exit === 0 ? Number(ahead.out.trim()) || 0 : 0;
      if (!changed && !unpushed) return { ...base, state: 'clean' };
      const detail = [changed ? `${changed} file non salvati` : '', unpushed ? `${unpushed} commit non pushati` : ''].filter(Boolean).join(', ');
      log.info('chats', 'auto-close held: unsaved work in the worktree', { chat: c.id, data: { cwd: c.cwd, changed, unpushed } });
      return { ...base, state: 'unsaved', detail };
    } catch (e) {
      if (this.cache.get(c.id)?.state !== 'failed') {
        log.warn('chats', 'worktree check failed: the chat stays open', { chat: c.id, cause: errText(e), data: { cwd: c.cwd }, hint: 'check that the folder still exists and git works there; the chat closes once the check passes' });
      }
      return { ...base, state: 'failed' };
    }
  }
}
