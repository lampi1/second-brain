// Live cost of a Claude turn while it runs. Why: the CLI reports the real cost only in the `result` at the end of a
// turn, and a work chat can stay in one turn for hours (messages sent meanwhile join the same turn), so its tile read
// 0 $ all along while the Regia, with short turns, went up (the user, 2026-10-11). Every stream-json `assistant`
// message carries its API `usage`; this module prices it with the brain's price table (harness/models.json, the same
// one ops/tools/prices.mjs and cost.mjs use for the top bar's "Oggi": real per-model list prices, ADR 0032), so the
// live figure and the day total agree; without a brain the Opus 5.5 list price stands in. The CLI repeats a message
// once per content block with the same id: the highest count per field wins. Subagent messages count too (they are
// billed). The estimate is corrected with the real running cost whenever a get_usage answer comes (settle()) and
// replaced by the real figure when the result arrives (reset()). Used by claude.ts; wiring.ts sets the table.
import type { ModelRegistry, RegistryModel } from '../../shared/contract';

export interface ApiUsage {
  input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string; inference_geo?: string;
}

/** Opus 5.5 list price (USD per million tokens), for when the brain's table is not there. */
const FALLBACK: RegistryModel = {
  id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', routing: 'auto', efforts: [], defaultEffort: null, fastFactor: 2,
  price: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
};
let table: () => ModelRegistry | null = () => null;
/** wiring.ts: where the price table comes from (the brain's harness/models.json, re-read when it changes). */
export function setPriceTable(fn: () => ModelRegistry | null): void { table = fn; }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const bare = (m: string): string => m.toLowerCase().trim().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
function rowOf(model: string, reg: ModelRegistry | null): RegistryModel {
  if (!reg?.models) return FALLBACK;
  const find = (m: string): RegistryModel | undefined => {
    const id = bare(m);
    return reg.models.find(r => r.id === id) ?? reg.models.find(r => (r.aliases ?? []).includes(id)) ?? reg.models.find(r => r.id === `claude-${id}`);
  };
  return find(model) ?? find(reg.defaultModel) ?? FALLBACK;
}

/** USD of one API response at list price (an equivalent cost on a subscription); prices.mjs priceUsage, web searches
 *  aside (they are not in stream-json's per-message usage). */
export function priceUsage(model: string, u: ApiUsage, reg: ModelRegistry | null = table()): number {
  const r = rowOf(model, reg);
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  const w1h = cc ? n(cc.ephemeral_1h_input_tokens) : 0;
  const w5m = cc ? n(cc.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens);
  const prompt = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
  const p = r.longPrompt && prompt > r.longPrompt.over ? r.longPrompt.price : r.price;
  let usd = (n(u.input_tokens) * p.input + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h + n(u.cache_read_input_tokens) * p.cacheRead + n(u.output_tokens) * p.output) / 1e6;
  if (u.speed === 'fast' && r.fastFactor) usd *= r.fastFactor;
  if (/^us/i.test(String(u.inference_geo ?? '')) && !r.noGeo) usd *= reg?.modifiers?.usGeo ?? 1;
  return usd;
}

/** An API engine's list prices for a model of its own (ADR 0046): only a row of that engine in the brain's models.json,
 *  never the Claude fallback (an unknown price = cost unknown, not a wrong one). */
export function listPrice(engine: string, model: string, reg: ModelRegistry | null = table()): { inputPerMTok: number; outputPerMTok: number } | null {
  const id = bare(model);
  const r = reg?.models?.find(m => m.harness === engine && (m.id === id || (m.aliases ?? []).includes(id)));
  return r ? { inputPerMTok: r.price.input, outputPerMTok: r.price.output } : null;
}

/** An engine's models in the brain's table (an HTTP engine has no CLI to list them: these are its choices). */
export function registryModels(engine: string, reg: ModelRegistry | null = table()): { id: string; name: string }[] {
  return (reg?.models ?? []).filter(m => m.harness === engine).map(m => ({ id: m.id, name: m.id }));
}

interface Seen { model: string; u: ApiUsage }
const max = (a: unknown, b: unknown): number => Math.max(n(a), n(b));

export class LiveCost {
  private seen = new Map<string, Seen>();
  private total = 0;

  /** A stream-json `assistant` message; true when the estimate changed. */
  add(m: Record<string, unknown>): boolean {
    const msg = m.message && typeof m.message === 'object' ? (m.message as Record<string, unknown>) : null;
    const usage = msg?.usage && typeof msg.usage === 'object' ? (msg.usage as ApiUsage) : null;
    const id = typeof msg?.id === 'string' ? msg.id : '';
    if (!usage || !id) return false;
    const model = typeof msg?.model === 'string' ? msg.model : '';
    const prev = this.seen.get(id);
    const pu = prev?.u ?? {};
    const cc = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
    const u: ApiUsage = {
      input_tokens: max(usage.input_tokens, pu.input_tokens),
      output_tokens: max(usage.output_tokens, pu.output_tokens),
      cache_creation_input_tokens: max(usage.cache_creation_input_tokens, pu.cache_creation_input_tokens),
      cache_read_input_tokens: max(usage.cache_read_input_tokens, pu.cache_read_input_tokens),
      ...(cc || pu.cache_creation ? { cache_creation: {
        ephemeral_5m_input_tokens: max(cc?.ephemeral_5m_input_tokens, pu.cache_creation?.ephemeral_5m_input_tokens),
        ephemeral_1h_input_tokens: max(cc?.ephemeral_1h_input_tokens, pu.cache_creation?.ephemeral_1h_input_tokens),
      } } : {}),
      ...(usage.speed ?? pu.speed ? { speed: usage.speed ?? pu.speed } : {}),
      ...(usage.inference_geo ?? pu.inference_geo ? { inference_geo: usage.inference_geo ?? pu.inference_geo } : {}),
    };
    const before = prev ? priceUsage(prev.model, prev.u) : 0;
    const after = priceUsage(model, u);
    if (after === before) return false;
    this.seen.set(id, { model, u });
    this.total += after - before;
    return true;
  }

  /** The running turn's estimate so far, USD rounded to the micro-dollar. */
  usd(): number { return Math.round(this.total * 1e6) / 1e6; }

  /** The real cost of the turn so far (Claude's get_usage mid-turn): it replaces the estimate; later messages add on top
   *  (a message already seen adds only its growth). True when the figure changed. */
  settle(usd: number): boolean {
    if (!Number.isFinite(usd) || usd < 0 || Math.abs(usd - this.total) < 1e-9) return false;
    this.total = usd;
    return true;
  }

  /** The turn ended (its real cost is known): start over. */
  reset(): void { this.seen.clear(); this.total = 0; }
}
