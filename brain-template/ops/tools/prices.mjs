// prices: the $ of one API response from the ONE price table, harness/models.json. Real per-model
// list prices: input, cache write 5 min and 1 h (usage.cache_creation splits them; absent = 5 min), cache read, output;
// Haiku 5.5's higher prices for prompts over 100k tokens; fast mode (usage.speed 'fast'); US-only inference ×1.1;
// web searches. A model not in the table is priced as the table's defaultModel and reported as unpriced, never 0.
// Used by cost.mjs and estimates.mjs (the second-brain app reads the same JSON).
// Usage: node "{{BRAIN}}/ops/tools/prices.mjs" [<model>]   → the price row(s) of the table
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brainRoot } from './brain-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The brain's own table; a fresh brain has none (the app owns it, ADR 0072): the app-owned copy's, next to this tool.
const OWN_TABLE = path.join(brainRoot(import.meta.url), 'harness', 'models.json');
export const TABLE_FILE = fs.existsSync(OWN_TABLE) ? OWN_TABLE : path.resolve(HERE, '..', '..', 'harness', 'models.json');

let cached = null;
/** The registry (harness/models.json); `file` only for tests. */
export function registry(file = TABLE_FILE) {
  if (!cached || cached.file !== file) cached = { file, t: JSON.parse(fs.readFileSync(file, 'utf8')) };
  return cached.t;
}

// "claude-opus-5-5[1m]" → "claude-opus-5-5"; "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
const bare = m => String(m ?? '').toLowerCase().trim().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');

/** The table row of a model id or alias; null when unknown. */
export function modelRow(model, t = registry()) {
  const id = bare(model);
  if (!id) return null;
  return t.models.find(r => r.id === id) ?? t.models.find(r => (r.aliases ?? []).includes(id)) ?? t.models.find(r => r.id === `claude-${id}`) ?? null;
}

const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** USD of one response's `usage` (Claude API shape). { usd, priced: false } when the model is not in the table. */
export function priceUsage(u = {}, model = '', t = registry()) {
  const row = modelRow(model, t);
  const r = row ?? modelRow(t.defaultModel, t);
  const cc = u.cache_creation ?? null;
  const w1h = cc ? n(cc.ephemeral_1h_input_tokens) : 0;
  const w5m = cc ? n(cc.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens);
  const prompt = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
  const p = r.longPrompt && prompt > r.longPrompt.over ? r.longPrompt.price : r.price;
  let usd = (n(u.input_tokens) * p.input + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h + n(u.cache_read_input_tokens) * p.cacheRead + n(u.output_tokens) * p.output) / 1e6;
  if (u.speed === 'fast' && r.fastFactor) usd *= r.fastFactor;
  if (/^us/i.test(String(u.inference_geo ?? '')) && !r.noGeo) usd *= t.modifiers?.usGeo ?? 1;
  usd += n(u.server_tool_use?.web_search_requests) * (t.modifiers?.webSearchPerRequest ?? 0);
  return { usd, priced: !!row };
}

/** Shortcut: the $ only. */
export const usdOf = (u, model, t) => priceUsage(u, model, t).usd;

/** $ per token of re-reading the context from the cache, for a model (what a long chat pays at every call). */
export const cacheReadPerToken = (model, t = registry()) => (modelRow(model, t) ?? modelRow(t.defaultModel, t)).price.cacheRead / 1e6;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const t = registry(), m = process.argv[2];
  const rows = m ? [modelRow(m, t)].filter(Boolean) : t.models;
  if (!rows.length) { console.log(`${m}: non è nella tabella (harness/models.json)`); process.exit(1); }
  for (const r of rows) console.log(`${r.id} (${r.harness}, ${r.routing}): input ${r.price.input} · scrittura cache ${r.price.cacheWrite5m}/${r.price.cacheWrite1h} · lettura cache ${r.price.cacheRead} · output ${r.price.output} $/M · sforzi ${r.efforts.join(', ') || '-'}`);
}
