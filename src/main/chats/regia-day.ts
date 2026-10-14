// «Regie corte» (ADR 0051; the user, 2026-10-14: the Regie made 16% of the spend, «una Regia si compatta o riparte da sola
// con un riassunto quando supera la soglia o all'inizio di un nuovo giorno; non deve perdere la coda né le chat che
// segue»). Over the threshold every Claude chat, a Regia too, compacts by itself (compactWindowTokens, ADR 0031). On a
// new day a Regia whose context began on an earlier day gets one quiet `/compact` with what it must keep: the same
// chat and session go on, so its mail queue (the app's) and its work chats (regiaOf) never move. When: idle a few
// minutes, nothing pending or running, its Claude engine alive, at least REGIA_DAY_MIN tokens of context; once a day.
// Pure: the manager (chats/manager.ts coldTick) gives the view and sends the turn. Tested in test/unit/regia-day.test.ts.

/** below this context a compaction saves too little for the detail it loses */
export const REGIA_DAY_MIN = 50_000;
/** idle this long first: never between two messages of a conversation the user is having with the Regia */
export const REGIA_DAY_IDLE_MS = 3 * 60_000;

/** What the Regia's summary keeps (Claude Code's `/compact <instructions>`). Italian: the Regia works in Italian. */
export const REGIA_COMPACT = '/compact Giorno nuovo: tieni solo quello che serve per continuare. Le chat che segui (titolo, a che punto sono, cosa aspetti da ognuna), i messaggi e le domande all’utente ancora aperti, le sue decisioni e preferenze di oggi e di ieri ancora valide, i lavori in background e come riprenderli. Togli il resto.';

const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
/** the Rome day of a time, "2026-10-14" */
export const romeDay = (t: number): string => DAY.format(new Date(t));

export interface RegiaDayView {
  harness: string; isRegia: boolean; appRegia?: boolean; state: string;
  pending: number; busy: boolean; alive: boolean; handoffTurn: boolean;
  contextTokens: number; lastTurnAt: number;
  /** when the context in force began: the first turn since the session started or the last compaction */
  ctxSince: number | undefined;
  /** the Rome day this Regia was last asked to compact (once a day, even when it failed) */
  askedOn: string | undefined;
}

/** Is it time for this Regia's day compaction? */
export function regiaDayDue(v: RegiaDayView, now: number): boolean {
  if (!(v.isRegia || v.appRegia) || v.harness !== 'claude') return false;
  if (v.state !== 'idle' || v.pending > 0 || v.busy || !v.alive || v.handoffTurn) return false;
  const today = romeDay(now);
  if (v.askedOn === today || !v.ctxSince || romeDay(v.ctxSince) >= today) return false;
  return v.contextTokens >= REGIA_DAY_MIN && now - v.lastTurnAt >= REGIA_DAY_IDLE_MS;
}
