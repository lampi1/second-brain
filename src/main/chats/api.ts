// One chat on an HTTP model endpoint (ADR 0046, engine kind "api"): text only, no tools, no process. Two protocols:
//   openai:    POST <baseUrl>/chat/completions, Authorization: Bearer <key>, stream + stream_options.include_usage
//              (OpenAI-compatible endpoints: private, DeepSeek, Moonshot, …); SSE chunks choices[0].delta.content,
//              the last one carries usage {prompt_tokens, completion_tokens}; "data: [DONE]" ends it.
//   anthropic: POST <baseUrl>/messages, x-api-key + anthropic-version 2023-06-01, stream, max_tokens; SSE events
//              message_start (input usage), content_block_delta (text_delta), message_delta (output usage), error.
// Why: an HTTP model is a chat like the others for the manager (it implements HarnessSession and reports through the
// SessionSink); the user's key never leaves main. Safety: the key is read through opts.apiKey() right before each
// request and lives only in that request's headers (never in a field, an item, the history file, an error or a log);
// redirects are refused (the key never follows one to another host); plain http only towards this computer; the
// first byte must come within a timeout. The conversation is kept in historyFile (messages only) so a chat resumes
// after a restart. Used by engines/sessions.ts (sessionFor, kind "api").
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatItem, ChatState, Effort, ImageAttachment, PermissionMode } from '../../shared/contract';
import { errText, log } from '../log';
import type { Root } from './proctree';
import { cut, lastLine, nextId, type ContextUsage, type HarnessSession, type SessionOptions, type SessionSink } from './session';

export type ApiProtocol = 'openai' | 'anthropic';

export interface ApiOptions extends SessionOptions {
  /** the engine's id (= the chat's harness) */
  engineId: string;
  protocol: ApiProtocol;
  /** e.g. https://api.deepseek.com/v1 (no trailing path: /chat/completions or /messages is added) */
  baseUrl: string;
  /** the key, decrypted on demand right before each request; null = not set */
  apiKey: () => string | null;
  /** JSON file with the conversation's messages (no key, no headers) */
  historyFile: string;
  /** on resume, show the saved past (a chat restored after a restart has no items) */
  showReplay?: boolean;
  /** a model's list prices in USD per million tokens (the model may change between turns); null or absent = unknown */
  pricesOf?: (model: string) => { inputPerMTok: number; outputPerMTok: number } | null;
  /** the answer's token cap (Anthropic requires one) */
  maxTokens?: number;
  /** ms to wait for the response headers and then for the first event (tests shorten it) */
  firstByteMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiMessage { role: 'user' | 'assistant'; content: string }
interface History { version: 1; sessionId: string; messages: ApiMessage[] }
interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
/** user: the user's Stop / "Invia subito" · app: the app's own interrupt · close: the chat closes · timeout: no first byte */
type Stop = 'user' | 'app' | 'close' | 'timeout';

export const MISSING_KEY = 'Manca la chiave API: impostala in Impostazioni → Motori.';
export const TEXT_ONLY = 'Questo motore accetta solo testo: le immagini non sono state inviate.';
const DEFAULT_MAX_TOKENS = 8192;
const FIRST_BYTE_MS = 60_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** The endpoint's URL, or why it is refused: https only, plain http only towards this computer; no credentials in it. */
export function checkBaseUrl(baseUrl: string): { url: URL } | { error: string } {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return { error: `Indirizzo del motore non valido: ${cut(baseUrl, 120)}` }; }
  if (url.username || url.password) return { error: 'L’indirizzo del motore non può contenere credenziali: la chiave va in Impostazioni → Motori.' };
  if (url.protocol === 'https:') return { url };
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return { url };
  return { error: `Indirizzo non sicuro (${url.protocol}//${url.host}): serve https, http solo verso questo computer (127.0.0.1, localhost).` };
}

