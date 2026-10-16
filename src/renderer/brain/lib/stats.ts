// What makes a number or an error useful (the user, 2026-10-13: "vorrei che gli errori fossero più utili, le stats in
// generale"; ADR 0037): the AI errors of ai-errors.md grouped by pattern (the official type, written labels normalized
// as recurrence.mjs does) with count, last seen, areas, chats, the rule born from them and the last 7 days against the
// 7 before; and the plain-Italian reading of any number against its previous period ("in calo: 3 contro 7"). Computed
// locally from the brain's tables, zero tokens. Pure (no DOM), unit-tested in test/unit/brain-ui/stats.test.ts; used by
// pages/Qualita.tsx and pages/Costi.tsx.
import { t, locale } from '../../i18n';
import type { ErrorRow, QRule, RuleStatus } from '../types';
import { shiftDay } from './format';

/** The 11 official types of ai-errors.md (its header; recurrence.mjs TYPES). */
export const ERROR_TYPES = ['test-passato-a-torto', 'bug-non-trovato', 'fatto-non-verificato', 'posto-sbagliato', 'regola-ignorata',
  'richiesta-fraintesa', 'non-capito', 'azione-pericolosa', 'fuori-ruolo', 'blocco-aggirato', 'altro'] as const;
/** A written label as recurrence.mjs normType() reads it: no accents, lower case, no "(…)" tail, dashes. */
export const normType = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  .replace(/\s*\(.*\)$/, '').replace(/[\s_]+/g, '-');

// ── trend: a number against its previous period ─────────────────────────────────────────────────────────────────────
export type Dir = 'su' | 'giu' | 'uguale';
export interface Trend { dir: Dir | null; good: boolean | null; text: string }
/** "in calo: 3 errori questa settimana contro 7". `fmtN` formats both numbers; `lowerIsBetter` decides the tone; `prev`
 *  null = the previous period has no data (said, never guessed). Within 10% (and both non-zero) = stable. */
export function trend(cur: number, prev: number | null, o: { what: string; now: string; before: string; lowerIsBetter?: boolean; fmtN?: (n: number) => string }): Trend {
  const f = o.fmtN ?? ((n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 }));
  const w = (...xs: string[]) => xs.filter(Boolean).join(' ');
  if (prev === null) return { dir: null, good: null, text: t('brainLib.stats.trendNoData', { value: w(f(cur), o.what, o.now), before: o.before }) };
  const same = cur === prev || (cur > 0 && prev > 0 && Math.abs(cur - prev) / prev < 0.1);
  const dir: Dir = same ? 'uguale' : cur > prev ? 'su' : 'giu';
  const low = o.lowerIsBetter ?? true;
  const good = dir === 'uguale' ? null : (dir === 'giu') === low;
  const words = { uguale: t('brainLib.stats.trendStable'), su: t('brainLib.stats.trendUp'), giu: t('brainLib.stats.trendDown') } as const;
  const word = words[dir];
  return { dir, good, text: t('brainLib.stats.trendWithData', { word, cur: w(f(cur), o.what, o.now), prev: w(f(prev), o.before) }) };
}

// ── error patterns ────────────────────────────────────────────────────────────────────────────────────────────────
export interface ErrorGroup {
  /** the normalized type: the pattern's key */
  type: string;
  official: boolean;
  count: number;
  first: string; last: string; lastTime: string;
  /** rows in the last 7 days (today included) and in the 7 before */
  week: number; prevWeek: number;
  /** areas and chats, most frequent first */
  areas: [string, number][]; chats: [string, number][];
  /** how many the owner had to catch himself (visto da = his name) */
  byOwner: number;
  /** the newest row: what was said and what was true */
  latest: ErrorRow;
  /** the rules born from this pattern: from the rows ("regola: …") and from recurrence.mjs (with their outcome) */
  rules: { rule: string; status: RuleStatus | null; date: string }[];
}
export interface ErrorPatterns {
  /** patterns seen at least twice, the busiest of the last 7 days first, then the most recent */
  recurring: ErrorGroup[];
  /** patterns seen once: no pattern to fix yet */
  once: number;
  /** recurring patterns with nothing in the last 30 days: folded */
  quiet: ErrorGroup[];
  /** rows whose type cannot be read even from the raw line: shown as "Formato non riconosciuto" with the line */
  unknown: ErrorRow[];
  week: number; prevWeek: number;
  from: string; to: string;
}

