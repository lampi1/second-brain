// Network log of one tab, fed by CDP Network events of the page and of its cross-origin iframes (one CDP session each).
// Keeps the last N requests across navigations, filters them for the network_requests tool, counts in-flight requests
// for "network idle" waits and reports failures since an action. Secrets are redacted from what agents see and from
// saved bodies: auth and cookie headers, token-like strings (log.ts redact), and password / token / secret fields of
// form and JSON bodies in any position (security review 2026-10-11: a Microsoft login POST carries passwd=...).
// Pure (no Electron), unit-tested; used by browser/tabs.ts and browser/actions.ts.
import { redact } from '../log';
import { globMatch } from './glob';

const SECRET_FIELD = /pass(?:word|wd|phrase)?|pwd|secret|token|otp|credential|session|cookie|assertion|saml|signature|api[-_]?key|private[-_]?key|^auth(?:orization)?$|^code$|^pin$/i;

/** multipart/form-data: parts whose name is a secret field get their content masked. Plain string scanning (linear). */
function redactMultipart(text: string): string {
  const nl = text.indexOf('\n');
  const boundary = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
  if (!boundary.startsWith('--') || boundary.length < 3) return redact(text);
  return text.split(boundary).map(part => {
    const sep = part.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
    const at = part.indexOf(sep);
    if (at < 0) return part;
    const head = part.slice(0, at);
    const name = /\bname="([^"]*)"/i.exec(head)?.[1] ?? '';
    if (!SECRET_FIELD.test(name)) return redact(part);
    const tail = part.endsWith('\r\n') ? '\r\n' : part.endsWith('\n') ? '\n' : '';
    return `${head}${sep}[redacted]${tail}`;
  }).join(boundary);
}

/** A request/response body with secret fields masked: JSON keys, form fields (k=v&...), multipart parts by name, SAML
 *  and "key":"value" in text. */
export function redactBody(text: string, mime = ''): string {
  const t = text.trim();
  if (/multipart\/form-data/i.test(mime) || /^--\S+\r?\nContent-Disposition:/i.test(t.slice(0, 300))) return redactMultipart(text);
  if (/json/i.test(mime) || /^[[{]/.test(t)) {
    try {
      let hit = false;
      const mask = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(mask);
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v as P).map(([k, x]) => {
              if (SECRET_FIELD.test(k) && x !== null) { hit = true; return [k, '[redacted]']; }
            return [k, mask(x)];
          }));
        }
        if (typeof v === 'string') { const r = redact(v); if (r !== v) hit = true; return r; }
        return v;
      };
      const out = mask(JSON.parse(t));
      return hit ? JSON.stringify(out) : text;
    } catch { /* not JSON: fall through */ }
  }
  if (/x-www-form-urlencoded/i.test(mime) || /^[^\s=&]+=[^&\s]*(?:&[^\s=&]+=[^&\s]*)*$/.test(t)) {
    return t.split('&').map(part => {
      const i = part.indexOf('=');
      if (i < 0) return part;
      let k = part.slice(0, i);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* raw key */ }
      return SECRET_FIELD.test(k) ? `${part.slice(0, i)}=[redacted]` : part;
    }).join('&');
  }
  return redact(text.replace(/("([^"\\]{1,60})"\s*:\s*")((?:[^"\\]|\\.)*)"/g, (m, pre: string, k: string) => (SECRET_FIELD.test(k) ? `${pre}[redacted]"` : m)));
}

export interface NetEntry {
  id: string;                         // short id for agents: r1, r2...
  key: string;                        // session|requestId (CDP)
  session: string;                    // '' = the page, else the iframe's CDP session id
  requestId: string;
  url: string;
  method: string;
  type: string;                       // CDP resource type: Document, XHR, Fetch, Script...
  frameId?: string;
  startedAt: number;
  endedAt?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  failed?: string;                    // errorText when the request failed
  size?: number;                      // encoded bytes
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  hasPostData?: boolean;
  seq: number;
}

export interface NetFilter { urlPattern?: string; method?: string; type?: string; status?: string | number; limit?: number }

