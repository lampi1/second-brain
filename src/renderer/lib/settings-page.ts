// Pure helpers of the Settings page (components/SettingsPage.tsx), apart so the unit tests reach them without React:
// the $ amount of a spending limit as the user types it, and the port the MCP server really listens on.
// Used by SettingsPage.tsx and test/unit/settings-ui.test.ts.

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
