// Cursor list prices, to turn token usage into USD when the Cursor engine reports it. Why a table: Cursor's ACP
// `session/prompt` response defines `usage` but Cursor does not fill it today (a bug Cursor staff confirmed); when it
// does, a chat gets a real cost, otherwise ChatSummary.costKnown = false and the UI shows the estimate only (ADR 0010).
// Source: https://cursor.com/docs/models, read 2026-10-11 (docs/research/research-cursor-cost.md §5.5; the page shows
// no date). USD per 1M tokens. "Auto" bills at the routed model's price, which the CLI does not say: unknown → null.
// Used by cursor.ts and brain/cursor-ledger.ts.

export const PRICES_READ_ON = '2026-10-11';

interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }

// key = the model's name tokens; a cache-write price missing on the page counts as input
const TABLE: [string, Price][] = [
  ['grok-4.7-fast', { input: 4, cacheWrite: 4, cacheRead: 1, output: 12 }],
  ['grok-4.7-500k', { input: 4, cacheWrite: 4, cacheRead: 1, output: 12 }],
  ['grok-4.7', { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 }],
  ['grok-4.6', { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 }],
  ['grok-4.5', { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 }],
  ['composer-2.5-fast', { input: 3, cacheWrite: 3, cacheRead: 0.5, output: 15 }],
  ['composer-2.5', { input: 0.5, cacheWrite: 0.5, cacheRead: 0.2, output: 2.5 }],
  ['gpt-5.6-sol', { input: 4, cacheWrite: 5, cacheRead: 0.4, output: 20 }],
  ['gpt-5.6-terra', { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 12 }],
  ['gpt-5.6-luna', { input: 0.2, cacheWrite: 0.25, cacheRead: 0.02, output: 1.2 }],
  ['gpt-5.5', { input: 5, cacheWrite: 5, cacheRead: 0.5, output: 30 }],
  ['claude-opus-5.5', { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }],
  ['claude-opus-5', { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 }],
  ['claude-sonnet-5.5', { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }],
  ['claude-sonnet-5', { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 }],
  ['claude-fable-5.1', { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 }],
  ['claude-haiku-5.5', { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }],
  ['gemini-3.1-pro', { input: 2, cacheWrite: 2, cacheRead: 0.2, output: 12 }],
];

const tokens = (s: string): string[] => s.toLowerCase().replace(/\[.*\]$/, '').split(/[^a-z0-9.]+/).filter(Boolean);

/** The list price of a Cursor model id ("claude-sonnet-5.5", "sonnet-5.5-thinking", "gpt-5.6-sol[effort=high]"):
 *  the table entry whose tokens all appear in the id (the most specific wins; "claude" may be omitted). */
export function priceOf(model: string | null | undefined): Price | null {
  const key = modelKey(model);
  return key ? TABLE.find(([k]) => k === key)![1] : null;
}

/** The price-table entry a model id falls under ("grok-4.7-low" → "grok-4.7"), or null: the per-model key of the CSV
 *  calibration (brain/cursor-ledger.ts), so the CSV's names and the hook's names meet. */
export function modelKey(model: string | null | undefined): string | null {
  if (!model) return null;
  const have = new Set(tokens(model));
  let best: { n: number; key: string } | null = null;
  for (const [key] of TABLE) {
    const need = tokens(key).filter(t => t !== 'claude');
    if (need.every(t => have.has(t)) && (!best || need.length > best.n)) best = { n: need.length, key };
  }
  return best?.key ?? null;
}

export interface AcpUsage { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number; thoughtTokens?: number; totalTokens?: number }

/** USD of one turn at list price, or null when the model or the usage is unknown. */
export function costOf(model: string | null | undefined, usage: AcpUsage | null | undefined): number | null {
  const p = priceOf(model);
  if (!p || !usage) return null;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (!n(usage.inputTokens) && !n(usage.outputTokens) && !n(usage.cachedReadTokens) && !n(usage.cachedWriteTokens)) return null;
  const usd = (n(usage.inputTokens) * p.input + n(usage.cachedWriteTokens) * p.cacheWrite + n(usage.cachedReadTokens) * p.cacheRead + n(usage.outputTokens) * p.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
