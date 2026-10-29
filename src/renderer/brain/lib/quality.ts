// The four numbers of the Qualità page, computed from the brain's ai-errors.md (tables.quality) and the app's own half
// (/api/quality): corrections the user had to make per 100 turns (ADR 0197), rules whose error came back, PRs held by QA or a build,
// bugs sent back after his fix. Each result carries the range it covers, so the page can say "dal … al …". Pure (no
// DOM), unit-tested in test/unit/brain-ui/quality.test.ts.
import { locale } from '../../i18n';
import type { AppQuality, UserCorrections } from '@shared/contract';
import type { ErrorRow, ErrQuality, QRule, RuleStatus, SeenDay } from '../types';
import { shiftDay } from './format';

export interface CaughtDay {
  date: string; turns: number;
  /** the corrections counted that day (all sources, each event once) */
  caught: number;
  /** ai-errors.md rows that day seen by someone else (reviewer, QA, hook, the agent) */
  others: number;
  /** where the day's count came from: the app's own count of his messages, else the runs' tags, else ai-errors.md only */
  source?: 'app' | 'runs' | 'errors';
}
export interface Caught {
  /** the days both sources cover: the app's log files (turns) */
  from: string | null; to: string | null;
  turns: number; caught: number; others: number; unknown: number;
  /** corrections per 100 turns; null = no turns in the range, or nothing measured at all (never a fake zero) */
  per100: number | null;
  days: CaughtDay[];
  /** errors he caught before the logs start: in the file, outside the count */
  before: number;
  /** the breakdown of `caught` (ADR 0197): «Correggi il pensiero», corrections to a run that had reported, other messages
   *  the detector recognised (semantic = how many of the last two its semantic model decided), the runs' own counters on
   *  days the app did not count messages yet, and ai-errors.md rows beyond what the app saw (visto da = you, or no
   *  «visto da» in a chat you corrected that day) */
  tagged: number; afterReport: number; recognized: number; semantic: number; fromRuns: number; fromErrors: number;
  /** of the rows with no «visto da», the ones matched to a chat he corrected that day */
  matched: number;
  /** his messages the app classified, in the range */
  messages: number;
  /** the first day the app counted his messages (null = never: an older main or no message yet); days before it in the
   *  range rest on the runs' tags and ai-errors.md only */
  since: string | null;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** An ai-errors.md row's chat field names one of the chats he corrected that day (equal, or one contains the other). */
export function sameChat(row: string, titles: readonly string[]): boolean {
  const r = norm(row);
  if (r.length < 3) return false;
  return titles.some(t => { const x = norm(t); return x.length >= 3 && (x === r || (Math.min(x.length, r.length) >= 6 && (x.includes(r) || r.includes(x)))); });
}

/** His corrections ÷ turns, only over the days the app's logs cover (both sides of the division, same days). Per day:
 *  the app's own count of his messages (tag, after a report, recognised: main/brain/user-corrections.ts) once it was
 *  counting, else the runs' tags; the ai-errors.md rows he saw (visto da = him, or no «visto da» in a chat he corrected
 *  that day) count only beyond that, so one correction logged in both places counts once. `corr` absent (an older
 *  main): ai-errors.md alone, as before. `rows` = ai-errors.md rows, for the matching. */
export function caughtPer100(seen: SeenDay[], turns: AppQuality['turns'], corr?: UserCorrections, rows: readonly Pick<ErrorRow, 'data' | 'chi' | 'visto'>[] = []): Caught {
  const { from, to } = turns;
  const inRange = (d: string) => !!from && !!to && d >= from && d <= to;
  const since = corr?.since ?? null;
  const seenOf = new Map(seen.map(s => [s.date, s]));
  const appOf = new Map((corr?.byDay ?? []).map(d => [d.date, d]));
  const runsOf = new Map((corr?.runs ?? []).map(d => [d.date, d]));
  const turnsOf = new Map(turns.byDay.map(t => [t.date, t.claude + t.cursor]));
  const dates = new Set<string>([...turnsOf.keys(), ...seenOf.keys(), ...appOf.keys(), ...runsOf.keys()].filter(inRange));
  const out: Caught = { from, to, turns: 0, caught: 0, others: 0, unknown: 0, per100: null, days: [], before: 0,
    tagged: 0, afterReport: 0, recognized: 0, semantic: 0, fromRuns: 0, fromErrors: 0, matched: 0, messages: 0, since };
  for (const s of seen) if (from && s.date < from) out.before += s.owner;
  let owned = 0;
  for (const date of [...dates].sort()) {
    const s = seenOf.get(date), app = appOf.get(date), run = runsOf.get(date);
    let base = 0, source: CaughtDay['source'] = 'errors';
    if (since && date >= since) {
      source = 'app';
      if (app) {
        out.tagged += app.tagged; out.afterReport += app.afterReport; out.recognized += app.recognized; out.semantic += app.semantic; out.messages += app.messages;
        base = app.tagged + app.afterReport + app.recognized;
      }
    } else if (run && run.tagged + run.afterReport > 0) {
      source = 'runs'; base = run.tagged + run.afterReport; out.fromRuns += base;
    }
    const matched = app?.chats.length ? rows.filter(r => r.data === date && !r.visto.trim() && sameChat(r.chi, app.chats)).length : 0;
    out.matched += matched; owned += s?.owner ?? 0;
    const extra = Math.max(0, (s?.owner ?? 0) + matched - base);
    out.fromErrors += extra;
    const t = turnsOf.get(date) ?? 0;
    out.days.push({ date, turns: t, caught: base + extra, others: s?.other ?? 0, source });
    out.turns += t; out.caught += base + extra; out.others += s?.other ?? 0; out.unknown += s?.unknown ?? 0;
  }
  // with the app's count (or before it, a run's tag or a row he saw) the number is measured; with none of them a 0 would
  // be invented (the bug of 2026-10-29: 0 from 186 rows nobody signed), so there is no number and the page says why
  const measured = !corr ? true : !!since || out.fromRuns > 0 || owned > 0;
  out.per100 = out.turns && measured ? Math.round((out.caught / out.turns) * 1000) / 10 : null;
  return out;
}

/** "2,4" per 100 on one day (— when no turns). */
export const rate = (caught: number, turns: number): string => (turns ? (Math.round((caught / turns) * 1000) / 10).toLocaleString(locale()) : '—');

export interface RuleStats { tornato: number; nonTornato: number; presto: number; senzaTipo: number; judged: number; rules: QRule[] }
const ORDER: Record<RuleStatus, number> = { tornato: 0, 'non-tornato': 1, 'troppo-presto': 2, 'senza-tipo': 3 };
/** Rules by outcome; judged = old enough to say (came back, or 14 days passed without). Came back first, newest first. */
export function ruleStats(q: ErrQuality): RuleStats {
  const c = (s: RuleStatus) => q.rules.filter(r => r.status === s).length;
  const rules = [...q.rules].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.date.localeCompare(a.date));
  return { tornato: c('tornato'), nonTornato: c('non-tornato'), presto: c('troppo-presto'), senzaTipo: c('senza-tipo'), judged: c('tornato') + c('non-tornato'), rules };
}

