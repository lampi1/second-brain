// Local MCP server over Streamable HTTP (JSON responses only, no SSE stream), written by hand (ADR 0003: the official
// SDK pulls ~20 packages). Several tool sets live on one server as named mounts with path patterns, e.g.
//   /mcp                          generic endpoint for external clients (Claude desktop, Cursor IDE)
//   /mcp/chat/:chatId/:token      one per app chat (authorize() checks the token)
//   /mcp/app                      app control tool set (mounted by the integrator)
// Spec subset: POST JSON-RPC (single or batch) → application/json; notifications/responses only → 202; DELETE with a
// session id → 204 when the mount frees sessions (onSessionEnd), else 405; GET/OPTIONS → 405. A single tools/call that
// carries _meta.progressToken (and accepts text/event-stream) may stream: on the tool's first ctx.progress() the answer
// switches to SSE, sends notifications/progress events, then the result as the last event. Long waits need it: Claude
// Code aborts a tool that sends no response or progress for 300 s (CLI 2.1.283, "MCP tool idle timeout"). Security: bound to 127.0.0.1 only; Host must be a loopback name with our port and any Origin header is
// refused unless allow-listed (DNS rebinding and web pages in any browser, including our own tabs, must never drive
// it); POST bodies must be application/json (a cross-origin "simple" text/plain POST would skip the CORS preflight);
// bodies are capped. Used by browser/service.ts (browser tool sets) and wiring.ts (other mounts).
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { log, errText } from '../log';
import { updateActivity } from '../update/activity';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_MCP_PORT = 4319;

/** SB_MCP_PORT (0 = random, for tests), else 4319; invalid values fall back to the default. */
export function mcpPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SB_MCP_PORT;
  if (raw === undefined || raw === '') return DEFAULT_MCP_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 65536 ? n : DEFAULT_MCP_PORT;
}

export interface ToolImage { data: string; mimeType: string }
/** What a tool returns: plain text, or text plus images (screenshots). */
export type ToolOutput = string | { text: string; images?: ToolImage[] } | { raw: { content: unknown[]; isError?: boolean; structuredContent?: unknown } };

export interface CallCtx {
  mount: string;                     // mount name
  params: Record<string, string>;    // path params (e.g. chatId)
  sessionId: string;                 // Mcp-Session-Id of the client ('' when the client sent none)
  signal: AbortSignal;               // aborted when the client disconnects
  /** Progress notification to the client (keeps a long call alive); false = the client cannot receive it (no
   *  progressToken, a batch, or no text/event-stream): the tool must then return before the client's idle timeout. */
  progress: (message: string) => boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; title?: string };
  run(args: Record<string, unknown>, ctx: CallCtx): ToolOutput | Promise<ToolOutput>;
}

export interface Mount {
  name: string;
  instructions: string;
  /** a function may be async: a proxied server's tools come from that server (mcp-servers/gateway.ts) */
  tools: McpTool[] | ((ctx: { params: Record<string, string>; sessionId: string }) => McpTool[] | Promise<McpTool[]>);
  /** Return false to answer 404 (an unknown or wrong token looks like a missing route). */
  authorize?: (params: Record<string, string>) => boolean;
  /** Log label for a call (e.g. the chat id), never a secret. */
  who?: (params: Record<string, string>, sessionId: string) => string | undefined;
  /** HTTP DELETE with Mcp-Session-Id: the client ended its session (answered 204). Without it DELETE is 405. */
  onSessionEnd?: (params: Record<string, string>, sessionId: string) => void;
}

export interface McpServerOptions {
  name: string;
  version: string;
  maxBodyBytes?: number;
  allowedOrigins?: string[];         // exact origins allowed to call (default none: MCP clients send no Origin)
}

