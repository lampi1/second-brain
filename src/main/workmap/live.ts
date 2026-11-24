// What the chats of a work map are doing now (ADR 0342, live status; the owner, 2026-11-23: «le mappe devono sempre essere
// aggiornate sullo stato»). The app reads it from the chats it already holds (state, open requests, last turn, report,
// who delegated whom), with no agent call: which chat works, which waits and for whom, which failed, reported, was closed
// without a report or is not there any more. Nothing is guessed: what no chat vouches for is 'unknown', and it is stale
// with the time of its last confirmation. Nothing here is saved as a version of the map.
// - readingOf: one chat alone, on top of projectmap/follow.ts sayOf (the project maps' reading of a chat).
// - liveOf: a whole map: each step from its chats and the chats these delegated (a step with no chat, or whose chats all
//   reported, from the owner chat), then the map's row from its owner and its open steps.
// - asksOf: the questions the chats of a map asked, with who holds or answered each (ADR 0344).
// Pure. Used by workmap/service.ts; the types are in shared/work-map.ts; pinned by test/unit/workmap-live.test.ts.
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { heldOnly, openQuestions, type LadderQuestion } from '@shared/question-ladder';
import { drawingOf, waitsOnUser, WORK_SAYS, type WorkAsk, type WorkBox, type WorkBoxLive, type WorkMap, type WorkMapLive, type WorkSay, type WorkStopWhy, type WorkWaitFor, type WorkWorker } from '@shared/work-map';
import { reportOf, sayOf } from '../projectmap/follow';

/** A chat that ended its turn with no report is taken at its word this long; then nobody vouches for its step. */
export const STALE_MS = 2 * 3600_000;

export interface Reading { say: WorkSay; waits?: WorkWaitFor }

const isBusy = (c: ChatSummary): boolean => c.state === 'running' || c.state === 'starting' || !!c.queued || (c.background ?? 0) > 0;

/** What one chat is doing, its own sub-chats left out; no chat = it is not in the app any more. */
export function readingOf(c: ChatSummary | undefined, asks: readonly PendingRequest[]): Reading {
  if (!c) return { say: 'gone' };
  const report = reportOf(c)?.outcome;
  if (c.closedAt) return { say: report ?? 'closed' };
  // out of credits (ADR 0346): no failure, it waits for the user to change its role's card; a new turn ends the wait
  if (c.creditWait && !isBusy(c)) return { say: 'waiting', waits: 'credits' };
  const said = sayOf(c, [], asks);
  if (said === 'wait' || said === 'reask' || c.pending > 0 || openQuestions(c.questions).some(q => q.level === 'user')) return { say: 'waiting', waits: 'user' };
  // its question is with an agent (ADR 0344): it waits for that one, and not for the user until it reaches him
  const held = said === 'held' ? heldOnly(c)[0] : undefined;
  if (held) return { say: 'waiting', waits: held.level === 'orchestrator' ? 'orchestrator' : 'parent' };
  if (said === 'run' || said === 'redo' || isBusy(c)) return { say: 'working' };
  if (said === 'fail') return { say: 'failed' };
  if (report) return { say: report };
  // its last answer says so, and it is kept over a restart
  if (c.waitsOn) return { say: 'waiting', waits: c.waitsOn };
  if (c.lastResult?.interrupted) return { say: 'interrupted' };
  if (c.waitsOnWork) return { say: 'waiting', waits: 'work' };
  // its engine is not there and this run of the app saw no turn of it end: after a restart
  if (c.state === 'closed' && !c.lastResult) return { say: 'unknown' };
  return { say: 'between' };
}

/** An order where the first is what to show. Who waits for the user or failed comes before who works; what a chat below a
 *  step's chat says counts only while it works or waits for the user, or when nobody works. */
function rank(w: WorkWorker): number {
  if (w.say === 'waiting' && waitsOnUser(w.waits)) return 0;
  if (w.say === 'working') return 5;
  if (w.below) return 20 + WORK_SAYS.indexOf(w.say);
  if (w.say === 'waiting') return w.waits === 'work' ? 6 : 4;
  return { failed: 1, closed: 2, gone: 3, blocked: 7, interrupted: 8, unknown: 9, between: 10, partial: 11, done: 12 }[w.say];
}
const byRank = (a: WorkWorker, b: WorkWorker): number => rank(a) - rank(b) || a.chatId.localeCompare(b.chatId);
/** somebody is on it, or the app knows who must move: it is what it says */
const VOUCHED: ReadonlySet<WorkSay> = new Set(['working', 'waiting', 'failed', 'interrupted', 'closed', 'gone', 'blocked']);