/** Rows of ai-errors.md left out of the type-based counts: unreadable + no valid type, by written label. */
export function outOfCount(q: ErrQuality): { total: number; unparsed: number; invalid: number; labels: [string, number][] } {
  const m = new Map<string, number>();
  for (const r of q.invalid) m.set(r.type, (m.get(r.type) ?? 0) + 1);
  return { total: q.unparsed.length + q.invalid.length, unparsed: q.unparsed.length, invalid: q.invalid.length, labels: [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}

/** Share of his resolutions that came back, as a whole percentage (null when he resolved none). */
export function reopenShare(r: AppQuality['reopen']): number | null {
  return r.resolved ? Math.round((r.reopened / r.resolved) * 100) : null;
}

/** Errors caught per 100 turns in the last 7 days of the covered range against the 7 before (ADR 0037); null when that
 *  week has no turns. */
export function caughtWeeks(c: Caught): { cur: number | null; prev: number | null; curDays: number; prevDays: number } {
  if (!c.to) return { cur: null, prev: null, curDays: 0, prevDays: 0 };
  const wk = shiftDay(c.to, -6), pwk = shiftDay(c.to, -13);
  const per = (ds: CaughtDay[]) => { const t = ds.reduce((n, d) => n + d.turns, 0); return t ? Math.round((ds.reduce((n, d) => n + d.caught, 0) / t) * 1000) / 10 : null; };
  const cur = c.days.filter(d => d.date >= wk), prev = c.days.filter(d => d.date >= pwk && d.date < wk);
  return { cur: per(cur), prev: per(prev), curDays: cur.length, prevDays: prev.length };
}