/** The saved conversation, or [] when the file is missing or unreadable. */
export function readHistory(file: string): ApiMessage[] {
  try {
    const h = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<History>;
    return Array.isArray(h.messages)
      ? h.messages.filter((m): m is ApiMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [];
  } catch { return []; }
}

/** The saved conversation as chat items (a chat restored after a restart shows its past). */
export function historyItems(file: string): ChatItem[] {
  let at = 0;
  try { at = fs.statSync(file).mtimeMs; } catch { return []; }
  return readHistory(file).map((m, i): ChatItem => (m.role === 'user'
    ? { kind: 'user', id: `h-${i}`, at, text: m.content }
    : { kind: 'assistant', id: `h-${i}`, at, text: m.content }));
}

/** Consecutive messages of one role merged (a turn cut before any answer leaves two user messages in a row). */
function alternate(messages: readonly ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of messages) {
    const prev = out.at(-1);
    if (prev && prev.role === m.role) out[out.length - 1] = { role: m.role, content: `${prev.content}\n\n${m.content}` };
    else out.push({ ...m });
  }
  return out;
}

/** Server-sent events: each complete event's joined data lines (comments and other fields ignored). */
function* sseEvents(buf: { text: string }): Generator<string> {
  for (;;) {
    const m = /\r?\n\r?\n/.exec(buf.text);
    if (!m) return;
    const block = buf.text.slice(0, m.index);
    buf.text = buf.text.slice(m.index + m[0].length);
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, ''));
    if (data.length) yield data.join('\n');
  }
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class ApiSession implements HarnessSession {
  readonly harness: string;
  state: ChatState = 'starting';
  sessionId: string | null = null;
  readonly pid = null;
  readonly root: Root | null = null;
  private model: string | null;
  private messages: ApiMessage[] = [];
  private queue: string[] = [];
  private host = '';
  private url: URL | null = null;
  private turn: { ctrl: AbortController; stop: Stop | null; sendNow: boolean } | null = null;
  private exited = false;

  constructor(private readonly opts: ApiOptions, private readonly sink: SessionSink) {
    this.harness = opts.engineId;
    this.model = opts.model ?? null;
  }

  get alive(): boolean { return !this.exited; }
  get busy(): boolean { return !this.exited && (!!this.turn || this.queue.length > 0); }

  start(): void {
    const checked = checkBaseUrl(this.opts.baseUrl);
    if ('error' in checked) {
      log.error('chats', 'api session refused', { chat: this.opts.chatId, cause: `base URL refused: ${cut(this.opts.baseUrl, 200)}`, hint: 'use https (http only for 127.0.0.1/localhost) in the engine entry of harness/models.json' });
      return this.end('error', checked.error);
    }
    this.url = checked.url;
    this.host = checked.url.host;
    this.sessionId = this.opts.sessionId ?? crypto.randomUUID();
    if (this.opts.resume) this.messages = readHistory(this.opts.historyFile);
    if (this.opts.resume && this.opts.showReplay) for (const it of historyItems(this.opts.historyFile)) this.sink.item(it, false);
    log.info('chats', 'api session start', { chat: this.opts.chatId, data: { engine: this.harness, protocol: this.opts.protocol, host: this.host, model: this.model, resumed: this.messages.length } });
    this.sink.changed({ sessionId: this.sessionId, ...(this.model ? { model: this.model } : {}) });
    this.setState('idle');
  }

  send(text: string, images: readonly ImageAttachment[] = []): void {
    if (this.exited) throw new Error('La chat non è più attiva.');
    if (images.length) this.sys(TEXT_ONLY, 'warn');
    this.queue.push(text);
    this.setState('running');
    this.drain();
  }

  /** One request at a time: the next queued message goes when the previous turn ends. */
  private drain(): void {
    if (this.exited || this.turn) return;
    const text = this.queue.shift();
    if (text === undefined) return;
    this.messages.push({ role: 'user', content: text || '(solo immagini, non inviate)' });
    this.save();
    this.turn = { ctrl: new AbortController(), stop: null, sendNow: false };
    this.setState('running');
    void this.run(this.turn);
  }

  private async run(turn: NonNullable<ApiSession['turn']>): Promise<void> {
    const t0 = Date.now();
    const item: Extract<ChatItem, { kind: 'assistant' }> = { kind: 'assistant', id: nextId('a'), at: t0, text: '', streaming: true };
    let emitted = false;
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let error: string | null = null;
    const model = this.model; // the turn's model: a change during the turn applies to the next one, its price too
    try {
      await this.request(turn, model, delta => {
        item.text += delta;
        this.sink.item({ ...item }, emitted);
        emitted = true;
      }, usage);
    } catch (e) {
      error = turn.stop && turn.stop !== 'timeout' ? null : this.errorText(e, turn);
    }
    // the part already shown stays in the conversation (the next request carries it), also when the chat closed
    if (item.text) { this.messages.push({ role: 'assistant', content: item.text }); this.save(); }
    if (this.exited) return;
    if (emitted) this.sink.item({ ...item, streaming: false }, true);
    if (item.text) this.sink.changed({ lastText: lastLine(item.text) });
    const interrupted = turn.stop === 'user';
    if (error) this.sys(error, 'error');
    else if (interrupted) this.sys(turn.sendNow ? 'Interrotto da te: riparto col tuo messaggio.' : 'Interrotto da te.', 'info');
    else if (turn.stop === 'app') this.sys('Interrotto.', 'info');
    const cost = this.costOf(usage, model);
    this.sink.item({ kind: 'result', id: nextId('r'), at: Date.now(), costUsd: cost ?? 0, durationMs: Date.now() - t0, turns: 1, isError: !!error || turn.stop === 'app', ...(interrupted ? { interrupted } : {}) }, false);
    const context = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
    this.sink.changed({ turnCostUsd: cost ?? 0, costKnown: cost !== null, liveCostUsd: 0, ...(context ? { contextTokens: context, contextEstimated: false } : {}) });
    log.info('chats', 'api turn done', { chat: this.opts.chatId, data: { host: this.host, ms: Date.now() - t0, usage, costUsd: cost, stop: turn.stop, error } });
    this.turn = null;
    if (this.queue.length) this.drain();
    else this.setState('idle');
  }

  /** One streamed request. Throws on any failure; the caller turns it into an Italian line (errorText). */
  private async request(turn: NonNullable<ApiSession['turn']>, model: string | null, onText: (t: string) => void, usage: Usage): Promise<void> {
    let key: string | null = null;
    try { key = this.opts.apiKey(); } catch (e) { log.warn('chats', 'api key not readable', { chat: this.opts.chatId, data: errText(e), cause: 'the key store failed to decrypt', hint: 'set the key again in Settings → Motori' }); }
    if (!key) throw new ApiError(MISSING_KEY);
    if (!model) throw new ApiError('Manca il modello: sceglilo per questa chat.');
    const anthropic = this.opts.protocol === 'anthropic';
    const base = this.url!.href.replace(/\/+$/, '');
    const messages = alternate(this.messages);
    const maxTokens = this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const body = anthropic
      ? { model, max_tokens: maxTokens, stream: true, messages }
      : { model, stream: true, stream_options: { include_usage: true }, messages, ...(this.opts.maxTokens ? { max_tokens: maxTokens } : {}) };
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (anthropic) { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; } else headers.authorization = `Bearer ${key}`;
    const ms = this.opts.firstByteMs ?? FIRST_BYTE_MS;
    let timer: NodeJS.Timeout | null = setTimeout(() => { turn.stop = 'timeout'; turn.ctrl.abort(); }, ms);
    const firstByte = () => { if (timer) { clearTimeout(timer); timer = null; } };
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${base}${anthropic ? '/messages' : '/chat/completions'}`, {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: turn.ctrl.signal,
      });
      if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));
      if (!res.body) throw new ApiError(`${this.host} non ha mandato una risposta.`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      // an abort does not always reject a read already waiting on the body: race it, and let go of the body
      const signal = turn.ctrl.signal;
      const aborted = new Promise<never>((_, reject) => {
        const stop = () => { reader.cancel().catch(() => {}); reject(new Error('aborted')); };
        if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
      });
      aborted.catch(() => {});
      const buf = { text: '' };
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        firstByte();
        buf.text += value;
        for (const data of sseEvents(buf)) {
          if (data === '[DONE]') return;
          let ev: Obj;
          try { ev = o(JSON.parse(data)); } catch { continue; }
          if (anthropic ? this.anthropicEvent(ev, onText, usage) : this.openaiEvent(ev, onText, usage)) return;
        }
      }
    } finally { firstByte(); }
  }

  /** true = the stream is over */
  private openaiEvent(ev: Obj, onText: (t: string) => void, usage: Usage): boolean {
    if (ev.error) throw new ApiError(`Errore da ${this.host}: ${this.providerText(o(ev.error).message)}`);
    const delta = o(o((ev.choices as unknown[] | undefined)?.[0]).delta);
    if (typeof delta.content === 'string' && delta.content) onText(delta.content);
    const u = o(ev.usage);
    if (Object.keys(u).length) { usage.input = n(u.prompt_tokens); usage.output = n(u.completion_tokens); }
    return false;
  }

  private anthropicEvent(ev: Obj, onText: (t: string) => void, usage: Usage): boolean {
    switch (ev.type) {
      case 'message_start': {
        const u = o(o(ev.message).usage);
        usage.input = n(u.input_tokens); usage.cacheRead = n(u.cache_read_input_tokens); usage.cacheWrite = n(u.cache_creation_input_tokens);
        usage.output = n(u.output_tokens);
        return false;
      }
      case 'content_block_delta': {
        const d = o(ev.delta);
        if (d.type === 'text_delta' && typeof d.text === 'string' && d.text) onText(d.text);
        return false;
      }
      case 'message_delta': {
        const u = o(ev.usage);
        if (typeof u.output_tokens === 'number') usage.output = n(u.output_tokens);
        return false;
      }
      case 'message_stop': return true;
      case 'error': throw new ApiError(`Errore da ${this.host}: ${this.providerText(o(ev.error).message)}`);
      default: return false;
    }
  }

  /** USD at list price (cache reads 0.1×, cache writes 1.25× the input price, as Anthropic bills them); null = no prices. */
  private costOf(u: Usage, model: string | null): number | null {
    const p = model ? this.opts.pricesOf?.(model) : null;
    if (!p) return null;
    const input = u.input + u.cacheRead * 0.1 + u.cacheWrite * 1.25;
    return Math.round(((input * p.inputPerMTok + u.output * p.outputPerMTok) / 1e6) * 1e6) / 1e6;
  }

  /** A short Italian line; never the key, never a header. */
  private errorText(e: unknown, turn: NonNullable<ApiSession['turn']>): string {
    const host = this.host;
    if (turn.stop === 'timeout') return `${host} non ha risposto entro ${Math.round((this.opts.firstByteMs ?? FIRST_BYTE_MS) / 1000)} s.`;
    if (e instanceof ApiError) return this.redact(e.message);
    if (e instanceof HttpError) {
      const s = e.status;
      if (s === 401 || s === 403) return `Chiave API rifiutata da ${host}.`;
      if (s === 429) return `Troppe richieste a ${host} (429): riprova tra poco.`;
      if (s >= 500) return `${host} ha un problema (errore ${s}): riprova tra poco.`;
      if (s >= 300 && s < 400) return `${host} ha risposto con un reindirizzamento: richiesta non seguita.`;
      let detail = '';
      try { detail = this.providerText(o(o(JSON.parse(e.body)).error).message); } catch { /* not JSON */ }
      return `Richiesta rifiutata da ${host} (${s})${detail ? `: ${detail}` : '.'}`;
    }
    const cause = o((e as { cause?: unknown } | null)?.cause);
    const why = `${typeof cause.code === 'string' ? cause.code : ''} ${typeof cause.message === 'string' ? cause.message : ''}`;
    if (/redirect/i.test(why)) return `${host} ha risposto con un reindirizzamento: richiesta non seguita.`;
    log.warn('chats', 'api request failed', { chat: this.opts.chatId, data: { host, error: this.redact(errText(e)), cause: this.redact(why.trim()) } });
    return `Rete: ${host} non raggiungibile${typeof cause.code === 'string' ? ` (${cause.code})` : ''}.`;
  }

  /** A provider's own error message, shortened and with the key (if it echoed it) masked. */
  private providerText(v: unknown): string {
    return cut(this.redact(typeof v === 'string' ? v : 'errore sconosciuto'), 200);
  }

  private redact(text: string): string {
    let key: string | null = null;
    try { key = this.opts.apiKey(); } catch { /* unreadable: the shapes below still mask it */ }
    return (key ? text.split(key).join('***') : text).replace(/\b(Bearer\s+)\S+/gi, '$1***').replace(/\bsk-[\w-]{6,}/g, 'sk-***');
  }

  private save(): void {
    const file = this.opts.historyFile;
    const data: History = { version: 1, sessionId: this.sessionId ?? '', messages: this.messages };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (e) {
      log.warn('chats', 'api history not saved', { chat: this.opts.chatId, data: errText(e), cause: 'history file not writable', hint: 'check that the app data folder is writable' });
    }
  }

  answer(_requestId: string, _answer: Answer): boolean { return false; }

  async interrupt(opts?: { keepQueued?: boolean; byUser?: boolean }): Promise<void> {
    if (this.exited) return;
    if (this.queue.length && !opts?.keepQueued) { this.sys(`Messaggi in coda annullati: ${this.queue.length}.`, 'info'); this.queue = []; }
    const turn = this.turn;
    if (!turn) return this.setState('idle');
    // the user's own stop is no error ("Interrotto da te"); the app's own interrupt ends the turn as cut, like the CLIs
    turn.stop = opts?.byUser ? 'user' : 'app';
    turn.sendNow = !!opts?.byUser && !!opts.keepQueued;
    turn.ctrl.abort();
  }

  async setModel(model: string | null): Promise<void> {
    this.model = model;
    if (model) this.sink.changed({ model });
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    throw new Error('Questo motore non ha modalità dei permessi: è solo testo, senza strumenti.');
  }

  async setEffort(effort: Effort | null): Promise<void> {
    if (effort) throw new Error('L’effort non si imposta con questo motore: scegli il modello.');
  }

  async rename(_title: string): Promise<void> { /* the title lives in the app */ }
  async contextUsage(): Promise<ContextUsage | null> { return null; }
  async usage(): Promise<unknown> { return null; }

  close(): Promise<void> {
    if (this.exited) return Promise.resolve();
    if (this.turn) { this.turn.stop = 'close'; this.turn.ctrl.abort(); }
    this.end('closed', null);
    return Promise.resolve();
  }

  killNow(): void { void this.close(); }

  private end(state: ChatState, error: string | null): void {
    if (this.exited) return;
    this.exited = true;
    this.queue = [];
    this.setState(state);
    this.sink.exit({ code: error ? null : 0, error });
  }

  private setState(st: ChatState): void {
    if (this.state === st) return;
    this.state = st;
    this.sink.changed({ state: st });
  }

  private sys(text: string, level: 'info' | 'warn' | 'error'): void {
    this.sink.item({ kind: 'system', id: nextId('s'), at: Date.now(), text, level }, false);
  }
}

/** A failure already worded for the user (Italian, no secrets). */
class ApiError extends Error {}
/** A non-2xx answer; the body is read only for a 4xx's own message (redacted). */
class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) { super(`HTTP ${status}`); }
}
