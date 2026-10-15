// Text-only model calls on the user's Anthropic API key (ADR 0052): one prompt in, one text out, no tools. Why: the
// user's Claude Max plan includes monthly API credits that do not pay Claude Code, and the user wants the work that only
// needs text (the brain's sample judge, ops/improve/routing-judge.mjs; the comparison report's writer,
// harness/compare/writer.mjs) to spend those instead of the plan's limits. Available only while the Anthropic API engine
// (engines/registry.ts anthropicApi) is on and trusted and has a key; otherwise `unavailable`, and the caller takes the
// road of before (its headless Claude Code run), without an error.
// Safety: the key is read right before the request and lives only in its x-api-key header (never in a result, an error
// or a log: provider messages are redacted); redirects are refused; the endpoint must pass checkBaseUrl (https). Only
// the purpose, model, timing, usage and cost are logged, never the prompt or the answer. Each answered request adds its
// list-price cost to the month's spend (spend.ts). Reached by the brain's scripts only through the local MCP mount
// /mcp/text/<token> (wiring.ts), whose token only the app's own brain processes get. Unit-tested in
// test/unit/engines/text.test.ts.
import type { Effort, Harness, Settings } from '../../shared/contract';
import { EFFORTS } from '../brain/routing';
import { checkBaseUrl, usageCost, type Usage } from '../chats/api';
import { listPrice } from '../chats/live-cost';
import { cut } from '../chats/session';
import { errText, log } from '../log';
import { engineOn } from './policy';
import { anthropicApi, priceEnginesOf } from './registry';
import type { ApiSpend } from './spend';

export interface TextRequest {
  /** who asks, for the log and the spend ("routing-judge", "compare-writer") */
  purpose: string;
  /** a Claude model id of the brain's table ("claude-opus-5-5") */
  model: string;
  effort?: Effort | null;
  system?: string;
  prompt: string;
  /** the answer's cap, thinking included (default 16000) */
  maxTokens?: number;
}

export type TextResult =
  | { ok: true; text: string; usd: number | null; model: string; engine: Harness; usage: Usage }
  /** no key, engine off or not trusted: the caller uses its own road, nothing was sent */
  | { ok: false; unavailable: true; reason: string }
  /** the request went out and failed (Italian, no secrets); usd = what an answered but unusable request cost */
  | { ok: false; unavailable?: false; error: string; usd?: number | null };

export interface TextDeps {
  settings: () => Pick<Settings, 'engineOn'>;
  /** main only: the user's key for this engine, or null */
  keyFor: (id: Harness) => string | null;
  spend: Pick<ApiSpend, 'add'>;
  fetchImpl?: typeof fetch;
  /** whole request (ms); default 15 min: a long prompt at medium effort can think for minutes */
  timeoutMs?: number;
}

