// What a chat linked to a piece of a project map says about it (issue #456, ADR 0330). The owner (2026-11-20): «a chat
// was working on a map element but the map still showed it as "planned" … maps update themselves: when a chat linked
// to a map element starts, waits, finishes or fails, the element status moves automatically to work / blocked / ok».
// The app already holds all of it (zero tokens): the chat's state, its open requests, its sub-chats, its report.
// - sayOf: one chat → run (at work now, it or a chat it delegated) · work (on it, between turns or with a partial
//   report) · wait (it waits for the user: an open request, or its last answer says so) · fail (its turn ended on an
//   error) · stuck (it reported blocked) · done (it reported done, or, with no report to give, the app closed it after
//   a turn that ended well) · null (never started, stopped by the user, closed by hand: it says nothing).
// - wantOf: the chats linked to one piece → the status to save (work, blocked, ok: these change rarely) and what shows
//   only while it lasts (stuck on the user or on an error: never saved, so a question does not write a version).
// Pure. Used by projectmap/service.ts; pinned by test/unit/projectmap-follow.test.ts.
import type { ChatSummary, PendingRequest } from '@shared/contract';
import type { MapActor } from '@shared/project-map';

export type ChatSay = 'run' | 'work' | 'wait' | 'fail' | 'stuck' | 'done';

const ended = (c: ChatSummary) => !!c.closedAt || c.state === 'closed';
const busy = (c: ChatSummary) => c.state === 'running' || c.state === 'starting' || !!c.queued;

/** The chats a chat delegated, and theirs, still open. */
function below(c: ChatSummary, all: readonly ChatSummary[]): ChatSummary[] {
  const out: ChatSummary[] = [], ids = new Set([c.id]);
  for (let grew = true; grew;) { grew = false; for (const k of all) if (k.parentId && ids.has(k.parentId) && !ids.has(k.id)) { ids.add(k.id); if (!ended(k)) out.push(k); grew = true; } }
  return out;
}

/** The report of the work the chat does now: its run's (a role chat), else its delegation's. */
function reportOf(c: ChatSummary): 'done' | 'partial' | 'blocked' | undefined {
  const r = c.run?.report;
  if (r && r.at >= c.run!.startedAt) return r.outcome;
  const d = c.delegation?.result;
  return d && !d.noReport && d.at >= c.delegation!.at ? d.outcome : undefined;
}

export function sayOf(c: ChatSummary, all: readonly ChatSummary[], asks: readonly PendingRequest[]): ChatSay | null {
  if (!ended(c)) {
    const kids = below(c, all), mine = new Set([c.id, ...kids.map(k => k.id)]);
    // a delegated chat's question is its parent's to answer: the work waits either way
    if (asks.some(r => mine.has(r.chatId)) || c.state === 'waiting' || kids.some(k => k.state === 'waiting')) return 'wait';
    if (busy(c) || kids.some(busy) || (c.background ?? 0) > 0) return 'run';
    if (c.waitsOn === 'user') return 'wait';
  }
  if (c.state === 'error' || c.lastResult?.isError) return 'fail';
  const report = reportOf(c);
  if (report === 'blocked') return 'stuck';
  if (report === 'done') return 'done';
  if (report === 'partial') return 'work';
  if (c.lastResult?.interrupted) return null;
  // no report to give: finished = the app closed it after a turn that ended well; closed by hand = cancelled
  if (ended(c)) return c.closedBy !== 'user' && c.lastResult ? 'done' : null;
  return c.lastResult || c.waitsOnWork ? 'work' : null;
}

export interface Want {
  /** the status to save on the piece; null = nothing to say */
  durable: 'work' | 'blocked' | 'ok' | null;
  /** shown only while it lasts: stuck on the user (a chat waits for him) or on an agent (every chat on it failed) */
  live: { actor: MapActor } | null;
  /** a chat is at work on it right now: the app vouches for the status (never «da verificare» meanwhile) */
  running: boolean;
}

/** What the chats linked to one piece say together. */
export function wantOf(says: readonly ChatSay[]): Want {
  if (!says.length) return { durable: null, live: null, running: false };
  const has = (s: ChatSay) => says.includes(s);
  const open = has('run') || has('work') || has('wait') || has('fail');
  return {
    durable: open ? 'work' : has('stuck') ? 'blocked' : 'ok',
    live: has('wait') ? { actor: 'user' } : has('fail') && !has('run') && !has('work') ? { actor: 'agent' } : null,
    running: has('run'),
  };
}
