// The live model lists (ADR 0256): each engine's models from its own source, never from a list typed into the app.
// Why: the owner, 2026-11-10, «a new model appears without an app update or a manual edit» (Fable 5.2 came out and the
// pickers did not show it: the Claude list came only from the brain's harness/models.json, which acted as an allow-list).
// Sources, one per engine kind, none of which spends a token:
//   claude  Claude Code's own `initialize` reply (stream-json control_request): `models` [{value, resolvedModel,
//           displayName, supportedEffortLevels}], what the user's login can run; no prompt is ever sent
//   codex   `codex app-server`: initialize, then model/list {data:[{model|id, displayName, hidden}]}
//   acp     any ACP CLI (Cursor, OpenCode, a catalog engine): only what its chats' session/new listed (acpModels
//           parses the same shape). It is never started only to ask: rule 4 (`agent` only for Cursor chats) and a
//           session/new would leave an empty session in the user's own history
//   api     the endpoint's own listing with the engine's own key (ADR 0046: the key goes only to its engine's header):
//           OpenAI-compatible GET <baseUrl>/models, Anthropic GET <baseUrl>/models (the Models API)
// The result goes to the ModelsSeenStore (brain/models-seen.ts), which is the cache. Fallback when a source fails: the
// last cached list stays; an engine with no list at all reads the brain's models.json (engines/sessions.ts
// withApiModels). Every failure is logged. Refreshed on a schedule (start) and on demand ('models:refresh', the model
// picker's «Aggiorna elenco»). The process side (spawning a CLI) is injected: model-probe.ts in the app, fakes in the
// tests (test/unit/engines/model-lists.test.ts). Wired by wiring.ts.
import type { Effort, Harness, ModelRefreshOutcome, ModelsSeen, SeenModel } from '../../shared/contract';
import { cleanModels } from '../brain/models-seen';
import { errText, log } from '../log';
import type { EngineDef } from './registry';

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const window = (v: unknown): number | undefined => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : undefined);

// ── parsers (pure: the same shapes the chats' sessions read) ─────────────────────────────────────────────────────────

/** Claude Code's initialize `models`: one row per real model (an alias such as "opus" or "default" is listed under the
 *  id it resolves to), its name, and the effort levels it takes (none when it says it takes no effort). */
export function claudeModels(models: unknown): SeenModel[] {
  const out: SeenModel[] = [];
  for (const raw of arr(models)) {
    const m = o(raw), value = s(m.value), id = s(m.resolvedModel) || value;
    if (!id || value === 'default') continue; // «Default (recommended)»: the picker has its own default row
    const name = (s(m.displayName) || id).replace(/\s*\((?:recommended|consigliato)\)\s*$/i, '');
    const efforts = m.supportsEffort === true ? EFFORTS.filter(e => arr(m.supportedEffortLevels).includes(e)) : [];
    out.push({ id, name, efforts });
  }
  return cleanModels(out);
}

/** Codex's model/list result (hidden models left out). */
export function codexModels(result: unknown): SeenModel[] {
  return cleanModels(arr(o(result).data).map(o).filter(m => m.hidden !== true)
    .map(m => ({ id: s(m.model) || s(m.id), name: s(m.displayName) || s(m.model) || s(m.id) })));
}

/** An ACP session/new (or session/load) result: models.availableModels, else the configOptions entry of category model. */
export function acpModels(result: unknown): SeenModel[] {
  const r = o(result), m = o(r.models);
  if (arr(m.availableModels).length) return cleanModels(arr(m.availableModels).map(o).map(x => ({ id: s(x.modelId), name: s(x.name) })));
  const picker = arr(r.configOptions).map(o).find(c => c.category === 'model' && s(c.id));
  return cleanModels(arr(picker?.options).map(o).map(x => ({ id: s(x.value), name: s(x.name) || s(x.value) })));
}

/** An HTTP engine's model listing: OpenAI's {data:[{id}]} or the Anthropic Models API's {data:[{id, display_name,
 *  max_input_tokens}]} (OpenRouter's context_length too). */
export function httpModels(json: unknown): SeenModel[] {
  return cleanModels(arr(o(json).data).map(o).map(m => {
    const w = window(m.max_input_tokens) ?? window(m.context_length);
    return { id: s(m.id), name: s(m.display_name) || s(m.name) || s(m.id), ...(w ? { contextWindow: w } : {}) };
  }));
}

// ── talking to a CLI ────────────────────────────────────────────────────────────────────────────────────────────────

/** A started CLI, one JSON object per line each way (model-probe.ts). reply() waits for the first incoming object the
 *  match accepts, or rejects when the CLI exits or the time runs out. */
export interface LineChannel {
  send(msg: Obj): void;
  reply(match: (msg: Obj) => boolean, timeoutMs: number): Promise<Obj>;
  close(): void;
}
/** Starts an engine's CLI only to list its models; an error = it cannot start (not installed, not allowed). */
export type OpenProbe = (engine: EngineDef) => LineChannel | { error: string };
export type FetchJson = (url: string, headers: Record<string, string>) => Promise<unknown>;

const STEP_MS = 30_000;
const rpcError = (m: Obj): string | null => (m.error ? s(o(m.error).message) || 'errore senza messaggio' : null);
async function call(ch: LineChannel, id: number, method: string, params: Obj, jsonrpc: boolean): Promise<Obj> {
  ch.send({ ...(jsonrpc ? { jsonrpc: '2.0' } : {}), id, method, params });
  const m = await ch.reply(x => x.id === id, STEP_MS);
  const err = rpcError(m);
  if (err) throw new Error(`${method}: ${err}`);
  return o(m.result);
}

