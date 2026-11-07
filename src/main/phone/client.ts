// Telegram Bot API client of the phone bridge, over the global fetch only (no dependency). Why a module of its own: the
// token sits in every URL (/bot<token>/<method>), so this is the one place that builds those URLs, and it keeps them
// out of logs and errors: the bridge calls addRedaction(token) before the first call, logs carry only the method name
// (never the URL, the body or a message text) and every error text is scrubbed of the token. The API host is
// api.telegram.org; a test base is accepted only on this computer (http://127.0.0.1:<port> or http://localhost:<port>).
// Redirects are refused (the token would follow them). 429 waits retry_after, a network error backs off, 409 (another
// poller on the same token) and 401 surface as TelegramError for the bridge. Outgoing messages go through one queue,
// at most one per sendGapMs, and texts over 4096 characters are split. Texts are sent as plain text (no parse_mode):
// nothing needs escaping and nothing in them is interpreted.
// Used by bridge.ts, voice.ts and outbound.ts; tests: test/unit/phone/client.test.ts (fake server).
import type { InlineKeyboard, PhoneLog, PhoneTiming, TgFile, TgMessage, TgUpdate, TgUser } from './types';

export const TELEGRAM_API = 'https://api.telegram.org';
/** Telegram's own limit for a bot download, and for a text message. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT = 4096;

/** The API base: api.telegram.org, or a test server on this computer; anything else is refused. */
export function resolveApiBase(testApiBase?: string): string {
  if (testApiBase === undefined) return TELEGRAM_API;
  let u: URL;
  try { u = new URL(testApiBase); } catch { throw new Error('testApiBase non valido: serve http://127.0.0.1:<porta>'); }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'http:' || !local || !u.port || u.pathname !== '/' || u.search || u.username || u.password) {
    throw new Error('testApiBase rifiutato: solo http://127.0.0.1:<porta> o http://localhost:<porta>');
  }
  return `http://${u.hostname}:${u.port}`;
}

/** An API failure; message and description are already scrubbed of the token. */
export class TelegramError extends Error {
  constructor(readonly method: string, readonly code: number | 'network' | 'too-large', description: string, readonly retryAfterS?: number) {
    super(`telegram ${method}: ${code} ${description}`);
    this.name = 'TelegramError';
  }
}

/** Splits a text at most `max` characters each, at a newline or a space when one is near the end. */
export function splitText(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

export interface SendOptions { replyMarkup?: InlineKeyboard; silent?: boolean }

export interface TelegramClient {
  getMe(): Promise<TgUser>;
  deleteWebhook(): Promise<void>;
  getUpdates(offset: number, signal?: AbortSignal): Promise<TgUpdate[]>;
  /** a long text is split; the buttons go on the last part, whose message is returned */
  sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<TgMessage>;
  editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void>;
  editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup?: InlineKeyboard): Promise<void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  getFile(fileId: string): Promise<TgFile>;
  /** downloads a file into memory, refusing (before reading it) anything over maxBytes */
  download(filePath: string, maxBytes?: number): Promise<Uint8Array>;
}

export interface ClientOptions {
  fetch: typeof fetch;
  token: string;
  base: string;
  log: PhoneLog;
  timing: Pick<PhoneTiming, 'sendGapMs' | 'pollTimeoutS' | 'backoffMs' | 'backoffMaxMs' | 'maxRetryAfterMs'>;
  sleep?: (ms: number) => Promise<void>;
}

interface ApiReply { ok: boolean; result?: unknown; description?: string; error_code?: number; parameters?: { retry_after?: number } }

const realSleep = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); t.unref?.(); });
/** The wait before retry n (0-based): doubling from base, capped. */
export const backoff = (n: number, base: number, cap: number) => Math.min(cap, base * 2 ** Math.min(n, 20));

