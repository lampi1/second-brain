// MCP server over plain HTTP with a fake tool set: protocol (initialize, tools/list, tools/call, batch, notifications),
// errors, security (Host, Origin, content type, body cap, unknown routes and tokens) and per-route isolation.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { McpServer, mcpPortFromEnv, toContent, type CallCtx, type McpTool } from '../../src/main/mcp/server';
import { EndpointTokens } from '../../src/main/mcp/tokens';
import { ToolRefusal } from '../../src/main/mcp/refusal';
import { log } from '../../src/main/log';

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: string; json(): any } // eslint-disable-line @typescript-eslint/no-explicit-any

function request(port: number, path: string, body: unknown, headers: Record<string, string> = {}, method = 'POST'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}`, ...headers } }, res => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', c => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: s, json: () => JSON.parse(s) }));
    });
    req.on('error', reject);
    if (method !== 'GET') req.end(data); else req.end();
  });
}

const rpc = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id, method, params });

describe('McpServer', () => {
  const server = new McpServer({ name: 'test', version: '9.9.9', maxBodyBytes: 4096 });
  const tokens = new EndpointTokens();
  const seen: CallCtx[] = [];
  let aborted = false;
  const tools: McpTool[] = [
    { name: 'whoami', description: 'echo the scope', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true },
      run: (args, ctx) => { seen.push(ctx); return JSON.stringify({ params: ctx.params, sessionId: ctx.sessionId, mount: ctx.mount, args }); } },
    { name: 'boom', description: 'always fails', inputSchema: { type: 'object' }, run: () => { throw new Error('kaboom'); } },
    { name: 'picture', description: 'text + image', inputSchema: { type: 'object' }, run: () => ({ text: 'a picture', images: [{ data: 'AAAA', mimeType: 'image/png' }] }) },
    { name: 'hang', description: 'waits for the client to go away', inputSchema: { type: 'object' },
      run: (_a, ctx) => new Promise(resolve => { ctx.signal.addEventListener('abort', () => { aborted = true; resolve('aborted'); }); }) },
    { name: 'refuse', description: 'refuses by its rules', inputSchema: { type: 'object' }, run: () => { throw new ToolRefusal('wrong role'); } },
  ];
  let port = 0;

  beforeAll(async () => {
    server.mount('/mcp', { name: 'generic', instructions: 'generic instructions', tools });
    server.mount('/mcp/chat/:chatId/:token', { name: 'chat', instructions: 'chat instructions', tools, authorize: p => tokens.check(p.chatId!, p.token!) });
    port = await server.listen(0);
  });
  afterAll(() => server.close());

  it('binds a random loopback port and builds URLs from it', () => {
    expect(port).toBeGreaterThan(0);
    expect(server.url('/mcp')).toBe(`http://127.0.0.1:${port}/mcp`);
  });

  it('initialize negotiates the protocol version, returns instructions and a session id', async () => {
    const r = await request(port, '/mcp', rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }));
    expect(r.status).toBe(200);
    const res = r.json().result;
    expect(res.protocolVersion).toBe('2025-03-26');
    expect(res.capabilities).toEqual({ tools: { listChanged: false } });
    expect(res.serverInfo).toEqual({ name: 'test/generic', version: '9.9.9' });
    expect(res.instructions).toBe('generic instructions');
    expect(r.headers['mcp-session-id']).toMatch(/^[0-9a-f-]{36}$/);
    const unknown = await request(port, '/mcp', rpc(2, 'initialize', { protocolVersion: '1999-01-01' }));
    expect(unknown.json().result.protocolVersion).toBe('2025-11-25');
  });

  it('lists tools with schema and annotations', async () => {
    const r = (await request(port, '/mcp', rpc(1, 'tools/list'))).json();
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(['whoami', 'boom', 'picture', 'hang', 'refuse']);
    expect(r.result.tools[0]).toEqual({ name: 'whoami', description: 'echo the scope', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } });
    expect(r.result.tools[1].annotations).toBeUndefined();
  });

  it('calls tools: text, image + text, and tool errors as isError results', async () => {
    const ok = (await request(port, '/mcp', rpc(1, 'tools/call', { name: 'whoami', arguments: { a: 1 } }))).json();
    expect(JSON.parse(ok.result.content[0].text)).toMatchObject({ mount: 'generic', args: { a: 1 } });
    const pic = (await request(port, '/mcp', rpc(2, 'tools/call', { name: 'picture' }))).json();
    expect(pic.result.content).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'a picture' }]);
    const bad = (await request(port, '/mcp', rpc(3, 'tools/call', { name: 'boom' }))).json();
    expect(bad.result).toEqual({ content: [{ type: 'text', text: 'Error: kaboom' }], isError: true });
  });

  it('logs a tool failure as a warning but an expected refusal only as info (issue #274)', async () => {
    const warn = vi.spyOn(log, 'warn'), info = vi.spyOn(log, 'info');
    try {
      await request(port, '/mcp', rpc(1, 'tools/call', { name: 'boom' }));
      const refused = (await request(port, '/mcp', rpc(2, 'tools/call', { name: 'refuse' }))).json();
      expect(refused.result).toEqual({ content: [{ type: 'text', text: 'Error: wrong role' }], isError: true });
      expect(warn.mock.calls.map(c => c[1])).toEqual(['tool boom failed']);
      expect(info.mock.calls.map(c => c[1])).toContain('tool refuse refused');
    } finally { warn.mockRestore(); info.mockRestore(); }
  });

  it('answers protocol errors: unknown tool, unknown method, parse error, invalid batch', async () => {
    const tool = (await request(port, '/mcp', rpc(1, 'tools/call', { name: 'nope' }))).json();
    expect(tool.error.code).toBe(-32602);
    expect(tool.error.message).toContain('Unknown tool: nope');
    expect((await request(port, '/mcp', rpc(2, 'resources/list'))).json().error.code).toBe(-32601);
    const parse = await request(port, '/mcp', '{not json');
    expect(parse.status).toBe(400);
    expect(parse.json().error.code).toBe(-32700);
    expect((await request(port, '/mcp', [])).status).toBe(400);
    expect((await request(port, '/mcp', rpc(3, 'ping'))).json()).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('handles JSON-RPC batches and answers notifications with 202', async () => {
    const r = await request(port, '/mcp', [rpc(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc(2, 'tools/list')]);
    expect(r.status).toBe(200);
    const out = r.json();
    expect(out.map((m: { id: number }) => m.id)).toEqual([1, 2]);
    const n = await request(port, '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.status).toBe(202);
    expect(n.body).toBe('');
    const resp = await request(port, '/mcp', { jsonrpc: '2.0', id: 9, result: {} });
    expect(resp.status).toBe(202);
  });

  it('refuses foreign Origin and Host headers with 403 (DNS rebinding, web pages)', async () => {
    expect((await request(port, '/mcp', rpc(1, 'ping'), { origin: 'http://evil.example' })).status).toBe(403);
    expect((await request(port, '/mcp', rpc(1, 'ping'), { origin: 'http://localhost:4200' })).status).toBe(403);
    expect((await request(port, '/mcp', rpc(1, 'ping'), { host: `evil.example:${port}` })).status).toBe(403);
    expect((await request(port, '/mcp', rpc(1, 'ping'), { host: `127.0.0.1:${port + 1}` })).status).toBe(403);
    expect((await request(port, '/mcp', rpc(1, 'ping'), { host: '127.0.0.1' })).status).toBe(403);
    expect((await request(port, '/mcp', rpc(1, 'ping'), { host: `localhost:${port}` })).status).toBe(200);
  });

  it('allows an explicitly allow-listed origin', async () => {
    const s = new McpServer({ name: 't', version: '1', allowedOrigins: ['http://localhost:6274'] });
    s.mount('/mcp', { name: 'g', instructions: '', tools });
    const p = await s.listen(0);
    expect((await request(p, '/mcp', rpc(1, 'ping'), { origin: 'http://localhost:6274' })).status).toBe(200);
    expect((await request(p, '/mcp', rpc(1, 'ping'), { origin: 'http://localhost:6275' })).status).toBe(403);
    await s.close();
  });

  it('accepts only POST application/json within the body cap', async () => {
    expect((await request(port, '/mcp', '', {}, 'GET')).status).toBe(405);
    expect((await request(port, '/mcp', JSON.stringify(rpc(1, 'ping')), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await request(port, '/mcp', JSON.stringify(rpc(1, 'ping')), { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
    expect((await request(port, '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(5000) } })).status).toBe(413);
  });

  it('answers 404 for unknown routes and wrong chat tokens', async () => {
    expect((await request(port, '/other', rpc(1, 'ping'))).status).toBe(404);
    expect((await request(port, '/mcp/extra', rpc(1, 'ping'))).status).toBe(404);
    expect((await request(port, '/mcp/chat/c1/not-a-token', rpc(1, 'ping'))).status).toBe(404);
    const t = tokens.tokenFor('c1');
    expect((await request(port, `/mcp/chat/c1/${t}`, rpc(1, 'ping'))).status).toBe(200);
    expect((await request(port, `/mcp/chat/c2/${t}`, rpc(1, 'ping'))).status).toBe(404);
  });

  it('isolates chats: each per-chat endpoint runs tools with its own chat id', async () => {
    const ta = tokens.tokenFor('chat-a'), tb = tokens.tokenFor('chat-b');
    const a = JSON.parse((await request(port, `/mcp/chat/chat-a/${ta}`, rpc(1, 'tools/call', { name: 'whoami' }))).json().result.content[0].text);
    const b = JSON.parse((await request(port, `/mcp/chat/chat-b/${tb}`, rpc(1, 'tools/call', { name: 'whoami' }))).json().result.content[0].text);
    expect(a).toMatchObject({ mount: 'chat', params: { chatId: 'chat-a' } });
    expect(b).toMatchObject({ mount: 'chat', params: { chatId: 'chat-b' } });
    const init = await request(port, `/mcp/chat/chat-a/${ta}`, rpc(1, 'initialize', {}));
    expect(init.json().result.instructions).toBe('chat instructions');
  });

  it('a mount\'s instructions may depend on the route (a chat\'s endpoint says only what applies to it)', async () => {
    const s = new McpServer({ name: 't', version: '0' });
    s.mount('/mcp/chat/:chatId/:token', { name: 'c', instructions: p => `for ${p.chatId}`, tools: [] });
    const port2 = await s.listen(0);
    try {
      expect((await request(port2, '/mcp/chat/x1/tok', rpc(1, 'initialize', {}))).json().result.instructions).toBe('for x1');
    } finally { await s.close(); }
  });

  it('gives each generic MCP session its own id (the browser uses it as the tab group)', async () => {
    const s1 = (await request(port, '/mcp', rpc(1, 'initialize', {}))).headers['mcp-session-id'] as string;
    const s2 = (await request(port, '/mcp', rpc(1, 'initialize', {}))).headers['mcp-session-id'] as string;
    expect(s1).not.toBe(s2);
    const who = async (sid: string) => JSON.parse((await request(port, '/mcp', rpc(2, 'tools/call', { name: 'whoami' }), { 'mcp-session-id': sid })).json().result.content[0].text).sessionId;
    expect(await who(s1)).toBe(s1);
    expect(await who(s2)).toBe(s2);
  });

  it('aborts a running tool when the client disconnects', async () => {
    await new Promise<void>(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('error', () => resolve());
      req.end(JSON.stringify(rpc(1, 'tools/call', { name: 'hang' })));
      setTimeout(() => { req.destroy(); resolve(); }, 150);
    });
    await expect.poll(() => aborted).toBe(true);
  });

  it('DELETE with a session id ends the session when the mount frees sessions (204), else 405', async () => {
    const ended: string[] = [];
    const s = new McpServer({ name: 't', version: '1' });
    s.mount('/mcp', { name: 'g', instructions: '', tools, onSessionEnd: (_p, sid) => { ended.push(sid); } });
    s.mount('/mcp/other', { name: 'o', instructions: '', tools });
    const p = await s.listen(0);
    expect((await request(p, '/mcp', '', { 'mcp-session-id': 'abc' }, 'DELETE')).status).toBe(204);
    expect(ended).toEqual(['abc']);
    expect((await request(p, '/mcp', '', {}, 'DELETE')).status).toBe(405);
    expect((await request(p, '/mcp/other', '', { 'mcp-session-id': 'abc' }, 'DELETE')).status).toBe(405);
    await s.close();
  });

  it('survives a client that disconnects in the middle of a body', async () => {
    await new Promise<void>(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100000' } });
      req.on('error', () => resolve());
      req.write('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"');
      setTimeout(() => { req.destroy(); resolve(); }, 100);
    });
    await new Promise(r => setTimeout(r, 100));
    expect((await request(port, '/mcp', rpc(1, 'ping'))).status).toBe(200);   // still serving
  });

  it('refuses a second mount on the same path', () => {
    expect(() => server.mount('/mcp', { name: 'dup', instructions: '', tools: [] })).toThrow(/already mounted/);
  });

  it('accepts a tools factory per call', async () => {
    const s = new McpServer({ name: 't', version: '1' });
    s.mount('/mcp/app', { name: 'app', instructions: '', tools: ({ sessionId }) => [{ name: `t_${sessionId ? 'session' : 'none'}`, description: '', inputSchema: {}, run: () => 'ok' }] });
    const p = await s.listen(0);
    expect((await request(p, '/mcp/app', rpc(1, 'tools/list'))).json().result.tools[0].name).toBe('t_none');
    await s.close();
  });

  describe('progress (long waits: Claude Code aborts a call silent for 300 s)', () => {
    const s = new McpServer({ name: 't', version: '1' });
    let p = 0;
    const said: boolean[] = [];
    beforeAll(async () => {
      s.mount('/mcp', { name: 'g', instructions: '', tools: [
        { name: 'slow', description: '', inputSchema: {}, run: async (_a, ctx) => {
          said.push(ctx.progress('waiting 1'));
          await new Promise(r => setTimeout(r, 20));
          said.push(ctx.progress('waiting 2'));
          return 'finished';
        } },
        { name: 'quick', description: '', inputSchema: {}, run: () => 'plain' },
      ] });
      p = await s.listen(0);
    });
    afterAll(() => s.close());
    const sse = { accept: 'application/json, text/event-stream' };
    const events = (body: string) => body.split('\n\n').filter(Boolean).map(e => JSON.parse(e.split('\n').find(l => l.startsWith('data: '))!.slice(6)));

    it('streams progress notifications then the result when the call has a progressToken', async () => {
      said.length = 0;
      const r = await request(p, '/mcp', rpc(7, 'tools/call', { name: 'slow', arguments: {}, _meta: { progressToken: 'tok-1' } }), sse);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/event-stream');
      const ev = events(r.body);
      expect(ev.map(e => e.method ?? 'result')).toEqual(['notifications/progress', 'notifications/progress', 'result']);
      expect(ev[0].params).toEqual({ progressToken: 'tok-1', progress: 1, message: 'waiting 1' });
      expect(ev[1].params.progress).toBe(2);                     // strictly increasing
      expect(ev[2]).toEqual({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'finished' }] } });
      expect(said).toEqual([true, true]);
    });

    it('notifications/cancelled aborts the call it names (same session), even with the connection open', async () => {
      let aborted = '';
      const c = new McpServer({ name: 't', version: '1' });
      c.mount('/mcp', { name: 'g', instructions: '', tools: [{ name: 'wait', description: '', inputSchema: {}, run: (a, ctx) => new Promise(res => {
        ctx.signal.addEventListener('abort', () => { aborted = String(a.tag); res('stopped'); });
      }) }] });
      const cp = await c.listen(0);
      const sid = (await request(cp, '/mcp', rpc(1, 'initialize', { protocolVersion: '2025-06-18' }))).headers['mcp-session-id'] as string;
      const call = request(cp, '/mcp', rpc(42, 'tools/call', { name: 'wait', arguments: { tag: 'x' } }), { 'mcp-session-id': sid });
      await new Promise(r => setTimeout(r, 50));
      await request(cp, '/mcp', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42 } }, { 'mcp-session-id': 'other' });
      await new Promise(r => setTimeout(r, 50));
      expect(aborted).toBe('');                                  // another session cannot cancel it
      expect((await request(cp, '/mcp', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42 } }, { 'mcp-session-id': sid })).status).toBe(202);
      expect((await call).json().result.content[0].text).toBe('stopped');
      expect(aborted).toBe('x');
      await c.close();
    });

    it('answers plain JSON when the tool never reports progress', async () => {
      const r = await request(p, '/mcp', rpc(8, 'tools/call', { name: 'quick', arguments: {}, _meta: { progressToken: 3 } }), sse);
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.json().result.content[0].text).toBe('plain');
    });

    it('cannot stream without a progressToken, without text/event-stream or in a batch: progress() says false', async () => {
      for (const [body, headers] of [
        [rpc(9, 'tools/call', { name: 'slow', arguments: {} }), sse],
        [rpc(10, 'tools/call', { name: 'slow', arguments: {}, _meta: { progressToken: 'x' } }), {}],
        [[rpc(11, 'tools/call', { name: 'slow', arguments: {}, _meta: { progressToken: 'x' } })], sse],
      ] as const) {
        said.length = 0;
        const r = await request(p, '/mcp', body, headers);
        expect(r.headers['content-type']).toBe('application/json');
        expect(said).toEqual([false, false]);
      }
    });
  });
});

describe('MCP helpers', () => {
  it('toContent maps outputs to MCP content blocks', () => {
    expect(toContent('')).toEqual([{ type: 'text', text: 'ok' }]);
    expect(toContent({ text: 'x' })).toEqual([{ type: 'text', text: 'x' }]);
  });

  it('mcpPortFromEnv: default 4319, 0 for tests, invalid falls back', () => {
    expect(mcpPortFromEnv({})).toBe(4319);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '0' })).toBe(0);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '5000' })).toBe(5000);
    expect(mcpPortFromEnv({ SB_MCP_PORT: 'abc' })).toBe(4319);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '70000' })).toBe(4319);
  });

  it('EndpointTokens: stable per key, unguessable, constant-time check, revocable', () => {
    const t = new EndpointTokens();
    const a = t.tokenFor('a');
    expect(a).toBe(t.tokenFor('a'));
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t.tokenFor('b')).not.toBe(a);
    expect(t.check('a', a)).toBe(true);
    expect(t.check('a', `${a}x`)).toBe(false);
    expect(t.check('b', a)).toBe(false);
    expect(t.check('zzz', a)).toBe(false);
    t.revoke('a');
    expect(t.check('a', a)).toBe(false);
  });
});
