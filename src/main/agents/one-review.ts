// One review chat per piece of work (#387, ADR 0309). Reviews multiplied: a fresh Sentinel chat was opened for every
// commit or fix round (147 review chats out of 517 sessions in a week of the owner's use), and a written rule in the
// brain did not hold, so the app holds it. A piece of work keeps its review chat: after a fix the same chat reviews
// only the fix delta (app_assign_task / agent_assign_task), and a fresh one is opened only for other work, for a part
// no review chat covers, or when the user asks (`freshReview`). This file only finds the review chat a new one would
// duplicate; the tools refuse and name it (appctl/tools.ts app_create_chat, agents/delegation.ts agent_delegate).
// A review chat counts once it reported: reviewers of several parts started side by side are never in each other's way.
// Pure (no Electron, no I/O); pinned by test/unit/agents/one-review.test.ts.
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import type { ChatSummary, Harness } from '../../shared/contract';

/** the roles whose root chats give an independent verdict (run.reviewOf) */
export const REVIEW_ROLES: readonly string[] = ['sentinel', 'judge'];

export interface ReviewWorld {
  chats: readonly ChatSummary[];
  runs: readonly AgentRun[];
  /** the role's card as it is now: a chat started on another version or revision cannot take a new assignment */
  profile: (roleId: string) => { activeVersion: number; updatedAt: number } | undefined;
  /** the open work thread a chat is linked to (workflows/service.ts); absent or null = none */
  threadOf?: (chatId: string) => string | null;
}

/** what the app adds to a review chat's next assignment: only the delta, never the whole work again */
export const DELTA_REVIEW = 'Re-review (one review chat per piece of work): you already reviewed this work in this conversation. Review only what changed since your last review (the fix delta), and say for each of your earlier findings whether it is fixed. Do not review again what you already passed.';

const sameFolder = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);

/** The chat a review is about: the chat of the run it reviews (null = an unknown run). */
export function reviewedChat(runs: readonly AgentRun[], reviewOf: string | undefined): string | null {
  return reviewOf ? runs.find(r => r.runId === reviewOf)?.chatId ?? null : null;
}

/** The same piece of work: the same chat, or two chats linked to the same open work thread. */
export function sameWork(w: Pick<ReviewWorld, 'threadOf'>, a: string, b: string): boolean {
  if (a === b) return true;
  const t = w.threadOf?.(a) ?? null;
  return t !== null && t === (w.threadOf?.(b) ?? null);
}

/** A chat that can take another assignment of its role from `from` (what the assign tools would accept): the same
 *  role card and folder, not closed by the user, and an engine of another kind only while it is still up. */
function reusable(w: ReviewWorld, c: ChatSummary, role: string, cwd: string, from: Harness): boolean {
  if (c.isOrchestrator || c.agent?.source !== 'catalog' || c.agent.id !== role || (c.closedAt && c.closedBy === 'user')) return false;
  if (c.harness !== from && (c.closedAt || !['running', 'waiting', 'idle'].includes(c.state))) return false;
  const p = w.profile(role);
  return !!p && p.activeVersion === c.agent.version && p.updatedAt === c.agent.revision && sameFolder(c.cwd, cwd);
}

const newestFirst = (a: ChatSummary, b: ChatSummary): number => (b.run?.startedAt ?? 0) - (a.run?.startedAt ?? 0);

/** every run of a chat the world knows: the stored ones and the one on its summary (a run may have been pruned) */
function runsOf(w: ReviewWorld, c: ChatSummary): AgentRun[] {
  const own = w.runs.filter(r => r.chatId === c.id);
  return c.run && !own.some(r => r.runId === c.run!.runId) ? [...own, c.run] : own;
}

/** The root review chat that already reported on the work `reviewOf` belongs to (in any of its rounds, so one busy
 *  with a later round still counts): a new one for that work would be a duplicate. */
export function rootReviewer(w: ReviewWorld, a: { role: string; reviewOf: string; cwd: string; from: Harness }): ChatSummary | null {
  const target = reviewedChat(w.runs, a.reviewOf);
  if (!target || !REVIEW_ROLES.includes(a.role)) return null;
  const reviewed = (c: ChatSummary): boolean => runsOf(w, c).some(r => {
    const about = r.report ? reviewedChat(w.runs, r.reviewOf) : null;
    return !!about && sameWork(w, about, target);
  });
  return w.chats.filter(c => !c.parentId && c.id !== target && !!c.run?.reviewOf && reusable(w, c, a.role, a.cwd, a.from) && reviewed(c)).sort(newestFirst)[0] ?? null;
}

/** A parent's Sentinel children that already reported on its current task (in any of their rounds): a new Sentinel
 *  for that task would be a duplicate. */
export function childReviewers(w: ReviewWorld, parent: ChatSummary, cwd: string): ChatSummary[] {
  const task = parent.run?.taskId ?? parent.run?.runId;
  if (!task) return [];
  const taskOf = (runId: string | undefined): string | undefined => {
    const r = runId ? runId === parent.run!.runId ? parent.run : w.runs.find(x => x.runId === runId) : undefined;
    return r?.taskId ?? r?.runId;
  };
  const reported = (c: ChatSummary): boolean => runsOf(w, c).some(r => (!!r.report || r.runId === c.run?.runId && !!c.delegation?.result) && taskOf(r.parentRunId) === task);
  return w.chats.filter(c => c.parentId === parent.id && c.delegation?.role === 'sentinel' && reusable(w, c, 'sentinel', cwd, parent.harness) && reported(c)).sort(newestFirst);
}

/** Whether a review chat may be given this run to review: only the work it already reviews (the same chat or thread). */
export function reviewsSameWork(w: ReviewWorld, reviewer: ChatSummary, reviewOf: string): boolean {
  const now = reviewedChat(w.runs, reviewer.run?.reviewOf), next = reviewedChat(w.runs, reviewOf);
  return !!now && !!next && sameWork(w, now, next);
}

/** The run a review chat reviews next when none is named: the current run of the chat it reviews. */
export function nextReviewOf(w: ReviewWorld, reviewer: ChatSummary): string | null {
  const about = reviewedChat(w.runs, reviewer.run?.reviewOf);
  return about ? w.chats.find(c => c.id === about)?.run?.runId ?? reviewer.run!.reviewOf! : null;
}