export const TEXT_MAX_PROMPT = 1_500_000;
export const TEXT_MAX_TOKENS = 32_000;
const DEFAULT_MAX_TOKENS = 16_000;
const TIMEOUT_MS = 15 * 60_000;
const PURPOSE = /^[a-z][a-z0-9-]{0,39}$/;
const MODEL = /^claude-[a-z0-9.-]{1,60}$/;

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** A request from outside main (the MCP tool's arguments) checked field by field, or why not (Italian). */
export function checkTextRequest(a: unknown): TextRequest | string {
  const r = o(a);
  if (typeof r.purpose !== 'string' || !PURPOSE.test(r.purpose)) return 'purpose: minuscole, cifre e trattini (es. routing-judge)';
  if (typeof r.model !== 'string' || !MODEL.test(r.model)) return 'model: un id Claude (es. claude-opus-5-5)';
  if (r.effort !== undefined && r.effort !== null && !(EFFORTS as readonly unknown[]).includes(r.effort)) return `effort: ${EFFORTS.join(' | ')}`;
  if (typeof r.prompt !== 'string' || !r.prompt.trim() || r.prompt.length > TEXT_MAX_PROMPT) return `prompt: testo da 1 a ${TEXT_MAX_PROMPT} caratteri`;
  if (r.system !== undefined && (typeof r.system !== 'string' || r.system.length > 100_000)) return 'system: testo fino a 100000 caratteri';
  if (r.maxTokens !== undefined && !(Number.isInteger(r.maxTokens) && (r.maxTokens as number) >= 1 && (r.maxTokens as number) <= TEXT_MAX_TOKENS)) return `maxTokens: da 1 a ${TEXT_MAX_TOKENS}`;
  return {
    purpose: r.purpose, model: r.model, prompt: r.prompt,
    ...(r.effort ? { effort: r.effort as Effort } : {}), ...(typeof r.system === 'string' && r.system ? { system: r.system } : {}),
    ...(typeof r.maxTokens === 'number' ? { maxTokens: r.maxTokens } : {}),
  };
}

export class TextModel {
  constructor(private readonly d: TextDeps) {}

  /** The engine a call would use now, or why none (Italian). Never decrypts the key: only whether one is usable. */
  private ready(): { engine: NonNullable<ReturnType<typeof anthropicApi>>; key: () => string | null } | { reason: string } {
    const e = anthropicApi();
    if (!e) return { reason: 'nessun motore Anthropic API' };
    if (!engineOn(this.d.settings(), e.id)) return { reason: `${e.label} è spento nelle impostazioni` };
    return { engine: e, key: () => this.d.keyFor(e.id) };
  }

  async complete(req: TextRequest, signal?: AbortSignal): Promise<TextResult> {
    const r = this.ready();
    if ('reason' in r) return { ok: false, unavailable: true, reason: r.reason };
    const { engine } = r;
    let key: string | null = null;
    try { key = r.key(); } catch (e) { log.warn('engines', 'api key not readable', { data: errText(e), cause: 'the key store failed to decrypt', hint: 'set the key again in Settings → Motori' }); }
    if (!key) return { ok: false, unavailable: true, reason: `manca la chiave di ${engine.label} (Impostazioni → Motori)` };
    const checked = checkBaseUrl(engine.baseUrl ?? '');
    if ('error' in checked) return { ok: false, error: checked.error };
    const host = checked.url.host;
    const redact = (t: string): string => t.split(key!).join('***').replace(/\bsk-[\w-]{6,}/g, 'sk-***');
    const body = {
      model: req.model, max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.prompt }],
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    };
    const t0 = Date.now();
    const timeout = AbortSignal.timeout(this.d.timeoutMs ?? TIMEOUT_MS);
    const done = (fields: Obj) => log.info('engines', 'api text call', { data: { purpose: req.purpose, model: req.model, effort: req.effort ?? null, host, ms: Date.now() - t0, promptChars: req.prompt.length, ...fields } });
    let res: Response;
    try {
      res = await (this.d.fetchImpl ?? fetch)(`${checked.url.href.replace(/\/+$/, '')}/messages`, {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const why = timeout.aborted ? `${host} non ha risposto entro ${Math.round((this.d.timeoutMs ?? TIMEOUT_MS) / 60_000)} min`
        : signal?.aborted ? 'richiesta annullata' : `rete: ${host} non raggiungibile`;
      done({ error: why, cause: redact(errText(e)) });
      return { ok: false, error: why };
    }
    let json: Obj = {};
    const raw = await res.text().catch(() => '');
    try { json = o(JSON.parse(raw)); } catch { /* not JSON */ }
    if (!res.ok) {
      const s = res.status, detail = cut(redact(typeof o(json.error).message === 'string' ? String(o(json.error).message) : ''), 200);
      const why = s === 401 || s === 403 ? `chiave API rifiutata da ${host}`
        : s === 429 ? `troppe richieste a ${host} (429), o crediti finiti`
          : s >= 500 ? `${host} ha un problema (errore ${s})`
            : `richiesta rifiutata da ${host} (${s})${detail ? `: ${detail}` : ''}`;
      done({ status: s, error: why });
      return { ok: false, error: why };
    }
    const u = o(json.usage);
    const usage: Usage = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
    const model = typeof json.model === 'string' ? json.model : req.model;
    const price = listPrice(priceEnginesOf(engine), model) ?? listPrice(priceEnginesOf(engine), req.model);
    const usd = price ? usageCost(usage, price) : null;
    this.d.spend.add(engine.id, usd);
    const text = (Array.isArray(json.content) ? json.content : []).map(b => (o(b).type === 'text' && typeof o(b).text === 'string' ? String(o(b).text) : '')).join('');
    const stop = typeof json.stop_reason === 'string' ? json.stop_reason : '';
    done({ usage, usd, stop });
    if (stop === 'refusal') return { ok: false, error: `${host} ha rifiutato la richiesta (stop_reason refusal)`, usd };
    if (stop === 'max_tokens') return { ok: false, error: `risposta tagliata: superato il tetto di ${body.max_tokens} token`, usd };
    if (!text.trim()) return { ok: false, error: `${host} ha risposto senza testo`, usd };
    return { ok: true, text, usd, model, engine: engine.id, usage };
  }
}
