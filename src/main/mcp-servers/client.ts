// A minimal MCP client for the servers the app manages (ADR 0086), written by hand like the server (ADR 0003: no SDK).
// Two transports: Streamable HTTP (POST JSON-RPC, a JSON or an SSE answer, Mcp-Session-Id) and stdio (the server's
// process, one JSON-RPC message per line). Only what the gateway and the test need: initialize, tools/list (paged),
// tools/call, close. Requests the server sends us (roots, sampling, elicitation) are answered "not supported". The
// server's token goes only into its own process environment or its own request header, decided by the caller
// (service.ts); errors are mapped to a code, an Italian message and a fix, never with a token or a response body.
// Used by gateway.ts (a chat's calls) and service.ts (the Settings test).
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { findCli, killTrees } from '../chats/cli';
import { redact } from '../log';
import type { McpErrorCode, McpToolInfo } from '../../shared/mcp-servers';

export const CLIENT_PROTOCOL = '2025-06-18';
export interface UpstreamTool extends McpToolInfo { inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> }
export interface CallResult { content: unknown[]; isError?: boolean; structuredContent?: unknown }
export interface Upstream {
  readonly serverInfo: string | undefined;
  tools(): Promise<UpstreamTool[]>;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallResult>;
  close(): void;
}
/** How to reach one server, secrets already resolved (main memory only). */
export type Endpoint =
  | { transport: 'http'; url: string; headers: Record<string, string> }
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd?: string };

export class McpClientError extends Error {
  constructor(readonly code: McpErrorCode, message: string, readonly fix: string) { super(message); }
}

interface Pending { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }
type Msg = { jsonrpc?: string; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };

const asTool = (t: unknown): UpstreamTool | null => {
  const o = (t ?? {}) as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name || o.name.length > 128) return null;
  const annotations = o.annotations && typeof o.annotations === 'object' ? o.annotations as Record<string, unknown> : undefined;
  return {
    name: o.name, description: typeof o.description === 'string' ? o.description.slice(0, 4000) : '',
    inputSchema: o.inputSchema && typeof o.inputSchema === 'object' ? o.inputSchema as Record<string, unknown> : { type: 'object' },
    readOnly: annotations?.readOnlyHint === true, ...(annotations ? { annotations } : {}),
  };
};

/** JSON-RPC over some transport: ids, timeouts, the handshake and the paged tool list. */
abstract class Rpc implements Upstream {
  private next = 1;
  protected readonly pending = new Map<number, Pending>();
  serverInfo: string | undefined;
  private ready: Promise<void> | null = null;
  constructor(protected readonly timeoutMs: number) {}

  protected abstract send(msg: Msg, signal?: AbortSignal): Promise<void>;
  abstract close(): void;

  protected deliver(msg: Msg): void {
    if (msg.method !== undefined) {
      // a request from the server (roots/list, sampling, elicitation): not offered by this client
      if (msg.id !== undefined && msg.id !== null) void this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported by this client' } }).catch(() => {});
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpClientError('protocol', `Il server ha risposto con un errore: ${redact(String(msg.error.message ?? msg.error.code ?? '')).slice(0, 300)}`, 'Controlla i parametri e i permessi del server, poi riprova.'));
    else p.resolve(msg.result);
  }

  protected failAll(e: Error): void {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(e); this.pending.delete(id); }
  }

  protected request(method: string, params: unknown, signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new McpClientError('timeout', `Il server non ha risposto in ${Math.round(timeoutMs / 1000)} s.`, 'Controlla che il server sia avviabile e raggiungibile; un primo avvio con npx può essere lento: riprova.')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => { const p = this.pending.get(id); if (!p) return; this.pending.delete(id); clearTimeout(timer); reject(new McpClientError('timeout', 'Chiamata annullata.', 'Riprova.')); void this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }).catch(() => {}); }, { once: true });
      this.send({ jsonrpc: '2.0', id, method, params }, signal).catch(e => { const p = this.pending.get(id); if (!p) return; this.pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
    });
  }

  protected init(): Promise<void> {
    this.ready ??= (async () => {
      const r = (await this.request('initialize', { protocolVersion: CLIENT_PROTOCOL, capabilities: {}, clientInfo: { name: 'second-brain', version: '1' } })) as { serverInfo?: { name?: unknown; version?: unknown }; protocolVersion?: unknown } | undefined;
      if (!r || typeof r !== 'object' || typeof r.protocolVersion !== 'string') throw new McpClientError('protocol', 'La risposta non è quella di un server MCP.', 'Controlla comando o indirizzo: deve essere un server MCP (Streamable HTTP o stdio).');
      const name = typeof r.serverInfo?.name === 'string' ? r.serverInfo.name : '';
      this.serverInfo = name ? `${name.slice(0, 80)}${typeof r.serverInfo?.version === 'string' ? ` ${r.serverInfo.version.slice(0, 20)}` : ''}` : undefined;
      this.onInitialized(r.protocolVersion);
      await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    })();
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }
  protected onInitialized(_version: string): void {}

  async tools(): Promise<UpstreamTool[]> {
    await this.init();
    const out: UpstreamTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = (await this.request('tools/list', cursor ? { cursor } : {})) as { tools?: unknown[]; nextCursor?: unknown } | undefined;
      for (const t of r?.tools ?? []) { const tool = asTool(t); if (tool && !out.some(x => x.name === tool.name)) out.push(tool); }
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor || out.length >= 500) break;
    }
    return out;
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallResult> {
    await this.init();
    const r = (await this.request('tools/call', { name, arguments: args }, signal, Math.max(this.timeoutMs, 280_000))) as CallResult | undefined;
    return { content: Array.isArray(r?.content) ? r!.content : [], ...(r?.isError ? { isError: true } : {}), ...(r?.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}) };
  }
}

