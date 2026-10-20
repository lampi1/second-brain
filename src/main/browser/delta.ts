// read_page as a difference (token plan 2026-10-20, F4): a QA flow reads the same page again after every action, and
// each read put up to 20 000 characters into the chat's context, where it stays for every later turn (one QA chat reached
// 898k of context, ADR 0031). When the agent read the same page (same URL, same filter) before, the tool now returns
// only the lines that are new or changed, each with its parent lines for context, and how many lines went away or
// stayed; `full: true` returns the whole tree. Refs of elements that still exist do not change between reads
// (walkPage), so an unchanged element prints the same line. Pure. Used by browser/tools.ts; pinned by
// test/unit/browser-delta.test.ts.

/** Above this share of the page, the difference saves too little: the whole tree goes. */
export const DELTA_MAX_SHARE = 0.6;

const indentOf = (line: string): number => line.length - line.trimStart().length;
/** The header lines every read carries (tab, title, URL, focus). */
const isHead = (line: string, i: number): boolean => i === 0 || /^Focused: /.test(line);

/** The second read as a difference from the first, or null when the whole tree should go (first read of the page, a
 *  big change, or a difference not much smaller than the page). */
export function snapshotDelta(prev: string, next: string, maxShare = DELTA_MAX_SHARE): string | null {
  const a = prev.split('\n'), b = next.split('\n');
  const headB = b.filter(isHead), bodyA = a.filter((l, i) => !isHead(l, i)), bodyB = b.filter((l, i) => !isHead(l, i));
  if (!bodyB.length) return null;
  const left = new Map<string, number>();
  for (const l of bodyA) left.set(l, (left.get(l) ?? 0) + 1);
  const fresh = bodyB.map(l => { const n = left.get(l) ?? 0; if (n > 0) { left.set(l, n - 1); return false; } return true; });
  const gone = [...left.values()].reduce((s, n) => s + n, 0);
  const changed = fresh.filter(Boolean).length;
  if (!changed && !gone) return [...headB, '(no change since your last read_page of this page; full: true for the whole tree)'].join('\n');
  // each new line with its parents (the nearest earlier lines with a smaller indent), in page order
  const keep = new Set<number>();
  bodyB.forEach((line, i) => {
    if (!fresh[i]) return;
    keep.add(i);
    let need = indentOf(line);
    for (let j = i - 1; j >= 0 && need > 0; j--) {
      const d = indentOf(bodyB[j]!);
      if (d < need) { keep.add(j); need = d; }
    }
  });
  if (keep.size > bodyB.length * maxShare) return null;
  const shown = bodyB.filter((_, i) => keep.has(i));
  const note = `(changes since your last read_page of this page: ${changed} new or changed line${changed === 1 ? '' : 's'} shown with their parents, ${gone} gone, ${bodyB.length - changed} unchanged; full: true for the whole tree)`;
  return [...headB, note, ...shown].join('\n');
}
