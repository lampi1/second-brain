// What a chat of a plan says now (ADR 0330 for the reading, ADR 0359): the app already holds all of it, at no token cost: the chat's state,
// its open requests, its sub-chats, its report. sayOf: one chat → run (at work now, it or a chat it delegated) · redo / reask (at
// work again, or waiting for the user, after it reported done) · work (between turns or with a partial report) · wait (it waits for
// the user: an open request, or its last answer says so) · held (its question is with an agent, ADR 0344) · fail (its turn ended on an
// error) · stuck (it reported blocked) · done (it reported done, or the app closed it after a turn that ended well) · null (never
// started, stopped by the user, closed by hand: it says nothing). reportOf: the report of the work it does now. Pure. Used by
// plans/live.ts; pinned by test/unit/plans/chat-say.test.ts.
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { heldOnly } from '@shared/question-ladder';

export type ChatSay = 'run' | 'redo' | 'reask' | 'work' | 'wait' | 'held' | 'fail' | 'stuck' | 'done';

const ended = (c: ChatSummary) => !!c.closedAt || c.state === 'closed';
const busy = (c: ChatSummary) => c.state === 'running' || c.state === 'starting' || !!c.queued;
/** It stands still on a question an agent holds: the engine's own call is open, or it ended its turn after asking. */
const held = (c: ChatSummary) => { const qs = heldOnly(c); return qs.some(q => q.via === 'request') || qs.length > 0 && !busy(c) && !((c.background ?? 0) > 0); };
/** It waits for the user: never on a question still with an agent. */
const waits = (c: ChatSummary) => c.state === 'waiting' && !heldOnly(c).length;

/** The chats a chat delegated, and theirs, still open. */
function below(c: ChatSummary, all: readonly ChatSummary[]): ChatSummary[] {
  const out: ChatSummary[] = [], ids = new Set([c.id]);
  for (let grew = true; grew;) { grew = false; for (const k of all) if (k.parentId && ids.has(k.parentId) && !ids.has(k.id)) { ids.add(k.id); if (!ended(k)) out.push(k); grew = true; } }
  return out;
}

/** The report of the work the chat does now: its run's (a role chat), else its delegation's; when it was given. */
export function reportOf(c: ChatSummary): { outcome: 'done' | 'partial' | 'blocked'; at: number } | undefined {
  const r = c.run?.report;
  if (r && r.at >= c.run!.startedAt) return { outcome: r.outcome, at: r.at };
  const d = c.delegation?.result;
  return d && !d.noReport && d.at >= c.delegation!.at ? { outcome: d.outcome, at: d.at } : undefined;
}

/** `since` = when the chat was linked to the piece it speaks for: a report it gave before is about something else. */
export function sayOf(c: ChatSummary, all: readonly ChatSummary[], asks: readonly PendingRequest[], since = 0): ChatSay | null {
  const given = reportOf(c), old = !!given && given.at < since, report = old ? undefined : given?.outcome;
  if (!ended(c)) {
    const kids = below(c, all), mine = new Set([c.id, ...kids.map(k => k.id)]);
    if (asks.some(r => mine.has(r.chatId)) || waits(c) || kids.some(waits)) return report === 'done' ? 'reask' : 'wait';
    if (held(c)) return 'held';
    if (busy(c) || kids.some(k => busy(k) && !held(k)) || (c.background ?? 0) > 0) return report === 'done' ? 'redo' : 'run';
    if (kids.some(held)) return 'held';
    if (c.waitsOn === 'user') return report === 'done' ? 'reask' : 'wait';
  }
  // out of credits (ADR 0346): not a failure, the piece is stuck on the user (he changes the role's card)
  if (c.creditWait && !ended(c)) return report === 'done' ? 'reask' : 'wait';
  if (c.state === 'error' || c.lastResult?.isError) return 'fail';
  if (report === 'blocked') return 'stuck';
  if (report === 'done') return 'done';
  if (report === 'partial') return 'work';
  if (c.lastResult?.interrupted) return null;
  // linked after its report: on the piece once a turn ended after the link, and it says nothing until then (a
  // finished chat linked afterwards writes nothing: whoever links it sets the status)
  if (old) return !ended(c) && c.lastResult && c.lastResult.at >= since ? 'work' : null;
  // no report to give: finished = the app closed it after a turn that ended well; closed by hand = cancelled
  if (ended(c)) return c.closedBy !== 'user' && c.lastResult ? 'done' : null;
  return c.lastResult || c.waitsOnWork ? 'work' : null;
}
