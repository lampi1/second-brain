// Typo tolerance for the BM25 half of the hybrid search: a query word the index does not know ("dashbord") is widened to
// the indexed words within a small edit distance ("dashboard"), one typo for words of 4-7 letters, two from 8 (a
// transposition counts as one). Short words are never widened: too many false friends. Pure; used by hybrid/engine.ts.

/** Damerau-Levenshtein distance (optimal string alignment) between a and b, or max+1 as soon as it exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length]!;
}

/** Typos allowed for a word of this length. */
export const allowedTypos = (len: number): number => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** The vocabulary words closest to `word` (best distance first, at most `limit`); [] when none is close enough. */
export function nearWords(word: string, vocab: Iterable<string>, limit = 3): string[] {
  const max = allowedTypos(word.length);
  if (!max) return [];
  const found: { w: string; d: number }[] = [];
  for (const w of vocab) {
    if (w === word || Math.abs(w.length - word.length) > max) continue;
    const d = editDistance(word, w, max);
    if (d <= max) found.push({ w, d });
  }
  return found.sort((x, y) => x.d - y.d || x.w.localeCompare(y.w)).slice(0, limit).map(x => x.w);
}
