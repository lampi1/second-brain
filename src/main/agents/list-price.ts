// The list price of a model whatever engine ran it (ADR 0284): what a run cost when its engine reported tokens but no
// cost (Codex, OpenCode, Cursor). Why: without a cost a role's models cannot be compared by «cost per success». The
// brain's price table first (harness/models.json, any engine's row: the same model costs the same through another
// CLI), then the list prices kept for Cursor's models (chats/cursor-prices.ts), by the exact name only: that table's
// own matching is by words ("claude-opus-5-6" would take the "claude-opus-5" row) and a wrong price is worse than
// none. A model in neither has no price: its runs stay without a cost («prezzo sconosciuto»), never a silent 0. Pure but for the registry it is given; used by
// ChatManager.runMetrics (agents/standing.ts listCost). Unit tests: test/unit/agents/model-standing.test.ts.
import type { ModelRegistry } from '../../shared/contract';
import { priceRows } from '../chats/cursor-prices';
import type { PriceOf, TokenPrice } from './standing';

/** "openai/gpt-6-astra[1m]" → "gpt-6-astra"; dots and dashes compare alike ("claude-opus-5.5" = "claude-opus-5-5");
 *  a dated id is its model ("claude-opus-5-5-20261001"). */
const key = (model: string): string => model.toLowerCase().trim().replace(/\[.*\]$/, '').split('/').pop()!.replace(/-\d{8}$/, '').replace(/\./g, '-').trim();

export function tokenPriceOf(registry: () => ModelRegistry | null): PriceOf {
  return model => {
    const id = key(model);
    if (!id) return null;
    const row = registry()?.models?.find(m => key(m.id) === id || (m.aliases ?? []).some(a => key(a) === id));
    if (row?.price) return { input: row.price.input, cacheRead: row.price.cacheRead, cacheWrite: row.price.cacheWrite5m, output: row.price.output } satisfies TokenPrice;
    const listed = priceRows().find(([name]) => key(name) === id)?.[1];
    return listed ? { input: listed.input, cacheRead: listed.cacheRead, cacheWrite: listed.cacheWrite, output: listed.output } : null;
  };
}
