// The app's MCP client (ADR 0086) against local fakes, no network: Streamable HTTP with a JSON and an SSE answer, the
// session id, the token header sent and a 401 mapped to a clear "token" error; stdio with the fake server (paged tool
// list, readOnlyHint, a server request answered, the token variable reaching the process, a crash with its stderr);
// the Windows .cmd rule for arguments.
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { connect, describeError, spawnPlan, type Upstream } from '../../../src/main/mcp-servers/client';

const FAKE_STDIO = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-mcp-stdio.mjs');
const servers: http.Server[] = [], ups: Upstream[] = [];
afterEach(() => { for (const u of ups.splice(0)) u.close(); for (const s of servers.splice(0)) s.close(); });

async function fakeHttp(handler: (msg: Record<string, unknown>, req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { if (req.method === 'DELETE') { res.writeHead(204).end(); return; } handler(JSON.parse(body) as Record<string, unknown>, req, res); });
  });
  servers.push(s);
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/mcp`;
}
const json = (res: http.ServerResponse, body: unknown, headers: Record<string, string> = {}) => res.writeHead(200, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));

describe('HTTP upstream', () => {
  it('initializes, keeps the session, sends the token header, reads JSON and SSE answers', async () => {
    const seen: { auth?: string; session?: string; version?: string; method: string }[] = [];
    const url = await fakeHttp((m, req, res) => {
      seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined, version: req.headers['mcp-protocol-version'] as string | undefined, method: String(m.method) });
      if (m.method === 'initialize') return json(res, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'gh', version: '2' } } }, { 'Mcp-Session-Id': 'sess-1' });
      if (m.id === undefined) { res.writeHead(202).end(); return; }
      if (m.method === 'tools/list') return json(res, { jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'search', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }, { name: 'create' }] } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'done' }] } })}\n\n`);
    });
    const up = connect({ transport: 'http', url, headers: { Authorization: 'Bearer tok-123' } });
    ups.push(up);
    const tools = await up.tools();
    expect(tools.map(t => [t.name, t.readOnly])).toEqual([['search', true], ['create', false]]);
    expect(up.serverInfo).toBe('gh 2');
    expect(await up.call('create', { a: 1 })).toEqual({ content: [{ type: 'text', text: 'done' }] });
    expect(seen.every(s => s.auth === 'Bearer tok-123')).toBe(true);
    expect(seen.slice(1).every(s => s.session === 'sess-1' && s.version === '2025-06-18')).toBe(true);
    expect(seen.map(s => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  });

  it('maps 401 to a token error and an unreachable host to a network error', async () => {
    const url = await fakeHttp((_m, _req, res) => { res.writeHead(401).end('{"secret":"leak"}'); });
    const up = connect({ transport: 'http', url, headers: {} });
    ups.push(up);
    const e = describeError(await up.tools().catch(x => x));
    expect(e.code).toBe('auth');
    expect(e.fix).toMatch(/token/);
    expect(e.message).not.toContain('leak');
    const down = connect({ transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: {} });
    ups.push(down);
    expect(describeError(await down.tools().catch(x => x)).code).toBe('network');
  });
});

describe('stdio upstream', () => {
  it('lists every page of tools, answers server requests and passes the token only as its variable', async () => {
    const up = connect({ transport: 'stdio', command: FAKE_STDIO, args: [], env: { FAKE_MCP_TOKEN: 'abcdefghij', FAKE_MCP_ASK: '1' } });
    ups.push(up);
    const tools = await up.tools();
    expect(tools.map(t => [t.name, t.readOnly])).toEqual([['read_items', true], ['write_item', false]]);
    expect(up.serverInfo).toBe('fake-stdio 0.1');
    const r = await up.call('read_items', { q: 'x' });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ tool: 'read_items', args: { q: 'x' }, token: 10 });
  });
  it('a server that exits gives its last stderr line and a fix', async () => {
    const up = connect({ transport: 'stdio', command: FAKE_STDIO, args: [], env: { FAKE_MCP_EXIT: '1' } });
    ups.push(up);
    const e = describeError(await up.tools().catch(x => x));
    expect(e.code).toBe('spawn');
    expect(e.message).toContain('missing organization');
  });
  it('a missing program is a spawn error', async () => {
    const up = connect({ transport: 'stdio', command: '/nonexistent/mcp-server-xyz', args: [], env: {} });
    ups.push(up);
    expect(describeError(await up.tools().catch(x => x)).code).toBe('spawn');
  });
  it('a .cmd on Windows takes plain arguments only, through cmd.exe', () => {
    const plan = spawnPlan({ transport: 'stdio', command: 'C:\\tools\\npx.cmd', args: ['-y', '@azure-devops/mcp', 'contoso'], env: {} }, 'win32');
    expect(plan.verbatim).toBe(true);
    expect(plan.args.at(-1)).toBe('""C:\\tools\\npx.cmd" -y @azure-devops/mcp contoso"');
    expect(() => spawnPlan({ transport: 'stdio', command: 'C:\\tools\\npx.cmd', args: ['a & calc'], env: {} }, 'win32')).toThrow(/non sicuro/);
    expect(spawnPlan({ transport: 'stdio', command: '/usr/bin/env', args: ['a & b'], env: { X: '1' } }, 'linux')).toMatchObject({ command: '/usr/bin/env', args: ['a & b'], verbatim: false });
  });
});