export interface LiveInput {
  chats: readonly ChatSummary[];
  asks: readonly PendingRequest[];
  now: number;
  /** when the app last saw this chat be what it is (kept over a restart); undefined = never */
  confirmed(chatId: string): number | undefined;
  /** the owner chat's engine died and did not come back */
  crashed: boolean;
  /** who closed an owner chat by hand, when that was seen: it may not be in the app any more */
  removedBy?: 'user' | 'agent';
}

/** The chats of the app, ready to be read: by id, and the open ones below each. */
function index(chats: readonly ChatSummary[]): { byId: Map<string, ChatSummary>; below(id: string): ChatSummary[] } {
  const byId = new Map(chats.map(c => [c.id, c])), kids = new Map<string, ChatSummary[]>();
  for (const c of chats) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  const below = (id: string): ChatSummary[] => {
    const out: ChatSummary[] = [], seen = new Set([id]);
    for (let q = [id]; q.length;) {
      const next = q.flatMap(x => kids.get(x) ?? []).filter(k => !seen.has(k.id));
      for (const k of next) { seen.add(k.id); if (!k.closedAt) out.push(k); }
      q = next.map(k => k.id);
    }
    return out;
  };
  return { byId, below };
}

/** Whether chats are at work for a chat, or wait for the user: their end goes on by itself, the chat above is not dead. */
export function movesBelow(chatId: string, chats: readonly ChatSummary[], asks: readonly PendingRequest[]): boolean {
  return index(chats).below(chatId).some(c => { const s = readingOf(c, asks).say; return s === 'working' || s === 'waiting'; });
}

/** How many questions a map shows. */
const ASKS_CAP = 40;
/** The questions of the chats of a map, the closed chats included: of a step's chats and of all below them, every one; of the
 *  owner and of what it delegated outside the steps, those of this job's time. The open ones first (the user's on top), then
 *  the answered ones, the newest first. */
export function asksOf(m: WorkMap, chats: readonly ChatSummary[]): WorkAsk[] {
  const byId = new Map(chats.map(c => [c.id, c])), kids = new Map<string, ChatSummary[]>(), step = new Map<string, number>();
  for (const c of chats) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  for (const b of drawingOf(m).boxes) for (const id of b.chatIds) if (id !== m.owner?.chatId && !step.has(id)) step.set(id, b.n);
  const out: WorkAsk[] = [], seen = new Set<string>();
  const take = (id: string, n: number | undefined, inTime: boolean): void => {
    // a step's chat is its step's, wherever it hangs
    if (seen.has(id) || n === undefined && step.has(id)) return;
    seen.add(id);
    const c = byId.get(id), ok = (q: LadderQuestion): boolean => !inTime || q.at >= m.createdAt && q.at <= (m.finishedAt ?? Infinity);
    for (const q of c?.questions ?? []) if (ok(q)) out.push({ chatId: id, title: c!.title, ...(n ? { n } : {}), question: q });
    for (const k of kids.get(id) ?? []) take(k.id, n, inTime);
  };
  for (const [id, n] of step) take(id, n, false);
  if (m.owner && m.stopped?.by !== 'replaced') take(m.owner.chatId, undefined, true);
  const rank = (a: WorkAsk): number => a.question.answered ? 2 : a.question.level === 'user' ? 0 : 1;
  const when = (a: WorkAsk): number => a.question.answered?.at ?? a.question.at;
  return out.sort((a, b) => rank(a) - rank(b) || when(b) - when(a) || a.question.id.localeCompare(b.question.id)).slice(0, ASKS_CAP);
}

function whyStopped(m: WorkMap, owner: ChatSummary | undefined, i: LiveInput): WorkStopWhy | undefined {
  if (m.state !== 'stopped' || !m.stopped) return undefined;
  if (m.stopped.by === 'user' || m.stopped.by === 'replaced') return m.stopped.by;
  if (owner?.closedAt) return owner.closedBy === 'user' ? 'closedByUser' : 'closedByApp';
  if (owner) return i.crashed ? 'crash' : 'closedByApp';
  return i.removedBy === 'user' ? 'closedByUser' : i.removedBy === 'agent' ? 'closedByAgent' : 'gone';
}

