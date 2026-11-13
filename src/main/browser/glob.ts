// Glob matching for agent-given URL patterns ("*/api/*"), without regular expressions: a page controls its URL, and a
// regex built from "*/*/*/*X" backtracks exponentially on a long URL, freezing the main process (security review
// 2026-10-11). Linear in the text length per "*". Pure, unit-tested; used by browser/netlog.ts and browser/actions.ts.

/** Does text match pattern, where "*" stands for any run of characters? anchored = the whole text must match. */
export function globMatch(text: string, pattern: string, anchored: boolean): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return anchored ? text === pattern : text.includes(pattern);
  const first = parts[0]!, last = parts[parts.length - 1]!;
  let pos = 0;
  if (anchored) {
    if (!text.startsWith(first)) return false;
    pos = first.length;
  }
  const middle = anchored ? parts.slice(1, -1) : parts.slice(0, -1);
  for (const p of middle) {
    if (!p) continue;
    const i = text.indexOf(p, pos);
    if (i < 0) return false;
    pos = i + p.length;
  }
  if (!anchored) return last === '' || text.indexOf(last, pos) >= 0;
  return text.length - last.length >= pos && text.endsWith(last);
}
