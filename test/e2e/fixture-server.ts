// Tiny static servers for the browser e2e tests: site A (127.0.0.1) serves test/fixtures/site with {{CROSS}} replaced by
// site B's origin; site B is reached as "localhost" on another port, a different site for Chromium, so its iframe runs
// out of process (a real cross-origin iframe). A few JSON endpoints feed the network tests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const ROOT = path.resolve(import.meta.dirname, '..', 'fixtures', 'site');

function listen(handler: http.RequestListener): Promise<http.Server> {
  return new Promise(resolve => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

/** a: 127.0.0.1 (local), b: localhost on another port (cross-site iframe), remote: 127.0.0.2 = NOT a local stack for the
 *  password guard (only localhost, 127.0.0.1, [::1], *.localhost, *.test are), null when it cannot be bound. */
export interface Sites { a: string; b: string; remote: string | null; close(): Promise<void> }

export async function startSites(): Promise<Sites> {
  let crossOrigin = '';
  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
    const cookie = /(?:^|;\s*)sb_auth=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (url.pathname === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const { user, pass, short } = JSON.parse(body || '{}') as { user?: string; pass?: string; short?: boolean };
        if (!user || !pass) { json(401, { error: 'credenziali mancanti' }); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `sb_auth=${encodeURIComponent(user)}-${Date.now()}; Max-Age=${short ? 3600 : 172800}; Path=/; HttpOnly` }).end('{"ok":true}');
      });
      return;
    }
    if (url.pathname === '/app') {
      if (!cookie) { res.writeHead(302, { Location: '/login?next=/app' }).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>App</title><h1>Benvenuto ${decodeURIComponent(cookie).split('-')[0]}</h1><a href="/logout">Esci</a>`);
      return;
    }
    if (url.pathname === '/logout') { res.writeHead(302, { 'Set-Cookie': 'sb_auth=; Max-Age=0; Path=/', Location: '/login' }).end(); return; }
    if (url.pathname === '/api/data') return json(200, { items: ['uno', 'due', 'tre'] });
    if (url.pathname === '/api/fail') return json(500, { error: 'boom' });
    if (url.pathname === '/api/cross') return json(200, { code: url.searchParams.get('c') ?? '' });
    let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^[\\/]+/, ''));
    if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;   // /login → login.html
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
    const body = fs.readFileSync(file, 'utf8').replaceAll('{{CROSS}}', crossOrigin);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  };
  const sa = await listen(handler);
  const sb = await listen(handler);
  const sr = await new Promise<http.Server | null>(resolve => {
    const s = http.createServer(handler);
    s.once('error', () => resolve(null));
    s.listen(0, '127.0.0.2', () => resolve(s));
  });
  crossOrigin = `http://localhost:${(sb.address() as AddressInfo).port}`;
  const servers = [sa, sb, ...(sr ? [sr] : [])];
  return {
    a: `http://127.0.0.1:${(sa.address() as AddressInfo).port}`,
    b: crossOrigin,
    remote: sr ? `http://127.0.0.2:${(sr.address() as AddressInfo).port}` : null,
    close: async () => { await Promise.all(servers.map(s => new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); }))); },
  };
}

/** A minimal MCP client over Streamable HTTP (JSON responses), the way Claude Code talks to the app. */
export class McpClient {
  sessionId = '';
  private id = 0;
  constructor(readonly url: string) {}

  async post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}), ...headers },
      body: JSON.stringify(body),
    });
  }

  async rpc(method: string, params: unknown = {}): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
    const res = await this.post({ jsonrpc: '2.0', id: ++this.id, method, params });
    if (method === 'initialize') this.sessionId = res.headers.get('mcp-session-id') ?? '';
    return res.json() as Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }>;
  }

  async init(): Promise<Record<string, unknown>> {
    const r = await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return r.result ?? {};
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }> {
    const r = await this.rpc('tools/call', { name, arguments: args });
    if (r.error) throw new Error(`${name}: JSON-RPC error ${r.error.code} ${r.error.message}`);
    const content = (r.result?.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    return {
      text: content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n'),
      images: content.filter(c => c.type === 'image').map(c => ({ data: c.data ?? '', mimeType: c.mimeType ?? '' })),
      isError: r.result?.isError === true,
    };
  }

  /** Calls a tool and fails the test with the tool's own error text when it errors. */
  async ok(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const r = await this.call(name, args);
    if (r.isError) throw new Error(`${name} failed: ${r.text}`);
    return r.text;
  }
}

/** The ref on the first tree line matching pattern, e.g. refOf(tree, /textbox "Nome"/) → "e3". */
export function refOf(tree: string, pattern: RegExp): string {
  for (const line of tree.split('\n')) if (pattern.test(line)) { const m = /\[((?:f\d+)?e\d+)\]/.exec(line); if (m) return m[1]!; }
  throw new Error(`no line matches ${pattern} in:\n${tree}`);
}

/** PNG width and height from the IHDR chunk. */
export function pngSize(b64: string): { width: number; height: number } {
  const b = Buffer.from(b64, 'base64');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Width and height of a PNG or a baseline/progressive JPEG (its SOF0/SOF2 segment). */
export function imageSize(b64: string): { width: number; height: number } {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 0xff || b[1] !== 0xd8) return pngSize(b64);
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) throw new Error(`bad JPEG marker at ${i}`);
    const marker = b[i + 1]!;
    if (marker === 0xc0 || marker === 0xc2) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('JPEG without a size segment');
}
