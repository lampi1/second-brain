// The one rule that says whether an engine's plan has credit now (ADR 0354, owner 2026-11-25: «i limiti dei motori seguono
// i dati veri»). Pure: it gets the last usage reading of the pool (with its time), the last limit error and the short
// pause it opened, the start of the last turn that ended without a limit error, a probe in flight, and the time now; it
// says free · pace · out · probation · unknown, with the reason, the source and the expected end. Everyone uses it:
// the pick of a model at a chat's start (main/agents/catalog.ts through wiring.ts room), a chat that waits on its
// credits (main/agents/credit-wait.ts), the limits panel (renderer UsagePopover), the recap and the digest. There is
// no other copy of it: model-levels.ts roomOf only maps it to a level's Room. Tested in test/unit/shared/credit-rule.test.ts.
import type { HarnessUsageWindow } from './contract';

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** A reading is valid for this long (owner: «non più vecchia di 5 minuti»). */
export const READING_FRESH_MS = 5 * MIN;
/** The short pause after a limit error (owner: 5 minutes). */
export const SHORT_PAUSE_MS = 5 * MIN;
/** The longest pause after failed probes: 1 hour on a pool the app can read, a day on one it cannot. */
export const PAUSE_CAP_READ_MS = HOUR;
export const PAUSE_CAP_BLIND_MS = DAY;
/** A probe that never reported back (its chat did not start) is released after this long. */
export const PROBE_TTL_MS = 15 * MIN;
/** At or above this a plan window counts as spent (unchanged, ADR 0347). */
export const SPENT_PCT = 98;

export type CreditState = 'free' | 'pace' | 'out' | 'probation' | 'unknown';
export type CreditSource = 'reading' | 'error' | 'turn' | 'none';

/** One reading of a pool's plan windows (the usage panel's, ADR 0334). `ok` false = the reading failed. */
export interface CreditReading { at: number; ok: boolean; pool: string; account: string | null; windows: readonly HarnessUsageWindow[] }
/** The last limit error of a pool and the pause it opened: from `pauseFrom` for `pauseMs`. */
export interface CreditError { at: number; pauseFrom: number; pauseMs: number }
export interface CreditFacts {
  pool: string;
  /** the account the error was seen on (a hash, never the address); null = unknown */
  account?: string | null;
  /** the model asked: a window of one model only stops that model */
  model?: string | null;
  reading: CreditReading | null;
  error: CreditError | null;
  /** the start of the last turn on this pool that ended without a limit error */
  workedFrom: number | null;
  /** a chat that started on probation and has not reported yet */
  probe?: { owner: string; at: number } | null;
}
export interface CreditVerdict {
  state: CreditState;
  /** Italian, one line: «5h al 100%, torna alle 22:40», «pausa breve dopo un errore di limite» */
  why: string;
  source: CreditSource;
  /** when it is expected to have credit again; null = not known */
  until: number | null;
  /** when the reading it rests on was taken; null = none */
  readingAt: number | null;
  /** the reading should be taken again now: the pool looks stopped and its reading is not valid */
  reread?: true;
}

const WINDOW_MS: Partial<Record<HarnessUsageWindow['kind'], number>> = { 'five-hour': 5 * HOUR, daily: DAY, weekly: 7 * DAY, plan: 30 * DAY };
/** «22:40» (today) or «gio 22:40»: the end shown to the user, in the PC's time zone. */
export function clock(at: number, now: number, fmt?: (at: number) => string): string {
  if (fmt) return fmt(at);
  const d = new Date(at), same = new Date(now).toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return same ? hm : `${['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][d.getDay()]} ${hm}`;
}
const fmtLeft = (ms: number): string => ms >= DAY ? `${Math.floor(ms / DAY)}g ${Math.floor(ms % DAY / HOUR)}h` : ms >= HOUR ? `${Math.floor(ms / HOUR)}h ${Math.floor(ms % HOUR / MIN)}m` : `${Math.max(1, Math.round(ms / MIN))}m`;

/** A window that stops this model: the plan's own, or one of this model only (spend windows never stop the plan). */
export function binding(w: HarnessUsageWindow, model: string | null | undefined): boolean {
  if (w.kind === 'spend') return false;
  if (!w.model) return true;
  return !!model && model.toLowerCase().includes(w.model.toLowerCase());
}

/** Is this reading valid for these facts: it worked, it is at most 5 minutes old, same pool and account. */
export function validReading(f: Pick<CreditFacts, 'pool' | 'account' | 'reading'>, now: number): boolean {
  const r = f.reading;
  return !!r && r.ok && r.pool === f.pool && now - r.at <= READING_FRESH_MS && !(f.account && r.account && f.account !== r.account);
}