type P = Record<string, unknown>;
const SECRET_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$|token|secret|api[-_]?key|session/i;
const LONG_LIVED = new Set(['WebSocket', 'EventSource', 'Ping', 'CSPViolationReport']);

export function redactHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h as P)) out[k] = SECRET_HEADER.test(k) ? '[redacted]' : redact(String(v));
  return out;
}

export class NetLog {
  private entries: NetEntry[] = [];
  private byKey = new Map<string, NetEntry>();
  private byReq = new Map<string, NetEntry>();       // requestId → newest entry (any session)
  private seqN = 0;

  constructor(private readonly max = 500, private readonly now: () => number = Date.now) {}

  get seq(): number { return this.seqN; }

  /** Feed one CDP event (method + params) from a session ('' = the page). Unknown events are ignored. */
  onEvent(method: string, params: P, session = ''): void {
    const requestId = String(params.requestId ?? '');
    if (!requestId) return;
    const key = `${session}|${requestId}`;
    const t = this.now();
    switch (method) {
      case 'Network.requestWillBeSent': {
        const prev = this.byKey.get(key);
        const redirect = params.redirectResponse as P | undefined;
        if (prev && redirect) {                       // a redirect: close the previous hop, start a new one
          prev.status = Number(redirect.status ?? 0);
          prev.statusText = String(redirect.statusText ?? '');
          prev.responseHeaders = redactHeaders(redirect.headers);
          prev.endedAt = t;
        }
        const req = (params.request ?? {}) as P;
        const e: NetEntry = {
          id: `r${++this.seqN}`, key, session, requestId, url: String(req.url ?? ''), method: String(req.method ?? 'GET'),
          type: String(params.type ?? 'Other'), frameId: params.frameId ? String(params.frameId) : undefined, startedAt: t,
          requestHeaders: redactHeaders(req.headers), postData: typeof req.postData === 'string' ? req.postData : undefined,
          hasPostData: req.hasPostData === true || typeof req.postData === 'string', seq: this.seqN,
        };
        this.entries.push(e);
        this.byKey.set(key, e);
        this.byReq.set(requestId, e);
        while (this.entries.length > this.max) { const old = this.entries.shift()!; if (this.byKey.get(old.key) === old) this.byKey.delete(old.key); if (this.byReq.get(old.requestId) === old) this.byReq.delete(old.requestId); }
        return;
      }
      case 'Network.responseReceived': {
        const e = this.lookup(key, requestId);
        if (!e) return;
        const r = (params.response ?? {}) as P;
        e.status = Number(r.status ?? 0);
        e.statusText = String(r.statusText ?? '');
        e.mimeType = String(r.mimeType ?? '');
        e.responseHeaders = redactHeaders(r.headers);
        if (params.type) e.type = String(params.type);
        return;
      }
      case 'Network.loadingFinished': {
        const e = this.lookup(key, requestId);
        if (!e) return;
        e.endedAt = t;
        if (typeof params.encodedDataLength === 'number') e.size = params.encodedDataLength;
        return;
      }
      case 'Network.loadingFailed': {
        const e = this.lookup(key, requestId);
        if (!e) return;
        e.endedAt = t;
        e.failed = params.canceled ? 'canceled' : String(params.errorText ?? 'failed') + (params.blockedReason ? ` (${String(params.blockedReason)})` : '');
        return;
      }
    }
  }

  /** Requests still running, ignoring long-lived channels (WebSocket, EventSource) and anything open for over maxAgeMs. */
  inflight(maxAgeMs = 10_000): number {
    const t = this.now();
    let n = 0;
    for (const e of this.entries) if (e.endedAt === undefined && !LONG_LIVED.has(e.type) && t - e.startedAt < maxAgeMs) n++;
    return n;
  }

  /** Requests that failed or answered >= 400 and ended at or after t0. */
  failuresSince(t0: number): NetEntry[] {
    return this.entries.filter(e => e.endedAt !== undefined && e.endedAt >= t0 && (e.failed !== undefined && e.failed !== 'canceled' || (e.status ?? 0) >= 400));
  }

