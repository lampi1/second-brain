// What Andamento → Uso shows of the usage counter's report (ADR 0202): each key in words (the page's or tab's name, the
// action's), where a click on it goes, and the places never opened in the period. Pure (the names come from the caller's
// `name` function, so the dictionary and the page list stay outside): used by components/andamento/UsageTab.tsx.
// Tests: test/unit/use-view.test.ts.
import type { UseCountRow } from '@shared/contract';

export interface UseItem { key: string; kind: 'page' | 'action'; label: string; place: { page: string; arg: string | null } | null; n: number; days: number; last: string }

/** "page:memoria/skill" → { page: 'memoria', arg: 'skill' }; "action:discuss" → null. */
export function placeOfKey(key: string): { page: string; arg: string | null } | null {
  const m = /^page:([^/]+)(?:\/(.+))?$/.exec(key);
  return m ? { page: m[1]!, arg: m[2] ?? null } : null;
}

/** The report's rows in words, the busiest first (as main sorted them). `name(kind, id, sub)` names a page, a tab
 *  (sub) or an action. */
export function useItems(rows: readonly UseCountRow[], name: (kind: 'page' | 'action', id: string, sub: string | null) => string): UseItem[] {
  return rows.map(r => {
    const place = placeOfKey(r.key);
    const kind = place ? 'page' : 'action';
    const label = place ? name('page', place.page, place.arg) : name('action', r.key.replace(/^action:/, ''), null);
    return { key: r.key, kind, label, place, n: r.n, days: r.days, last: r.last };
  });
}

/** The places (keys "page:<id>[/<tab>]") among `candidates` that no row counts: never opened in the period. */
export function neverOpened(rows: readonly UseCountRow[], candidates: readonly string[]): string[] {
  const seen = new Set(rows.map(r => r.key));
  return candidates.filter(k => !seen.has(k));
}

/** Days with at least one use. */
export const activeDays = (byDay: readonly { n: number }[]): number => byDay.filter(d => d.n > 0).length;
