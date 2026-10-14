// The four numbers of the Qualità page, computed from the brain's ai-errors.md (tables.quality) and the app's own half
// (/api/quality): errors the user had to catch per 100 turns, rules whose error came back, PRs held by QA or a build,
// bugs sent back after his fix. Each result carries the range it covers, so the page can say "dal … al …". Pure (no
// DOM), unit-tested in test/unit/brain-ui/quality.test.ts.
import type { AppQuality } from '@shared/contract';
import type { ErrQuality, QRule, RuleStatus, SeenDay } from '../types';
import { shiftDay } from './format';

export interface CaughtDay { date: string; turns: number; caught: number; others: number }
export interface Caught {
  /** the days both sources cover: the app's log files (turns) */
  from: string | null; to: string | null;
  turns: number; caught: number; others: number; unknown: number;
  /** errors the user caught per 100 turns; null = no turns in the range */
  per100: number | null;
  days: CaughtDay[];
  /** errors he caught before the logs start: in the file, outside the count */
  before: number;
}

/** Errors seen by the user ÷ turns, only over the days the app's logs cover (both sides of the division, same days). */
export function caughtPer100(seen: SeenDay[], turns: AppQuality['turns']): Caught {
  const { from, to } = turns;
  const inRange = (d: string) => !!from && !!to && d >= from && d <= to;
  const days = new Map<string, CaughtDay>();
  const day = (d: string) => days.get(d) ?? { date: d, turns: 0, caught: 0, others: 0 };
  for (const t of turns.byDay) if (inRange(t.date)) days.set(t.date, { ...day(t.date), turns: t.claude + t.cursor });
  let unknown = 0, before = 0;
  for (const s of seen) {
    if (!inRange(s.date)) { if (from && s.date < from) before += s.owner; continue; }
    days.set(s.date, { ...day(s.date), caught: s.owner, others: s.other });
    unknown += s.unknown;
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (k: 'turns' | 'caught' | 'others') => list.reduce((n, d) => n + d[k], 0);
  const t = sum('turns'), c = sum('caught');
  return { from, to, turns: t, caught: c, others: sum('others'), unknown, per100: t ? Math.round((c / t) * 1000) / 10 : null, days: list, before };
}

/** "2,4" per 100 on one day (— when no turns). */
export const rate = (caught: number, turns: number): string => (turns ? (Math.round((caught / turns) * 1000) / 10).toLocaleString('it-IT') : '—');

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