/** The live status of a map: one entry per box (undefined = nothing to say beyond its state), and the map's row. */
export function liveOf(m: WorkMap, i: LiveInput): { boxes: (WorkBoxLive | undefined)[]; map: WorkMapLive | undefined } {
  const { byId, below } = index(i.chats), ownerId = m.owner?.chatId, drawn = drawingOf(m).boxes;
  const worker = (id: string, n: number | undefined, deep: boolean): WorkWorker => {
    const c = byId.get(id);
    return { chatId: id, title: c?.title ?? '', ...readingOf(c, i.asks), ...(n ? { n } : {}), ...(deep ? { below: true as const } : {}) };
  };
  // the owner chat may be on another job by now: it says nothing about this one
  const owner = ownerId && m.stopped?.by !== 'replaced' ? worker(ownerId, undefined, false) : undefined;
  const at = (id: string): number => Math.max(i.confirmed(id) ?? 0, byId.get(id)?.lastResult?.at ?? 0);
  /** the time of the last confirmation, when nobody vouches for these chats now */
  const staleOf = (chats: readonly WorkWorker[], since: number): number | undefined => {
    if (chats.some(w => VOUCHED.has(w.say))) return undefined;
    const owing = chats.filter(w => w.say === 'unknown' || w.say === 'between');
    const last = Math.max(0, ...owing.map(w => at(w.chatId))) || since;
    if (owing.some(w => w.say === 'unknown')) return last;
    return owing.length && i.now - last > STALE_MS ? last : undefined;
  };
  const open = m.state === 'running' || m.state === 'idea' && !!m.owner;

  const boxes = drawn.map((b): WorkBoxLive | undefined => {
    const seen = new Set<string>(), all: WorkWorker[] = [];
    for (const id of b.chatIds) if (id !== ownerId && !seen.has(id)) { seen.add(id); all.push(worker(id, b.n, false)); }
    for (const id of [...seen]) for (const k of below(id)) if (!seen.has(k.id)) { seen.add(k.id); all.push(worker(k.id, b.n, true)); }
    // the Strategist's own step, or one whose chats gave their reports and that it carries on
    const its = b.state === 'now' && owner && all.every(w => w.say === 'done' || w.say === 'partial');
    const read = (its ? [...all, owner] : all).sort(byRank);
    const moving = read.some(w => w.say === 'working' || w.say === 'waiting');
    if (!read.length || !moving && (b.state === 'done' || b.state === 'todo')) return undefined;
    const head = its ? [owner, ...all].sort(byRank)[0]! : read[0]!;
    const stale = b.state === 'now' && (m.state === 'running' || m.state === 'toApprove') ? staleOf(its ? [owner] : read, b.startedAt ?? m.updatedAt) : undefined;
    return { say: head.say, ...(head.waits ? { waits: head.waits } : {}), chats: read, ...(stale !== undefined ? { stale } : {}) };
  });

  const chats = new Map<string, WorkWorker>(), lost: WorkWorker[] = [];
  if (owner && m.state !== 'finished' && m.state !== 'archived') chats.set(owner.chatId, owner);
  else if (owner && (owner.say === 'working' || owner.say === 'waiting')) chats.set(owner.chatId, owner);
  boxes.forEach((l, k) => {
    const b: WorkBox = drawn[k]!;
    for (const w of l?.chats ?? []) {
      if (!chats.has(w.chatId)) chats.set(w.chatId, w);
      if (w.chatId !== ownerId && !w.below && (b.state === 'now' || b.state === 'blocked') && (w.say === 'closed' || w.say === 'gone')) lost.push(w);
    }
  });
  // a chat it delegated outside the plan's steps works for the job too
  for (const c of ownerId && owner ? below(ownerId) : []) if (!chats.has(c.id)) { const w = worker(c.id, undefined, true); if (w.say === 'working' || w.say === 'waiting' && waitsOnUser(w.waits)) chats.set(c.id, w); }
  const all = [...chats.values()].sort(byRank);
  const failed = all.filter(w => w.say === 'failed'), working = all.filter(w => w.say === 'working'), waiting = all.filter(w => w.say === 'waiting');
  const why = whyStopped(m, ownerId ? byId.get(ownerId) : undefined, i);

  let say: WorkWorker | undefined, stale: number | undefined;
  if (open && owner) {
    const steps = boxes.flatMap((l, k) => (l && drawn[k]!.state === 'now' ? l.chats : []));
    // a chat lost or failed under one step does not hide who works on another: the row says who works, the counts the rest
    say = [...waiting.filter(w => waitsOnUser(w.waits)), ...working, ...[owner, ...steps].sort(byRank)][0];
    if (!working.length && !waiting.length && !failed.length) {
      const now = boxes.flatMap((l, k) => (l && drawn[k]!.state === 'now' ? [l] : []));
      const old = now.flatMap(l => (l.stale !== undefined ? [l.stale] : []));
      stale = old.length ? Math.min(...old) : now.length ? undefined : staleOf([owner], m.updatedAt);
    }
  }
  if (!say && !working.length && !waiting.length && !failed.length && !lost.length && why === undefined) return { boxes, map: undefined };
  return { boxes, map: { ...(say ? { say: say.say } : {}), ...(say?.waits ? { waits: say.waits } : {}), working, waiting, failed, lost, ...(stale !== undefined ? { stale } : {}), ...(why ? { why } : {}) } };
}
