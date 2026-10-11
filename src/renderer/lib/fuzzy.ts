// Fuzzy matching for the command palette (Ctrl+K): subsequence match, accent- and case-insensitive, with bonuses for
// word starts and consecutive letters. Pure; used by CommandPalette.tsx and pinned by test/unit/fuzzy.test.ts.

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Score of `query` against `text`: -1 = no match, higher = better. An empty query matches everything with 0. */
export function fuzzyScore(query: string, text: string): number {
  const q = norm(query).replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  const t = norm(text);
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct + (direct === 0 || /[\s·\-_/.]/.test(t[direct - 1] ?? ' ') ? 200 : 0);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    const wordStart = at === 0 || /[\s·\-_/.]/.test(t[at - 1] ?? ' ');
    score += 10 + (at === prev + 1 ? 15 : 0) + (wordStart ? 25 : 0) - Math.min(at - ti, 10);
    prev = at;
    ti = at + 1;
  }
  return score;
}

/** Items that match, best first (stable for equal scores). */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.item);
}