async function claudeList(ch: LineChannel): Promise<SeenModel[]> {
  ch.send({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } });
  const m = await ch.reply(x => x.type === 'control_response' && o(x.response).request_id === 'models', STEP_MS);
  const r = o(m.response);
  if (r.subtype === 'error') throw new Error(`initialize: ${s(r.error) || 'errore'}`);
  return claudeModels(o(r.response).models);
}

async function codexList(ch: LineChannel, appVersion: string): Promise<SeenModel[]> {
  await call(ch, 1, 'initialize', { clientInfo: { name: 'second_brain', title: 'second-brain', version: appVersion }, capabilities: { experimentalApi: false } }, false);
  ch.send({ method: 'initialized', params: {} });
  return codexModels(await call(ch, 2, 'model/list', {}, false));
}


async function apiList(e: EngineDef, key: string, fetchJson: FetchJson): Promise<SeenModel[]> {
  const base = (e.baseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('motore senza indirizzo');
  const anthropic = e.protocol === 'anthropic';
  const headers: Record<string, string> = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` };
  return httpModels(await fetchJson(`${base}/models${anthropic ? '?limit=1000' : ''}`, headers));
}

// ── the service ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ModelListDeps {
  /** the engines to ask: turned on and trusted (policy.ts engineOn) */
  engines: () => readonly EngineDef[];
  open: OpenProbe;
  fetchJson: FetchJson;
  /** the engine's own API key (engines/secrets.ts); null = none */
  key: (engine: Harness) => string | null;
  store: { get(): ModelsSeen; record(engine: Harness, list: SeenModel[]): void };
  /** the brain's models.json rows of an engine (the last fallback), to say what the picker shows after a failure */
  registry: (engine: EngineDef) => readonly { id: string }[];
  appVersion: string;
  /** after a refresh that changed a list: the pickers re-read (agent catalog refresh) */
  changed?: () => void;
}

const HOUR = 3_600_000;
/** How often the lists refresh by themselves, and how long after the start the first one runs. */
export const REFRESH_EVERY_MS = 6 * HOUR;
export const FIRST_REFRESH_MS = 2 * 60_000;

export class ModelLists {
  private running: Promise<ModelRefreshOutcome[]> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  constructor(private readonly d: ModelListDeps) {}

  private open = new Set<LineChannel>();

  /** One engine's models from its live source now; throws why not. */
  async live(e: EngineDef): Promise<SeenModel[]> {
    if (e.kind === 'acp') throw new Error('elenco dalle sue chat (la CLI non parte solo per chiedere)');
    if (e.kind === 'api') {
      const key = this.d.key(e.id);
      if (!key) throw new Error('nessuna chiave API');
      return apiList(e, key, this.d.fetchJson);
    }
    const ch = this.d.open(e);
    if ('error' in ch) throw new Error(ch.error);
    this.open.add(ch);
    try {
      return e.kind === 'claude' ? await claudeList(ch) : await codexList(ch, this.d.appVersion);
    } finally { this.open.delete(ch); ch.close(); }
  }

  /** Ask each engine (or the one named) now. A list read replaces the cached one; a failure keeps it and is logged.
   *  A refresh already running is joined, never doubled. */
  refresh(only?: Harness): Promise<ModelRefreshOutcome[]> {
    if (this.running && !only) return this.running;
    const run = this.run(only).finally(() => { if (this.running === run) this.running = null; });
    if (!only) this.running = run;
    return run;
  }

  private async run(only?: Harness): Promise<ModelRefreshOutcome[]> {
    const targets = this.d.engines().filter(e => !only || e.id === only);
    const before = JSON.stringify(this.d.store.get());
    const out = await Promise.all(targets.map(async (e): Promise<ModelRefreshOutcome> => {
      try {
        const list = await this.live(e);
        if (!list.length) throw new Error('la sorgente non ha elencato modelli');
        this.d.store.record(e.id, list);
        return { engine: e.id, ok: true, count: list.length };
      } catch (err) {
        const error = errText(err).slice(0, 300);
        const cached = this.d.store.get()[e.id]?.ids.length ?? 0, rows = this.d.registry(e).length;
        const using = cached ? 'cache' as const : rows ? 'registry' as const : 'none' as const;
        log.warn('engines', 'model list not refreshed', { cause: error, hint: using === 'cache' ? 'the last list stays; check the engine login and install (Impostazioni → Motori)' : using === 'registry' ? 'the brain\'s harness/models.json rows are shown until the engine answers' : 'no list yet: the picker offers the engine default only', data: { engine: e.id, using } });
        return { engine: e.id, ok: false, count: cached || rows, error, using };
      }
    }));
    if (JSON.stringify(this.d.store.get()) !== before) this.d.changed?.();
    return out;
  }

  /** The scheduled refresh: once soon after the start, then every REFRESH_EVERY_MS. Timers never keep the app alive. */
  start(every = REFRESH_EVERY_MS, first = FIRST_REFRESH_MS): void {
    this.stop();
    const tick = (): void => { void this.refresh(); };
    const a = setTimeout(tick, first), b = setInterval(tick, every);
    for (const t of [a, b]) (t as { unref?: () => void }).unref?.();
    this.timers = [a, b];
  }

  /** The timers off and every CLI still answering closed (the app quits). */
  stop(): void {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
    for (const ch of this.open) ch.close();
    this.open.clear();
  }
}