/** The verdict for a pool now. `asker` = the chat (or launch) that asks: a probe in flight is its own, others wait. */
export function creditVerdict(f: CreditFacts, now: number, o: { asker?: string; fmt?: (at: number) => string } = {}): CreditVerdict {
  const r = f.reading && f.reading.ok && f.reading.pool === f.pool && !(f.account && f.reading.account && f.account !== f.reading.account) ? f.reading : null;
  const valid = !!r && validReading(f, now);
  const readingAt = r?.at ?? null;
  const at = (x: number) => clock(x, now, o.fmt);
  // 1. a window of the plan at 98% or more: spent until its reset (the farthest one); no reset = until a reading drops
  if (r) {
    const spent = r.windows.filter(w => binding(w, f.model) && w.usedPercent >= SPENT_PCT);
    if (spent.length) {
      const label = spent.map(w => `${w.label} al ${Math.round(w.usedPercent)}%`).join(', ');
      if (spent.some(w => w.resetsAt === null)) {
        // a reading that is not valid any more cannot say «still spent» with no end: read again (meanwhile it stays out)
        return { state: 'out', why: `${label}: finito finché una lettura nuova non scende`, source: 'reading', until: null, readingAt, ...(valid ? {} : { reread: true as const }) };
      }
      const until = Math.max(...spent.map(w => w.resetsAt!));
      if (until > now) return { state: 'out', why: `${label}, torna alle ${at(until)}`, source: 'reading', until, readingAt };
      // the reset is past: read again; a turn that worked after it frees it, else one chat tries
      if (f.workedFrom !== null && f.workedFrom >= until) return { state: 'free', why: 'un turno è andato a buon fine dopo il rinnovo', source: 'turn', until: null, readingAt };
      return probation(f, now, o.asker, `rinnovo passato alle ${at(until)}: lettura da rifare`, readingAt, true);
    }
  }
  // 2. a limit error the reading does not cover
  const e = f.error;
  if (e && !(f.workedFrom !== null && f.workedFrom > e.at)) {
    const end = e.pauseFrom + e.pauseMs;
    // a valid reading taken after the pause, all under 98%: the error is over (reading below decides free or pace)
    if (!(valid && r!.at >= end)) {
      if (now < end) return { state: 'out', why: `errore di limite: pausa breve, torna alle ${at(end)}`, source: 'error', until: end, readingAt, ...(valid && r!.at >= e.at ? {} : { reread: true as const }) };
      return probation(f, now, o.asker, 'dopo la pausa breve: una chat prova', readingAt, !valid);
    }
  }
  // 3. the reading's pace (unchanged rule, ADR 0347): the share used against the share of the window gone by
  if (r) {
    for (const w of r.windows) {
      if (!binding(w, f.model) || w.resetsAt === null) continue;
      const span = WINDOW_MS[w.kind], left = w.resetsAt - now;
      if (!span || left <= 0 || w.usedPercent < 50) continue;
      const gone = Math.min(1, Math.max(0, (span - left) / span));
      if (gone >= 0.1 && w.usedPercent / gone > 100) return { state: 'pace', why: `${w.label} al ${Math.round(w.usedPercent)}% con ${fmtLeft(left)} al rinnovo: a questo ritmo finisce prima`, source: 'reading', until: w.resetsAt, readingAt };
    }
    const top = r.windows.filter(w => binding(w, f.model)).reduce<HarnessUsageWindow | null>((a, w) => !a || w.usedPercent > a.usedPercent ? w : a, null);
    return { state: 'free', why: top ? `${top.label} al ${Math.round(top.usedPercent)}%` : 'nessun limite riportato', source: 'reading', until: null, readingAt };
  }
  if (e) return { state: 'free', why: 'un turno è andato a buon fine dopo l’errore di limite', source: 'turn', until: null, readingAt: null };
  return { state: 'unknown', why: 'limite non letto', source: 'none', until: null, readingAt: null };
}

function probation(f: CreditFacts, now: number, asker: string | undefined, why: string, readingAt: number | null, reread: boolean): CreditVerdict {
  const p = f.probe && now - f.probe.at < PROBE_TTL_MS ? f.probe : null;
  if (p && p.owner !== asker) return { state: 'out', why: 'in prova su un’altra chat: si sa tra poco', source: 'error', until: null, readingAt };
  return { state: 'probation', why, source: f.error ? 'error' : 'reading', until: null, readingAt, ...(reread ? { reread: true as const } : {}) };
}

/** The pause after a new limit error. Errors of turns that started before the current pause ended count as one; a probe
 *  that started after it and failed doubles it (cap: 1 hour on a readable pool, a day on a blind one). */
export function nextError(prev: CreditError | null, errorAt: number, turnStartedAt: number, readable: boolean, workedFrom: number | null = null): CreditError {
  // a clean turn after the last error proved the pool worked: a new error starts again from the short pause
  if (!prev || (workedFrom !== null && workedFrom > prev.at)) return { at: errorAt, pauseFrom: errorAt, pauseMs: SHORT_PAUSE_MS };
  const end = prev.pauseFrom + prev.pauseMs;
  if (turnStartedAt < end) return { ...prev, at: Math.max(prev.at, errorAt) };
  return { at: errorAt, pauseFrom: errorAt, pauseMs: Math.min(readable ? PAUSE_CAP_READ_MS : PAUSE_CAP_BLIND_MS, prev.pauseMs * 2) };
}

/** The line a skipped model gets in the chat and in the tools' answers: «OpenAI saltato: 5h al 100%, torna alle 22:40». */
export function skipLine(name: string, v: Pick<CreditVerdict, 'why'>): string { return `${name} saltato: ${v.why}`; }