interface RouteEntry { pattern: string[]; mount: Mount }
interface JsonRpcMsg { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown; result?: unknown; error?: unknown }
type JsonRpcReply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: JsonRpcMsg['id'], result: unknown): JsonRpcReply => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: JsonRpcMsg['id'], code: number, message: string): JsonRpcReply => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export class McpServer {
  private routes: RouteEntry[] = [];
  private server: http.Server | null = null;
  private boundPort = 0;
  private readonly maxBody: number;
  private readonly origins: Set<string>;
  /** Running tools/call by mount + session + request id: notifications/cancelled aborts the one it names. */
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly opts: McpServerOptions) {
    this.maxBody = opts.maxBodyBytes ?? 4 * 1024 * 1024;
    this.origins = new Set(opts.allowedOrigins ?? []);
  }

  /** Adds a tool set at a path pattern ("/mcp/chat/:chatId/:token"). Mounts can be added before or after listen(). */
  mount(path: string, mount: Mount): void {
    const pattern = split(path);
    if (this.routes.some(r => r.pattern.join('/') === pattern.join('/'))) throw new Error(`MCP route already mounted: ${path}`);
    this.routes.push({ pattern, mount });
  }

  get port(): number { return this.boundPort; }
  url(path = '/mcp'): string { return `http://127.0.0.1:${this.boundPort}${path}`; }

  /** Binds 127.0.0.1:<port> (0 = random). Resolves with the bound port. */
  listen(port: number): Promise<number> {
    const server = http.createServer((req, res) => {
      this.onRequest(req, res).catch(e => {
        log.warn('mcp', 'request failed', { cause: errText(e) });
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }).end('internal error'); else res.end();
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        this.boundPort = (server.address() as AddressInfo).port;
        server.on('error', e => log.error('mcp', 'server error', { cause: errText(e), hint: 'restart the app; check that nothing else binds the MCP port' }));
        log.info('mcp', 'listening', { data: { port: this.boundPort, mounts: this.routes.map(r => r.mount.name) } });
        resolve(this.boundPort);
      });
    });
  }

  close(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return Promise.resolve();
    return new Promise(r => { s.close(() => r()); s.closeAllConnections?.(); });
  }

  private match(pathname: string): { mount: Mount; params: Record<string, string> } | null {
    const parts = split(pathname);
    for (const r of this.routes) {
      if (r.pattern.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let hit = true;
      for (let i = 0; i < parts.length; i++) {
        const p = r.pattern[i]!, v = parts[i]!;
        if (p.startsWith(':')) {
          try { params[p.slice(1)] = decodeURIComponent(v); } catch { hit = false; break; }
        } else if (p !== v) { hit = false; break; }
      }
      if (hit) return { mount: r.mount, params };
    }
    return null;
  }

  private hostOk(host: string | undefined): boolean {
    const m = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i.exec(host ?? '');
    return !!m && (m[1] === undefined ? false : Number(m[1]) === this.boundPort);
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (!this.hostOk(req.headers.host) || (origin !== undefined && !this.origins.has(origin))) {
      log.warn('mcp', 'refused request (Host/Origin)', { data: { host: req.headers.host, origin } });
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('forbidden');
      return;
    }
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    const route = this.match(pathname);
    if (!route || (route.mount.authorize && !route.mount.authorize(route.params))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const sid = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : '';
    if (req.method === 'DELETE' && route.mount.onSessionEnd && sid) {   // the client ends its session: free what it held
      try { route.mount.onSessionEnd(route.params, sid); } catch (e) { log.warn('mcp', 'session end failed', { cause: errText(e) }); }
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: route.mount.onSessionEnd ? 'POST, DELETE' : 'POST' }).end(); return; }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ctype !== 'application/json') { res.writeHead(415, { 'Content-Type': 'text/plain' }).end('content-type must be application/json'); return; }

    let body: Buffer | null;
    try { body = await readBody(req, this.maxBody); } catch { res.destroy(); return; }   // client went away mid-body
    if (body === null) { res.writeHead(413, { 'Content-Type': 'text/plain', Connection: 'close' }).end('body too large'); return; }
    let msg: unknown;
    try { msg = JSON.parse(body.toString('utf8')); } catch { send(res, 400, fail(null, -32700, 'Parse error')); return; }

    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    let sessionId = sid;
    const batch = Array.isArray(msg);
    const list = (batch ? msg : [msg]) as JsonRpcMsg[];
    if (batch && !list.length) { send(res, 400, fail(null, -32600, 'Invalid Request: empty batch')); return; }
    const headers: Record<string, string> = {};
    if (list.some(m => m && typeof m === 'object' && m.method === 'initialize')) {
      sessionId = crypto.randomUUID();
      headers['Mcp-Session-Id'] = sessionId;
    }
    const stream = !batch && acceptsSse(req.headers.accept) ? progressTokenOf(list[0]) : undefined;
    let streaming = false, step = 0;
    const progress = (message: string): boolean => {
      if (stream === undefined || res.writableEnded || res.destroyed) return false;
      if (!streaming) {
        streaming = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...headers });
      }
      sseEvent(res, { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: stream, progress: ++step, message: message.slice(0, 500) } });
      return true;
    };
    const ctxBase: CallCtx = { mount: route.mount.name, params: route.params, sessionId, signal: ac.signal, progress };
    const out = (await Promise.all(list.map(m => this.handle(m, route.mount, ctxBase)))).filter((r): r is JsonRpcReply => r !== null);
    if (streaming) {                                   // the result is the last event of the stream
      if (!res.writableEnded && !res.destroyed) { if (out[0]) sseEvent(res, out[0]); res.end(); }
      return;
    }
    if (!out.length) { res.writeHead(202, headers).end(); return; }
    send(res, 200, batch ? out : out[0], headers);
  }

  private async handle(msg: JsonRpcMsg, mount: Mount, ctx: CallCtx): Promise<JsonRpcReply | null> {
    if (!msg || typeof msg !== 'object') return fail(null, -32600, 'Invalid Request');
    const { id, method, params } = msg;
    if (method === undefined) return null;                        // a response from the client: nothing to answer
    if (id === undefined) {                                       // notification (initialized, cancelled, ...)
      // the client gave up on a call (user stop, its own timeout): the tool stops waiting, the connection may stay open
      const rid = (params as { requestId?: unknown } | undefined)?.requestId;
      if (method === 'notifications/cancelled' && (typeof rid === 'string' || typeof rid === 'number')) this.inflight.get(callKey(mount, ctx, rid))?.abort();
      return null;
    }
    if (typeof method !== 'string') return fail(id, -32600, 'Invalid Request: method must be a string');
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    try {
      switch (method) {
        case 'initialize': {
          const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
          const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
          return ok(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: `${this.opts.name}/${mount.name}`, version: this.opts.version },
            instructions: mount.instructions,
          });
        }
        case 'ping': return ok(id, {});
        case 'tools/list':
          return ok(id, { tools: (await this.toolsOf(mount, ctx)).map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
        case 'tools/call': {
          const name = typeof p.name === 'string' ? p.name : '';
          const tool = (await this.toolsOf(mount, ctx)).find(t => t.name === name);
          if (!tool) return fail(id, -32602, `Unknown tool: ${name || '(none)'}. Call tools/list for the available tools.`);
          const args = (p.arguments && typeof p.arguments === 'object' ? p.arguments : {}) as Record<string, unknown>;
          const who = mount.who?.(ctx.params, ctx.sessionId);
          const t0 = Date.now();
          const key = callKey(mount, ctx, id);
          const ac = new AbortController();
          const onClose = () => ac.abort();
          ctx.signal.addEventListener('abort', onClose, { once: true });
          if (ctx.signal.aborted) ac.abort();
          if (id !== null) this.inflight.set(key, ac);
            let leaveActivity: (() => void) | undefined;
            try {
              leaveActivity = updateActivity.enter();
              const out = await tool.run(args, { ...ctx, signal: ac.signal });
            log.debug('mcp', `call ${name}`, { chat: who, data: { mount: mount.name, ms: Date.now() - t0, args: Object.keys(args) } });
            if (typeof out === 'object' && 'raw' in out) return ok(id, { content: out.raw.content, ...(out.raw.isError ? { isError: true } : {}), ...(out.raw.structuredContent !== undefined ? { structuredContent: out.raw.structuredContent } : {}) });
            return ok(id, { content: toContent(out) });
          } catch (e) {
            log.warn('mcp', `tool ${name} failed`, { chat: who, cause: errText(e), data: { mount: mount.name, ms: Date.now() - t0 } });
            return ok(id, { content: [{ type: 'text', text: `Error: ${errText(e)}` }], isError: true });
          } finally {
              leaveActivity?.();
            ctx.signal.removeEventListener('abort', onClose);
            if (this.inflight.get(key) === ac) this.inflight.delete(key);
          }
        }
        default:
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      log.error('mcp', `method ${method} crashed`, { cause: errText(e), hint: 'a bug in the MCP server: see the stack in the logs and fix mcp/server.ts' });
      return fail(id, -32603, `Internal error: ${errText(e)}`);
    }
  }

  private async toolsOf(mount: Mount, ctx: CallCtx): Promise<McpTool[]> {
    return typeof mount.tools === 'function' ? mount.tools({ params: ctx.params, sessionId: ctx.sessionId }) : mount.tools;
  }
}

