// Cursor Cloud Agents through Cursor's public REST API v1 (https://api.cursor.com/v1, ADR 0080): start (POST
// /v1/agents), list (GET /v1/agents), the current run's messages (SSE GET …/runs/{runId}/stream, resumable with
// Last-Event-ID), follow-up (POST …/runs), stop (POST …/runs/{runId}/cancel) and spend (GET …/usage). The key is the
// user's Cursor API key from Settings → Motori (engines/secrets.ts, id `cursor-cloud`): read right before each request,
// sent only as the Authorization header to api.cursor.com, never logged. Parsers are tolerant (a renamed field leaves a
// gap, never a crash) and report unknown shapes as CLI drift (chats/drift.ts, ADR 0055). The agent pushes only its own
// `cursor/…` branch, never the base one; no PR is opened by the app. Used by service.ts; tests replay
// test/fixtures/cloud/cursor-*.json through a fake Http.
import type { CloudAgent, CloudMessage, CloudReady, CloudStatus } from '../../shared/cloud';
import { drift } from '../chats/drift';
import type { Http } from './exec';
import { githubRepo } from './repo';
import { rec, str, timeOf, vendorUrl, type CloudProvider, type StartInput } from './provider';

export const CURSOR_API = 'https://api.cursor.com';
/** The secret store's id of the Cursor Cloud Agents key (engines/service.ts CLOUD_KEYS). */
export const CURSOR_CLOUD_KEY = 'cursor-cloud';

const STATUS: Record<string, CloudStatus> = {
  creating: 'queued', queued: 'queued', pending: 'queued', starting: 'queued',
  running: 'running', in_progress: 'running', active: 'running',
  waiting: 'waiting', needs_input: 'waiting', awaiting_input: 'waiting',
  finished: 'done', completed: 'done', done: 'done', succeeded: 'done', success: 'done',
  error: 'failed', failed: 'failed', expired: 'failed',
  cancelled: 'stopped', canceled: 'stopped', stopped: 'stopped', archived: 'stopped',
};
export function cursorStatus(v: unknown): CloudStatus {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  const out = STATUS[s];
  if (!out) drift('cursor-cloud', 'v1', 'status', `unknown status ${s.slice(0, 30) || '(none)'}`);
  return out ?? 'unknown';
}

/** One agent object of the API → a CloudAgent (null when it has no id). */
export function fromCursor(v: unknown, by: CloudAgent['by'], now = Date.now()): CloudAgent | null {
  const o = rec(v), target = rec(o.target), source = rec(o.source), run = rec(o.latestRun ?? o.run ?? o.currentRun);
  const id = str(o.id, 120);
  if (!id) return null;
  const gh = githubRepo(String(source.repository ?? o.repository ?? ''));
  const runId = str(o.latestRunId ?? run.id ?? o.runId, 120);
  const summary = str(o.summary ?? run.summary ?? run.result, 600);
  const branch = str(target.branchName ?? o.branchName, 160);
  return {
    id, engine: 'cursor', by,
    title: str(o.name ?? o.title, 120) ?? str(rec(o.prompt).text, 120) ?? id,
    status: cursorStatus(run.status ?? o.status),
    url: vendorUrl('cursor', target.url ?? o.url),
    repo: 'repo' in gh ? gh.repo : '',
    ...(branch ? { branch } : {}),
    updatedAt: timeOf(o.updatedAt ?? run.updatedAt ?? o.createdAt, now),
    ...(summary ? { summary } : {}),
    ...(runId ? { runId } : {}),
  };
}

/** An incremental Server-Sent Events parser: feed text, get each complete event (id, event name, data). */
export class SseParser {
  private buf = '';
  private ev: { id?: string; event?: string; data: string[] } = { data: [] };
  feed(text: string): { id?: string; event: string; data: string }[] {
    this.buf += text;
    const out: { id?: string; event: string; data: string }[] = [];
    let nl: number;
    while ((nl = this.buf.search(/\r?\n/)) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + (this.buf[nl] === '\r' ? 2 : 1));
      if (line === '') {
        if (this.ev.data.length || this.ev.event) out.push({ ...(this.ev.id ? { id: this.ev.id } : {}), event: this.ev.event ?? 'message', data: this.ev.data.join('\n') });
        this.ev = { data: [] };
        continue;
      }
      if (line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'data') this.ev.data.push(value);
      else if (field === 'event') this.ev.event = value;
      else if (field === 'id') this.ev.id = value;
    }
    return out;
  }
}

/** One stream event → a message for the strip (null = nothing to show); status events also carry the new status. */
export function streamMessage(e: { id?: string; event: string; data: string }, n: number, now = Date.now()): (CloudMessage & { status?: CloudStatus }) | null {
  let d: Record<string, unknown> = {};
  try { d = rec(JSON.parse(e.data)); } catch { d = { text: e.data }; }
  const id = e.id ?? `m${n}`;
  const text = str(d.text ?? d.delta ?? d.content ?? d.message, 4000);
  switch (e.event) {
    case 'assistant': case 'assistant_message': return text ? { id, kind: 'assistant', text, at: now } : null;
    case 'user': case 'user_message': return text ? { id, kind: 'user', text, at: now } : null;
    case 'tool_call': return { id, kind: 'tool', text: str(d.name ?? d.tool, 120) ?? 'strumento', at: now };
    case 'status': { const status = cursorStatus(d.status); return { id, kind: 'status', text: String(d.status ?? ''), at: now, status }; }
    case 'result': return { id, kind: 'status', text: str(d.summary ?? d.text ?? d.result, 4000) ?? 'fine', at: now, status: cursorStatus(d.status ?? 'finished') };
    case 'heartbeat': case 'ping': return null;
    default: drift('cursor-cloud', 'v1', 'stream', `unknown event ${e.event.slice(0, 30)}`); return null;
  }
}

