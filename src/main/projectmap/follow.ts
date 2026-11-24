// What a chat linked to a piece of a project map says about it (issue #456, ADR 0330). The owner (2026-11-20): «a chat
// was working on a map element but the map still showed it as "planned" … maps update themselves: when a chat linked
// to a map element starts, waits, finishes or fails, the element status moves automatically to work / blocked / ok».
// The app already holds all of it (zero tokens): the chat's state, its open requests, its sub-chats, its report.
// - sayOf: one chat → run (at work now, it or a chat it delegated) · redo / reask (at work again, or waiting for the
//   user, after it reported done: a message that followed, the end of the turn that reported, a closing question) ·
//   work (on it, between turns or with a partial report) · wait (it waits for the user: an open request, or its last answer says so) ·
//   held (its question is with an agent, ADR 0344: it waits for that one, not for the user) · fail (its turn ended on an
//   error) · stuck (it reported blocked) · done (it reported done, or, with no report to give, the app closed it after
//   a turn that ended well) · null (never started, stopped by the user, closed by hand: it says nothing).
// - wantOf: the chats linked to one piece → the status to save (work, blocked, ok: these change rarely) and what shows
//   only while it lasts (stuck on the user, on the agent that holds a question or on an error, under way again after a done report: never saved, so a
//   question or a message that follows does not write a version).
// Pure. Used by projectmap/service.ts; pinned by test/unit/projectmap-follow.test.ts.
import type { ChatSummary, PendingRequest } from '@shared/contract';
import type { MapActor } from '@shared/project-map';
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

export interface Want {
  /** the status to save on the piece; null = nothing to say */
  durable: 'work' | 'blocked' | 'ok' | null;
  /** shown only while it lasts: stuck on the user (a chat waits for him) or on an agent (every chat on it failed, or its
   *  question is with an agent) */
  live: { actor: MapActor } | null;
  /** a chat is at work on it right now: the app vouches for the status (never «da verificare» meanwhile) */
  running: boolean;
  /** shown only while it lasts: every chat on it reported done and one is at work again (the piece stays saved done;
   *  one that waits for the user after its done report shows through `live`) */
  redo: boolean;
}

/** What the chats linked to one piece say together. */
export function wantOf(says: readonly ChatSay[]): Want {
  if (!says.length) return { durable: null, live: null, running: false, redo: false };
  const has = (s: ChatSay) => says.includes(s);
  const open = has('run') || has('work') || has('wait') || has('held') || has('fail');
  return {
    durable: open ? 'work' : has('stuck') ? 'blocked' : 'ok',
    live: has('wait') || has('reask') ? { actor: 'user' } : (has('fail') || has('held')) && !has('run') && !has('redo') && !has('work') ? { actor: 'agent' } : null,
    running: has('run') || has('redo'),
    redo: has('redo') && !open && !has('stuck'),
  };
}