/** Streamable HTTP: every message is a POST; the answer is JSON or an SSE stream that carries it. */
class HttpUpstream extends Rpc {
  private session: string | null = null;
  private version: string | null = null;
  private readonly aborts = new Set<AbortController>();
  constructor(private readonly ep: Extract<Endpoint, { transport: 'http' }>, timeoutMs: number) { super(timeoutMs); }
  protected override onInitialized(version: string): void { this.version = version; }

  protected async send(msg: Msg, signal?: AbortSignal): Promise<void> {
    const ac = new AbortController();
    this.aborts.add(ac);
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    const headers: Record<string, string> = { ...this.ep.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.version) headers['MCP-Protocol-Version'] = this.version;
    let res: Response;
    try { res = await fetch(this.ep.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: ac.signal, redirect: 'error' }); }
    catch (e) { this.aborts.delete(ac); if (ac.signal.aborted) return; throw new McpClientError('network', `Server non raggiungibile (${hostOf(this.ep.url)}).`, `Controlla l’indirizzo, la rete o la VPN: ${errName(e)}.`); }
    const sid = res.headers.get('mcp-session-id');
    if (sid && /^[\x21-\x7e]{1,200}$/.test(sid)) this.session = sid;
    try {
      if (res.status === 401 || res.status === 403) throw new McpClientError('auth', `Accesso rifiutato (HTTP ${res.status}).`, 'Il token manca, è scaduto o non ha i permessi: inseriscine uno valido nel campo Token.');
      if (res.status === 404 && this.session && msg.method !== 'initialize') { this.session = null; throw new McpClientError('http', 'La sessione col server è scaduta.', 'Riprova: l’app ne apre una nuova.'); }
      if (res.status === 404 || res.status === 405) throw new McpClientError('http', `Indirizzo non valido per MCP (HTTP ${res.status}).`, 'Usa l’indirizzo Streamable HTTP del server (di solito termina con /mcp); i vecchi server solo SSE non sono supportati.');
      if (res.status >= 400) throw new McpClientError('http', `Il server ha risposto HTTP ${res.status}.`, 'Riprova tra poco; se continua, controlla lo stato del servizio.');
      if (msg.id === undefined || msg.method === undefined) { await res.body?.cancel().catch(() => {}); return; }
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type === 'application/json') {
        const body = await readCapped(res, 8 * 1024 * 1024);
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { throw new McpClientError('protocol', 'Risposta non leggibile dal server.', 'Controlla che l’indirizzo sia quello MCP del server.'); }
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) this.deliver(m as Msg);
      } else if (type === 'text/event-stream') {
        await this.readSse(res, msg.id as number);
      } else if (res.status === 202) {
        // accepted with no body: the answer never comes on this request
      } else throw new McpClientError('protocol', 'Risposta inattesa dal server.', 'Controlla che l’indirizzo sia quello MCP del server.');
    } finally { this.aborts.delete(ac); }
  }

  private async readSse(res: Response, id: number): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buf = '', total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 16 * 1024 * 1024) throw new McpClientError('protocol', 'Risposta troppo grande dal server.', 'Chiedi al server meno dati per volta.');
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let at: number;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const event = buf.slice(0, at); buf = buf.slice(at + 2);
          const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
          if (!data) continue;
          try { const m = JSON.parse(data) as Msg; this.deliver(m); if (m.id === id && m.method === undefined) return; } catch { /* not JSON: skipped */ }
        }
      }
    } finally { void reader.cancel().catch(() => {}); }
  }

  close(): void {
    for (const ac of this.aborts) ac.abort();
    this.failAll(new McpClientError('network', 'Collegamento chiuso.', 'Riprova.'));
    const session = this.session;
    this.session = null;
    if (session) void fetch(this.ep.url, { method: 'DELETE', headers: { ...this.ep.headers, 'Mcp-Session-Id': session }, signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
}

/** stdio: the server's own process; newline-delimited JSON-RPC on its stdin/stdout, its stderr kept for the error. */
class StdioUpstream extends Rpc {
  private child: ChildProcess | null = null;
  private stderr = '';
  private exited: McpClientError | null = null;
  constructor(private readonly ep: Extract<Endpoint, { transport: 'stdio' }>, timeoutMs: number) { super(timeoutMs); }

  private start(): ChildProcess {
    if (this.child) return this.child;
    if (this.exited) throw this.exited;
    const { command, args, env, verbatim } = spawnPlan(this.ep);
    const child = spawn(command, args, { cwd: this.ep.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: verbatim });
    this.child = child;
    // below the window, like the engines that call it (jobguard.ts lowerEnginePriority): one copy runs per open chat
    if (child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* gone or not allowed: runs as before */ } }
    let buf = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > 16 * 1024 * 1024) { this.stop(new McpClientError('protocol', 'Il server ha scritto troppo senza andare a capo.', 'Controlla che il comando avvii un server MCP stdio.')); return; }
      let at: number;
      while ((at = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, at).trim(); buf = buf.slice(at + 1);
        if (!line) continue;
        try { this.deliver(JSON.parse(line) as Msg); } catch { /* a log line on stdout: skipped */ }
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (c: string) => { this.stderr = (this.stderr + c).slice(-2000); });
    child.on('error', e => this.stop(new McpClientError('spawn', `Il comando «${path.basename(this.ep.command)}» non è partito (${errName(e)}).`, 'Controlla che il programma sia installato e nel PATH, o scrivi il percorso completo.')));
    child.on('exit', code => this.stop(new McpClientError('spawn', `Il server si è chiuso (codice ${code ?? '?'})${this.stderr ? `: ${redact(lastLine(this.stderr)).slice(0, 240)}` : ''}.`, 'Controlla argomenti, variabili e token; prova il comando in un terminale.')));
    child.stdin!.on('error', () => {});
    return child;
  }

  private stop(e: McpClientError): void {
    if (!this.exited) this.exited = e;
    this.failAll(e);
    const c = this.child;
    this.child = null;
    if (c && c.exitCode === null) killTrees([c.pid], { fallback: () => c.kill() });
  }

  protected async send(msg: Msg): Promise<void> {
    const child = this.start();
    await new Promise<void>((resolve, reject) => child.stdin!.write(`${JSON.stringify(msg)}\n`, e => e ? reject(new McpClientError('spawn', 'Il server non accetta messaggi.', 'Riprova; se continua, prova il comando in un terminale.')) : resolve()));
  }

  close(): void { this.stop(new McpClientError('spawn', 'Collegamento chiuso.', 'Riprova.')); }
}