/** Why a response failed, for the user (Italian). */
function failure(status: number): string {
  if (status === 401) return 'chiave Cursor non valida o scaduta: inseriscila di nuovo in Impostazioni → Motori';
  if (status === 402 || status === 403) return 'Cursor rifiuta: serve un piano a pagamento con il limite di spesa impostato, e il repository collegato a Cursor';
  if (status === 404) return 'agente non trovato su Cursor';
  if (status === 429) return 'troppe richieste a Cursor: riprova tra poco';
  return `Cursor ha risposto ${status}`;
}

/** The spend of a usage answer, tolerant of the field's name (usd, or cents). */
export function usageUsd(v: unknown): number | null {
  const o = rec(v), cost = rec(o.cost);
  for (const x of [o.totalCostUsd, o.costUsd, o.usd, cost.usd, cost.totalUsd]) if (typeof x === 'number' && Number.isFinite(x) && x >= 0) return x;
  for (const x of [o.totalCostCents, o.costCents, cost.cents]) if (typeof x === 'number' && Number.isFinite(x) && x >= 0) return x / 100;
  return null;
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';

export class CursorCloud implements CloudProvider {
  readonly engine = 'cursor' as const;
  constructor(private readonly d: { http: Http; key: () => string | null; rand?: () => string }) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const key = this.d.key();
    if (!key) throw new Error('manca la chiave Cursor Cloud Agents: inseriscila in Impostazioni → Motori → Cursor');
    const r = await this.d.http(`${CURSOR_API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(failure(r.status));
    const text = await r.text();
    try { return text ? JSON.parse(text) : {}; } catch { throw new Error('risposta di Cursor non leggibile'); }
  }

  readiness(): Promise<CloudReady> {
    return Promise.resolve(this.d.key() ? { ok: true } : { ok: false, why: 'manca la chiave Cursor Cloud Agents (Impostazioni → Motori → Cursor)' });
  }

  async start(i: StartInput): Promise<CloudAgent> {
    const branchName = `cursor/${slug(i.title)}-${(this.d.rand?.() ?? Math.random().toString(36).slice(2, 6))}`;
    const out = await this.call('POST', '/v1/agents', {
      prompt: { text: i.prompt }, source: { repository: i.repo.url, ref: i.repo.branch },
      target: { branchName, autoCreatePr: false }, ...(i.model ? { model: i.model } : {}),
    });
    const a = fromCursor(rec(out).agent ?? out, 'user');
    if (!a) throw new Error('Cursor non ha restituito l’agente');
    return { ...a, title: i.title || a.title, repo: a.repo || i.repo.repo, branch: a.branch ?? branchName };
  }

  async list(): Promise<CloudAgent[]> {
    const out = rec(await this.call('GET', '/v1/agents?limit=50'));
    const items = Array.isArray(out.agents) ? out.agents : Array.isArray(out.items) ? out.items : Array.isArray(out.data) ? out.data : [];
    if (!items.length && !('agents' in out)) drift('cursor-cloud', 'v1', 'list', 'no agents array');
    return items.map(x => fromCursor(x, 'vendor')).filter((x): x is CloudAgent => !!x);
  }

  async followUp(a: CloudAgent, text: string): Promise<Partial<CloudAgent>> {
    const run = rec(await this.call('POST', `/v1/agents/${encodeURIComponent(a.id)}/runs`, { prompt: { text } }));
    const runId = str(run.id ?? rec(run.run).id, 120);
    return { status: 'running', ...(runId ? { runId } : {}) };
  }

  async stop(a: CloudAgent): Promise<Partial<CloudAgent>> {
    if (!a.runId) throw new Error('nessuna esecuzione in corso da fermare');
    await this.call('POST', `/v1/agents/${encodeURIComponent(a.id)}/runs/${encodeURIComponent(a.runId)}/cancel`);
    return { status: 'stopped' };
  }

  async usage(a: CloudAgent): Promise<number | null> {
    return usageUsd(await this.call('GET', `/v1/agents/${encodeURIComponent(a.id)}/usage`));
  }

  private lastEvent = new Map<string, string>();

  async stream(a: CloudAgent, onMessage: (m: CloudMessage & { status?: CloudStatus }) => void, signal: AbortSignal): Promise<void> {
    const key = this.d.key();
    if (!key || !a.runId) return;
    const last = this.lastEvent.get(`${a.id}/${a.runId}`);
    const r = await this.d.http(`${CURSOR_API}/v1/agents/${encodeURIComponent(a.id)}/runs/${encodeURIComponent(a.runId)}/stream`, {
      method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream', ...(last ? { 'Last-Event-ID': last } : {}) }, signal,
    });
    if (!r.ok || !r.body) throw new Error(failure(r.status));
    const parser = new SseParser(), decoder = new TextDecoder();
    const reader = r.body.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const e of parser.feed(decoder.decode(value, { stream: true }))) {
        if (e.id) this.lastEvent.set(`${a.id}/${a.runId}`, e.id);
        const m = streamMessage(e, n++);
        if (m) onMessage(m);
      }
    }
  }
}
