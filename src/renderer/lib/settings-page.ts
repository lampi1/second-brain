// Pure helpers of the Settings page (components/SettingsPage.tsx), apart so the unit tests reach them without React:
// the $ amount of a spending limit as the user types it, the port the MCP server really listens on, and the search
// (which sections and rows match, where to highlight). Used by SettingsPage.tsx and test/unit/settings-ui.test.ts.

/** A typed $ amount → number, null (empty = no limit) or 'bad'. The same rules as the main process (settings-schema
 *  'usd': > 0, ≤ 1,000,000, cents); "1.000" is refused, never read as 1 $. */
export function parseUsd(text: string): number | null | 'bad' {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(t)) return 'bad';
  const v = Number(t.replace(',', '.'));
  return v > 0 && v <= 1e6 ? v : 'bad';
}

/** The port in the app's MCP url (app:info mcpUrl): the one in use, which settings.mcpPort is not. */
export function portOf(url: string | null | undefined): string | null {
  const m = url?.match(/^https?:\/\/[^/]+:(\d+)(\/|$)/);
  return m ? m[1]! : null;
}

/** All search words must appear; case, accents and whitespace do not change the result. */
export function matchesSettingsSearch(query: string, text: string): boolean {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const haystack = normalize(text);
  return words.every(word => haystack.includes(word));
}

/** Where the search words appear in a text (ADR 0207: the page highlights them): [start, end) offsets in the original
 *  text, sorted and merged, with the same case and accent folding as matchesSettingsSearch. */
export function hitRanges(text: string, query: string): [number, number][] {
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length || !text) return [];
  // the folded text, and for each of its characters the offset of the original character it came from
  let folded = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) { const f = fold(text[i]!); folded += f; for (let k = 0; k < f.length; k++) from.push(i); }
  const found: [number, number][] = [];
  for (const word of words) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) found.push([from[at]!, from[at + word.length - 1]! + 1]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  return merged;
}