export function createTelegramClient(o: ClientOptions): TelegramClient {
  const sleep = o.sleep ?? realSleep;
  const scrub = (s: string) => (o.token ? s.split(o.token).join('[redacted]') : s).slice(0, 300);
  const url = (method: string) => `${o.base}/bot${o.token}/${method}`;

  async function once(method: string, params: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await o.fetch(url(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        redirect: 'error',
        signal: sig,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new TelegramError(method, 'network', scrub(e instanceof Error ? e.message : String(e)));
    }
    let body: ApiReply;
    try { body = (await res.json()) as ApiReply; } catch { throw new TelegramError(method, res.status || 'network', 'risposta non JSON'); }
    if (body.ok) return body.result;
    throw new TelegramError(method, body.error_code ?? res.status, scrub(body.description ?? ''), body.parameters?.retry_after);
  }

  /** One API call: 429 waits retry_after, a network error backs off, up to `tries` attempts. */
  async function call<T>(method: string, params: Record<string, unknown> = {}, tries = 4): Promise<T> {
    o.log.debug('phone', 'telegram call', { data: { method } });
    for (let n = 0; ; n++) {
      try { return (await once(method, params)) as T; } catch (e) {
        if (!(e instanceof TelegramError) || n + 1 >= tries) throw e;
        if (e.code === 429) await sleep(Math.min(o.timing.maxRetryAfterMs, Math.max(1, e.retryAfterS ?? 1) * 1000));
        else if (e.code === 'network') await sleep(backoff(n, o.timing.backoffMs, o.timing.backoffMaxMs));
        else throw e;
        o.log.warn('phone', 'telegram retry', { data: { method, code: e.code } });
      }
    }
  }

  // one outgoing queue: at most one message per sendGapMs
  let queue: Promise<unknown> = Promise.resolve();
  let lastSent = 0;
  function queued<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastSent + o.timing.sendGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try { return await job(); } finally { lastSent = Date.now(); }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    getMe: () => call<TgUser>('getMe'),
    deleteWebhook: async () => { await call('deleteWebhook', { drop_pending_updates: false }); },
    async getUpdates(offset, signal) {
      o.log.debug('phone', 'telegram call', { data: { method: 'getUpdates' } });
      const r = await once('getUpdates', { offset, timeout: o.timing.pollTimeoutS, allowed_updates: ['message', 'callback_query'] }, signal, (o.timing.pollTimeoutS + 15) * 1000);
      return Array.isArray(r) ? (r as TgUpdate[]) : [];
    },
    async sendMessage(chatId, text, opts = {}) {
      const parts = splitText(text);
      let last: TgMessage | undefined;
      for (let i = 0; i < parts.length; i++) {
        const params: Record<string, unknown> = { chat_id: chatId, text: parts[i], disable_web_page_preview: true };
        if (opts.silent) params.disable_notification = true;
        if (opts.replyMarkup && i === parts.length - 1) params.reply_markup = opts.replyMarkup;
        last = await queued(() => call<TgMessage>('sendMessage', params));
      }
      return last!;
    },
    async editMessageText(chatId, messageId, text, replyMarkup) {
      const params: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text: splitText(text)[0], disable_web_page_preview: true };
      params.reply_markup = replyMarkup ?? { inline_keyboard: [] };
      await queued(() => call('editMessageText', params));
    },
    async editMessageReplyMarkup(chatId, messageId, replyMarkup) {
      await queued(() => call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup ?? { inline_keyboard: [] } }));
    },
    async answerCallbackQuery(id, text) {
      await call('answerCallbackQuery', text ? { callback_query_id: id, text } : { callback_query_id: id }, 2);
    },
    getFile: (fileId: string) => call<TgFile>('getFile', { file_id: fileId }),
    async download(filePath, maxBytes = MAX_DOWNLOAD_BYTES) {
      if (!/^[\w./-]+$/.test(filePath) || filePath.includes('..')) throw new TelegramError('download', 400, 'percorso del file non valido');
      o.log.debug('phone', 'telegram call', { data: { method: 'download' } });
      let res: Response;
      try {
        res = await o.fetch(`${o.base}/file/bot${o.token}/${filePath}`, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        throw new TelegramError('download', 'network', scrub(e instanceof Error ? e.message : String(e)));
      }
      if (!res.ok) throw new TelegramError('download', res.status, 'download fallito');
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > maxBytes) { await res.body?.cancel(); throw new TelegramError('download', 'too-large', 'file troppo grande'); }
      // read with a cap: a missing or false content-length never makes us hold more than maxBytes
      const reader = res.body?.getReader();
      if (!reader) return new Uint8Array();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new TelegramError('download', 'too-large', 'file troppo grande'); }
        chunks.push(value);
      }
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.byteLength; }
      return out;
    },
  };
}