export function toContent(out: ToolOutput): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  if (typeof out === 'object' && 'raw' in out) return [{ type: 'text', text: JSON.stringify(out.raw.content) }];
  if (typeof out === 'string') return [{ type: 'text', text: out || 'ok' }];
  return [...(out.images ?? []).map(i => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType })), { type: 'text' as const, text: out.text || 'ok' }];
}

function split(path: string): string[] { return path.split('/').filter(Boolean); }

/** The whole body, or null once it exceeds max (the rest is drained and dropped so the 413 still reaches the client). */
function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function callKey(mount: Mount, ctx: CallCtx, id: string | number | null): string {
  return `${mount.name}|${JSON.stringify(ctx.params)}|${ctx.sessionId}|${typeof id}:${String(id)}`;
}

/** A tools/call request's _meta.progressToken (string or number), else undefined. */
function progressTokenOf(m: JsonRpcMsg | undefined): string | number | undefined {
  if (!m || typeof m !== 'object' || m.method !== 'tools/call' || m.id === undefined) return undefined;
  const meta = (m.params as { _meta?: { progressToken?: unknown } } | undefined)?._meta;
  const t = meta?.progressToken;
  return typeof t === 'string' || (typeof t === 'number' && Number.isFinite(t)) ? t : undefined;
}

function acceptsSse(accept: string | undefined): boolean { return /(^|[\s,])text\/event-stream\b/i.test(accept ?? ''); }

function sseEvent(res: http.ServerResponse, body: unknown): void { res.write(`event: message\ndata: ${JSON.stringify(body)}\n\n`); }

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
}