const tally = (xs: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) { const k = x.trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
/** The type of a row: its field, else from the raw line the brain's parser could not split (it wants the type right
 *  before "detto:" as 3rd field or later; real lines have "said:"/"true:", "fatto:", "<tipo>: detto …" or a field
 *  missing): 1) a field, or the part of it before ":", that is an official type; 2) the field right before the claim
 *  label ("detto:", "fatto:", "said:", "vero:", "true:"), when a chat field comes before it; '' when there is none,
 *  and the page shows the line as "Formato non riconosciuto". Never a bare dash on screen. */
export function rowType(r: ErrorRow): string {
  const t = normType(r.tipo);
  if (t) return t;
  const fields = (r.riga ?? '').replace(/^-?\s*\d{4}-\d{2}-\d{2}(\s+[\d:-]{5})?\s*·\s*/, '').split(' · ');
  const official = fields.map(f => normType(f.split(':')[0] ?? '')).find(f => (ERROR_TYPES as readonly string[]).includes(f));
  if (official) return official;
  const claim = fields.findIndex(f => /^(detto|fatto|said|vero|true)\b[^:·]{0,20}:/i.test(f.trim()));
  const before = claim >= 3 ? (fields[claim - 1] ?? '').trim() : ''; // chat · area · type · claim: never the area
  return before && !before.includes(':') && before.split(/\s+/).length <= 4 ? normType(before) : '';
}
const stamp = (r: ErrorRow) => `${r.data} ${r.ora && r.ora !== '--:--' ? r.ora : '00:00'}`;

/** ai-errors.md rows grouped by pattern; `today` is the brain's day (YYYY-MM-DD), `owner` the owner's name. */
export function errorPatterns(rows: ErrorRow[], qRules: QRule[], today: string, owner: string): ErrorPatterns {
  const wk = shiftDay(today, -6), pwk = shiftDay(today, -13), month = shiftDay(today, -29);
  const byType = new Map<string, ErrorRow[]>();
  const unknown: ErrorRow[] = [];
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.data)) continue;
    const t = rowType(r);
    if (!t) { unknown.push(r); continue; }
    byType.set(t, [...(byType.get(t) ?? []), r]);
  }
  const written = new Set(rows.map(r => r.regola.trim()).filter(Boolean));
  const ownerRe = owner ? new RegExp(`^["'«]?${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i') : null;
  const groups: ErrorGroup[] = [...byType].map(([type, rs]) => {
    const sorted = [...rs].sort((a, b) => stamp(a).localeCompare(stamp(b)));
    const latest = sorted.at(-1)!;
    const fromRows = sorted.filter(r => r.regola.trim()).map(r => ({ rule: r.regola.trim(), status: null as RuleStatus | null, date: r.data }));
    // recurrence.mjs maps aliases to the official type: a rule goes to the group whose rows wrote it, by type only
    // when no row names it
    const fromQ = qRules.filter(q => (rs.some(r => r.regola.trim() === q.rule.trim()) || (!written.has(q.rule.trim()) && normType(q.type) === type))).map(q => ({ rule: q.rule.trim(), status: q.status, date: q.date }));
    const rules = [...fromQ, ...fromRows.filter(x => !fromQ.some(q => q.rule === x.rule))]
      .filter((x, i, a) => a.findIndex(y => y.rule === x.rule) === i)
      .sort((a, b) => b.date.localeCompare(a.date));
    return {
      type, official: (ERROR_TYPES as readonly string[]).includes(type), count: rs.length,
      first: sorted[0]!.data, last: latest.data, lastTime: latest.ora && latest.ora !== '--:--' ? latest.ora : '',
      week: rs.filter(r => r.data >= wk && r.data <= today).length,
      prevWeek: rs.filter(r => r.data >= pwk && r.data < wk).length,
      areas: tally(rs.map(r => r.area)), chats: tally(rs.map(r => r.chi)),
      byOwner: ownerRe ? rs.filter(r => ownerRe.test(r.visto.trim())).length : 0,
      latest, rules,
    };
  });
  const many = groups.filter(g => g.count >= 2)
    .sort((a, b) => b.week - a.week || b.last.localeCompare(a.last) || b.count - a.count);
  const dated = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.data)).map(r => r.data).sort();
  return {
    recurring: many.filter(g => g.last >= month),
    quiet: many.filter(g => g.last < month),
    once: groups.filter(g => g.count < 2).length,
    unknown: unknown.sort((a, b) => stamp(b).localeCompare(stamp(a))),
    week: groups.reduce((n, g) => n + g.week, 0) + unknown.filter(r => r.data >= wk && r.data <= today).length,
    prevWeek: groups.reduce((n, g) => n + g.prevWeek, 0) + unknown.filter(r => r.data >= pwk && r.data < wk).length,
    from: dated[0] ?? '', to: dated.at(-1) ?? '',
  };
}

/** Readable name of a pattern: "fatto-non-verificato" → "fatto non verificato". */
export const typeLabel = (t: string): string => t.replace(/-/g, ' ');

// ── costs: the period before ─────────────────────────────────────────────────────────────────────────────────────
/** The spend of the `days` before the current period, from a 2×days answer of /api/cost (its byDay, its `from`); null
 *  when that answer has no day in the previous window. `since` = the answer's first day when it starts inside the
 *  window (the transcripts are gone before it: a partial period, no trend); a day without spend has no byDay key and
 *  does not count as missing. */
export function previousSpend(byDay: Record<string, { usd: number }>, to: string, days: number, dataFrom: string): { usd: number; since: string | null } | null {
  const curStart = shiftDay(to, -(days - 1)), prevStart = shiftDay(curStart, -days);
  const ds = Object.keys(byDay).filter(d => d >= prevStart && d < curStart).sort();
  if (!ds.length) return null;
  return { usd: ds.reduce((n, d) => n + (byDay[d]?.usd ?? 0), 0), since: dataFrom > prevStart ? dataFrom : null };
}