  get(id: string): NetEntry | undefined { return this.entries.find(e => e.id === id); }

  list(f: NetFilter = {}): NetEntry[] {
    let out = this.entries;
    if (f.urlPattern) out = out.filter(matcher(f.urlPattern));
    if (f.method) out = out.filter(e => e.method.toLowerCase() === String(f.method).toLowerCase());
    if (f.type) { const ty = String(f.type).toLowerCase(); out = out.filter(e => e.type.toLowerCase() === ty); }
    if (f.status !== undefined && f.status !== '') out = out.filter(statusMatcher(f.status));
    const limit = Math.max(1, Math.min(500, Number(f.limit ?? 50)));
    return out.slice(-limit);
  }

  clear(): void { this.entries = []; this.byKey.clear(); this.byReq.clear(); }

  /** An iframe document request starts on the parent session and finishes on the iframe's own session: same requestId. */
  private lookup(key: string, requestId: string): NetEntry | undefined {
    const e = this.byKey.get(key);
    if (e) return e;
    const other = this.byReq.get(requestId);
    return other && other.endedAt === undefined ? other : undefined;
  }
}

function matcher(pattern: string): (e: NetEntry) => boolean {
  if (!pattern.includes('*')) return e => e.url.includes(pattern);
  return e => globMatch(e.url.slice(0, 8192), pattern, false);   // no regex: a page-controlled URL cannot ReDoS us
}

function statusMatcher(s: string | number): (e: NetEntry) => boolean {
  const v = String(s).toLowerCase();
  if (v === 'failed') return e => e.failed !== undefined;
  if (v === 'error' || v === 'errors') return e => (e.failed !== undefined && e.failed !== 'canceled') || (e.status ?? 0) >= 400;
  if (v === 'pending') return e => e.endedAt === undefined;
  if (/^[1-5]xx$/.test(v)) { const d = Number(v[0]); return e => Math.floor((e.status ?? 0) / 100) === d; }
  if (/^\d{3}$/.test(v)) { const n = Number(v); return e => e.status === n; }
  throw new Error(`Invalid status filter "${String(s)}": use a code (404), a class (5xx), "error" (>= 400 or failed), "failed" or "pending".`);
}

const kb = (n?: number) => (n === undefined ? '' : n < 1024 ? ` ${n}B` : ` ${(n / 1024).toFixed(1)}KB`);

/** One line per request: "r12 200 GET XHR https://... 34ms 1.2KB". */
export function formatEntry(e: NetEntry): string {
  const state = e.failed ? `FAILED(${e.failed})` : e.status ? String(e.status) : e.endedAt === undefined ? 'pending' : '-';
  const ms = e.endedAt !== undefined ? ` ${e.endedAt - e.startedAt}ms` : '';
  const where = e.session ? ' [iframe]' : '';
  return `${e.id} ${state} ${e.method} ${e.type}${where} ${redact(e.url).slice(0, 300)}${ms}${kb(e.size)}`;
}

export function formatDetail(e: NetEntry): string {
  const lines = [
    `${e.id} ${e.method} ${redact(e.url)}`,
    `Status: ${e.failed ? `failed (${e.failed})` : `${e.status ?? 'pending'} ${e.statusText ?? ''}`.trim()} · type ${e.type}${e.mimeType ? ` · ${e.mimeType}` : ''}${e.endedAt !== undefined ? ` · ${e.endedAt - e.startedAt}ms` : ''}${kb(e.size)}${e.session ? ' · from a cross-origin iframe' : ''}`,
    `Request headers: ${JSON.stringify(e.requestHeaders)}`,
  ];
  if (e.postData !== undefined) {
    const ctype = Object.entries(e.requestHeaders).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
    lines.push(`Request body: ${redactBody(e.postData, ctype).slice(0, 2000)}${e.postData.length > 2000 ? '…' : ''}`);
  }
  else if (e.hasPostData) lines.push('Request body: (not captured)');
  if (e.responseHeaders) lines.push(`Response headers: ${JSON.stringify(e.responseHeaders)}`);
  return lines.join('\n');
}