/** The command line for a stdio server: a name resolved on PATH; .mjs/.js run with this runtime as Node; .cmd/.bat
 *  through cmd.exe with plain arguments only (chats/cli.ts's rule); never a shell otherwise. */
export function spawnPlan(ep: Extract<Endpoint, { transport: 'stdio' }>, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean } {
  const resolved = findCli(ep.command, { ...process.env, ...ep.env }, platform) ?? ep.command;
  const env: NodeJS.ProcessEnv = { ...process.env, ...ep.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (/\.(m?js|cjs)$/i.test(resolved)) return { command: process.execPath, args: [resolved, ...ep.args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, verbatim: false };
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    for (const a of ep.args) if (!/^[\w.:@/=[\],-]+$/.test(a)) throw new McpClientError('invalid', `Argomento non sicuro per un comando .cmd: «${a.slice(0, 60)}».`, 'Togli spazi e caratteri speciali dagli argomenti, o usa il percorso di un .exe.');
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `""${resolved}" ${ep.args.join(' ')}"`], env, verbatim: true };
  }
  return { command: resolved, args: ep.args, env, verbatim: false };
}

export function connect(ep: Endpoint, timeoutMs = 30_000): Upstream {
  return ep.transport === 'http' ? new HttpUpstream(ep, timeoutMs) : new StdioUpstream(ep, timeoutMs);
}

/** Any error as the test's evidence: code, message and fix (never a token: messages are redacted). */
export function describeError(e: unknown): { code: McpErrorCode; message: string; fix: string } {
  if (e instanceof McpClientError) return { code: e.code, message: redact(e.message), fix: e.fix };
  return { code: 'protocol', message: redact(e instanceof Error ? e.message : String(e)).slice(0, 300), fix: 'Riprova; se continua, guarda i log dell’app (npm run logs).' };
}

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return 'indirizzo'; } };
const errName = (e: unknown): string => { const c = (e as { cause?: { code?: unknown }; code?: unknown })?.cause?.code ?? (e as { code?: unknown })?.code; return typeof c === 'string' ? c : 'errore di rete'; };
const lastLine = (s: string): string => s.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
async function readCapped(res: Response, max: number): Promise<string> {
  const text = await res.text();
  if (text.length > max) throw new McpClientError('protocol', 'Risposta troppo grande dal server.', 'Chiedi al server meno dati per volta.');
  return text;
}
