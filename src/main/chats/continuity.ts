// "Continuità": how a chat goes on past its context, in ONE place (audit 2026-10-15 #6: three mechanisms in three files
// with their own rules confused a newcomer). A long context costs at every step (the whole history is re-read), so a
// chat goes on in one of three ways, all keeping what the work needs (state, files, decisions, what runs in the
// background, the next step):
// - compact: the same session summarises itself. Every Claude chat at its window (compactWindowTokens, ADR 0031/0051:
//   the CLI does it); an Orchestrator also once on a new day (orchestratorDayDue, ADR 0051), so its mail queue and work chats stay put;
// - fresh session: a long idle Claude work chat writes a note while its cache is warm (coldAsk), and a message after
//   the cache expired goes on in a new session of the same chat from that note (coldRoute, coldPrompt; ADR 0031);
// - new chat: the user's "Riprendi" asks a hand-off note and opens a new chat from it (handoff.ts; ADR 0014).
// The note itself (format, request, store) lives in handoff.ts. Every automatic step runs only on a quiet chat
// (quietChat: idle, nothing pending, not working, its engine alive, not in a hand-off). The manager's minute sweep
// (manager.ts coldTick) asks continuityStep which one is due. Tests: test/unit/chats/cold.test.ts, orchestrator-day.test.ts.

/** the prompt cache lives 1 h from its last use: past this a message re-writes the whole context */
export const CACHE_TTL_MS = 55 * 60_000;
/** below this a cold re-write costs less than a hand-off and a fresh start */
export const COLD_MIN_TOKENS = 100_000;
/** calls counted as "after" a continuation or a compaction (ADR 0031 counters) */
export const AFTER_CALLS = 5;
/** below this context an Orchestrator's day compaction saves too little for the detail it loses */
export const ORCHESTRATOR_DAY_MIN = 50_000;
/** idle this long first: never between two messages of a conversation the user is having with the Orchestrator */
export const ORCHESTRATOR_DAY_IDLE_MS = 3 * 60_000;

/** What an Orchestrator's day summary keeps (Claude Code's `/compact <instructions>`). Injected prompts use English. */
export const ORCHESTRATOR_COMPACT = '/compact New day: keep only what is needed to continue. Keep the chats you coordinate (title, progress, what you await from each), outstanding messages and questions for the user, their decisions and preferences from today and yesterday that still apply, background work and how to resume it. Remove the rest. Continue answering in the user\'s language.';

/** What the continuity rules look at in a chat. noteAt = its cold note (0 = none); lastCallAt = its last API call. */
export interface ColdView {
  harness: string; isOrchestrator: boolean; continuedBy?: unknown;
  state: string; pending: number; background: number; busy: boolean; alive: boolean; handoffTurn: boolean;
  contextTokens: number; lastTurnAt: number; noteAt: number; lastCallAt: number;
  /** the lastTurnAt the note was already asked for (once per idle stretch, even if it failed) */
  askedFor?: number | undefined;
}

/** An Orchestrator's view: when its context in force began and the Rome day it was last asked to compact. */
export interface OrchestratorDayView {
  harness: string; isOrchestrator: boolean; state: string;
  pending: number; busy: boolean; alive: boolean; handoffTurn: boolean;
  contextTokens: number; lastTurnAt: number;
  /** when the context in force began: the first turn since the session started or the last compaction */
  ctxSince: number | undefined;
  /** the Rome day this Orchestrator was last asked to compact (once a day, even when it failed) */
  askedOn: string | undefined;
}

/** No automatic step ever runs on a chat that is not quiet: idle, nothing pending, not working, engine alive, not in a
 *  hand-off turn. */
export const quietChat = (v: Pick<ColdView, 'state' | 'pending' | 'busy' | 'alive' | 'handoffTurn'>): boolean =>
  v.state === 'idle' && v.pending === 0 && !v.busy && v.alive && !v.handoffTurn;

const isOrchestrator = (v: { isOrchestrator: boolean }): boolean => v.isOrchestrator;
const coldChat = (v: Pick<ColdView, 'harness' | 'isOrchestrator' | 'continuedBy'>): boolean => v.harness === 'claude' && !isOrchestrator(v) && !v.continuedBy;

/** Ask for the note now: quiet, a long context, no fresh note, and the cache still warm but about to expire (idleMs
 *  after the last call, before CACHE_TTL_MS). */
export function coldAsk(v: ColdView, now: number, idleMs: number, ttlMs = CACHE_TTL_MS): boolean {
  if (!coldChat(v) || !quietChat(v) || v.background > 0) return false;
  if (v.contextTokens < COLD_MIN_TOKENS || !v.lastTurnAt || v.noteAt >= v.lastTurnAt || v.askedFor === v.lastTurnAt) return false;
  const idle = now - v.lastCallAt;
  return idle >= idleMs && idle < ttlMs;
}

/** The chat still waits for its note (its engine must not be released before it). */
export function coldArmed(v: ColdView, now: number, ttlMs = CACHE_TTL_MS): boolean {
  return coldChat(v) && v.contextTokens >= COLD_MIN_TOKENS && !!v.lastTurnAt && v.noteAt < v.lastTurnAt
    && v.askedFor !== v.lastTurnAt && now - v.lastCallAt < ttlMs;
}

/** A message now goes to a fresh session: a note newer than the last turn, the cache expired, nothing in flight. */
export function coldRoute(v: Omit<ColdView, 'alive' | 'state'>, now: number, ttlMs = CACHE_TTL_MS): boolean {
  // a fresh session would end the old engine and the background agents and commands it still runs
  if (!coldChat(v) || v.busy || v.pending > 0 || v.background > 0 || v.handoffTurn) return false;
  return v.noteAt > 0 && v.noteAt >= v.lastTurnAt && now - v.lastCallAt > ttlMs;
}

const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
/** the Rome day of a time, "2026-10-14" */
export const romeDay = (t: number): string => DAY.format(new Date(t));

/** Is it time for this Orchestrator's day compaction? Quiet a few minutes, a context from an earlier day, once a day. */
export function orchestratorDayDue(v: OrchestratorDayView, now: number): boolean {
  if (!isOrchestrator(v) || v.harness !== 'claude' || !quietChat(v)) return false;
  const today = romeDay(now);
  if (v.askedOn === today || !v.ctxSince || romeDay(v.ctxSince) >= today) return false;
  return v.contextTokens >= ORCHESTRATOR_DAY_MIN && now - v.lastTurnAt >= ORCHESTRATOR_DAY_IDLE_MS;
}

/** The automatic continuity step due now for a chat ('note': write the cold note; 'compact': the Orchestrator's day
 *  compaction), null for none. cold / day = the settings contextHandoff / orchestratorDayCompact. */
export function continuityStep(v: ColdView & Pick<OrchestratorDayView, 'ctxSince' | 'askedOn'>, now: number, o: { cold: boolean; day: boolean; idleMs: number; ttlMs?: number }): 'note' | 'compact' | null {
  if (o.cold && coldAsk(v, now, o.idleMs, o.ttlMs)) return 'note';
  if (o.day && orchestratorDayDue(v, now)) return 'compact';
  return null;
}
