// The MCP gateway and service (ADR 0086) on a real local MCP server with fake upstreams: a chat gets only the servers
// its policy and its roles let through (a role without one gets 404; a child never more than its parent), tools are
// filtered (read-only, named) and refused again at the call, the token goes only into the upstream's endpoint (never in
// the URL a chat is given), a change on the card counts at once, "Prova" records a clear error, and the stdio fake
// works end to end through the gateway.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { McpServer } from '../../../src/main/mcp/server';
import { McpServersService } from '../../../src/main/mcp-servers/service';
import type { ChatMcpContext } from '../../../src/main/mcp-servers/access';
import type { Endpoint, Upstream, UpstreamTool } from '../../../src/main/mcp-servers/client';
import type { SecretCipher } from '../../../src/main/engines/secrets';
import { tmp } from '../chats/helpers';

const FAKE_STDIO = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-mcp-stdio.mjs');
const cipher: SecretCipher = { unavailable: () => null, encrypt: s => Buffer.from(s).reverse(), decrypt: b => Buffer.from(b).reverse().toString() };
const tools: UpstreamTool[] = [
  { name: 'list_items', description: '', readOnly: true, inputSchema: { type: 'object' } },
  { name: 'update_item', description: '', readOnly: false, inputSchema: { type: 'object' } },
];
const open: { mcp: McpServer; svc: McpServersService }[] = [];
afterEach(async () => { for (const o of open.splice(0)) { o.svc.stop(); await o.mcp.close(); } });

async function setup(contexts: Record<string, ChatMcpContext>, real = false) {
  const mcp = new McpServer({ name: 'test', version: '1' });
  const endpoints: Endpoint[] = [], calls: string[] = [];
  const fake = (ep: Endpoint): Upstream => { endpoints.push(ep); return { serverInfo: 'fake 1', tools: async () => tools, call: async name => { calls.push(name); return { content: [{ type: 'text', text: `ok ${name}` }] }; }, close() {} }; };
  const svc = new McpServersService({ userData: tmp('mcp-gw'), cipher, mcp, context: id => contexts[id] ?? null, home: tmp('home'), ...(real ? {} : { connect: fake }) });
  await mcp.listen(0);
  open.push({ mcp, svc });
  const base = `http://127.0.0.1:${mcp.port}`;
  return { mcp, svc, base, endpoints, calls };
}

let rpcId = 0;
async function rpc(url: string, method: string, params: unknown = {}): Promise<{ status: number; body: { result?: Record<string, unknown>; error?: { message: string } } | null }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return { status: res.status, body: res.status === 200 ? await res.json() as never : null };
}
const toolNames = async (url: string) => ((await rpc(url, 'tools/list')).body?.result?.tools as { name: string }[] | undefined)?.map(t => t.name);

const ado = { id: 'ado', label: 'Azure DevOps', transport: 'http', url: 'https://dev.example.com/mcp', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true };
const docs = { id: 'docs', label: 'Docs', transport: 'http', url: 'https://docs.example.com/mcp', secrets: [], enabled: true };

describe('MCP gateway', () => {
  it('gives every role every server by default, with the token only in the upstream endpoint', async () => {
    const { svc, base, endpoints } = await setup({ c1: { roles: ['artisan'], policy: null } });
    svc.save({ def: ado }); svc.save({ def: docs });
    svc.setSecret({ id: 'ado', slot: 'header:Authorization', value: 'pat-secret-1234567890' });
    const launch = svc.launch('c1', base);
    expect(launch.servers.map(s => s.name)).toEqual(['ado', 'docs']);
    expect(launch.denied).toEqual([]);
    expect(launch.servers.every(s => s.url.startsWith(`${base}/mcp/ext/c1/`) && !s.url.includes('pat-secret'))).toBe(true);
    expect(await toolNames(launch.servers[0]!.url)).toEqual(['list_items', 'update_item']);
    expect(endpoints[0]).toEqual({ transport: 'http', url: 'https://dev.example.com/mcp', headers: { Authorization: 'Bearer pat-secret-1234567890' } });
    expect(JSON.stringify(svc.state())).not.toContain('pat-secret');
  });

  it('a role limited on the card sees only the reading tools, and a call of another one is refused', async () => {
    const { svc, base, calls } = await setup({ c1: { roles: ['herald'], policy: null } });
    svc.save({ def: docs });
    const url = svc.launch('c1', base).servers[0]!.url;
    expect(await toolNames(url)).toEqual(['list_items', 'update_item']);
    svc.setAccess({ role: 'herald', server: 'docs', access: 'read' });
    expect(await toolNames(url)).toEqual(['list_items']);
    const refused = await rpc(url, 'tools/call', { name: 'update_item', arguments: {} });
    expect(refused.body?.error?.message).toMatch(/Unknown tool/);
    const ok = await rpc(url, 'tools/call', { name: 'list_items', arguments: {} });
    expect(ok.body?.result).toEqual({ content: [{ type: 'text', text: 'ok list_items' }] });
    expect(calls).toEqual(['list_items']);
    svc.setAccess({ role: 'herald', server: 'docs', access: { tools: ['update_item'] } });
    expect(await toolNames(url)).toEqual(['update_item']);
  });

  it('a role without the server, a policy without mcp, a wrong token and an unknown chat get nothing', async () => {
    const { svc, base } = await setup({
      judge: { roles: ['judge'], policy: null },
      noMcp: { roles: ['scout'], policy: { tools: { allow: ['read'] }, ceiling: null } },
      named: { roles: ['scout'], policy: { tools: { allow: ['read', 'mcp'], mcp: ['docs'] }, ceiling: null } },
    });
    svc.save({ def: ado }); svc.save({ def: docs });
    svc.setAccess({ role: 'judge', server: 'ado', access: 'none' });
    expect(svc.launch('judge', base)).toEqual({ servers: [expect.objectContaining({ name: 'docs' })], denied: ['ado'] });
    const docsUrl = svc.launch('judge', base).servers[0]!.url;
    expect((await rpc(docsUrl.replace('/docs/', '/ado/'), 'tools/list')).status).toBe(404);
    expect((await rpc(docsUrl.replace(/[^/]+$/, 'wrong-token'), 'tools/list')).status).toBe(404);
    expect(svc.launch('noMcp', base)).toEqual({ servers: [], denied: ['ado', 'docs'] });
    expect(svc.launch('named', base).servers.map(s => s.name)).toEqual(['docs']);
    expect(svc.launch('ghost', base)).toEqual({ servers: [], denied: ['ado', 'docs'] });
    // disabled: offered to nobody
    svc.save({ def: { ...docs, enabled: false }, previousId: 'docs' });
    expect(svc.launch('named', base).servers).toEqual([]);
  });

  it('a child never gets more than its parent', async () => {
    const { svc, base } = await setup({ child: { roles: ['scout', 'artisan'], policy: null }, root: { roles: ['scout'], policy: null } });
    svc.save({ def: docs });
    svc.setAccess({ role: 'artisan', server: 'docs', access: 'read' });
    expect(await toolNames(svc.launch('root', base).servers[0]!.url)).toEqual(['list_items', 'update_item']);
    expect(await toolNames(svc.launch('child', base).servers[0]!.url)).toEqual(['list_items']);
    svc.setAccess({ role: 'artisan', server: 'docs', access: 'none' });
    expect(svc.launch('child', base).servers).toEqual([]);
  });

  it('Prova records the tools or a clear error with a fix; a missing token is said before any connection', async () => {
    const { svc, endpoints } = await setup({});
    svc.save({ def: ado }); svc.save({ def: docs });
    const st = await svc.test('ado');
    const ado1 = st.servers.find(s => s.id === 'ado')!;
    expect(ado1.lastTest).toMatchObject({ ok: false, error: { code: 'secret', fix: expect.stringMatching(/Token/) } });
    expect(endpoints).toEqual([]);
    const ok = (await svc.test('docs')).servers.find(s => s.id === 'docs')!;
    expect(ok.lastTest).toMatchObject({ ok: true, serverInfo: 'fake 1', tools: [{ name: 'list_items', readOnly: true }, { name: 'update_item', readOnly: false }] });
  });

  it('runs a stdio server end to end, its token only in its own process environment', async () => {
    const { svc, base } = await setup({ c1: { roles: [null], policy: null } }, true);
    svc.save({ def: { id: 'local', label: 'Local', transport: 'stdio', command: FAKE_STDIO, args: [], secrets: [{ where: 'env', name: 'FAKE_MCP_TOKEN' }], enabled: true } });
    svc.setSecret({ id: 'local', slot: 'env:FAKE_MCP_TOKEN', value: 'tok-abcdefghijkl' });
    const url = svc.launch('c1', base).servers[0]!.url;
    expect(await toolNames(url)).toEqual(['read_items', 'write_item']);
    const r = await rpc(url, 'tools/call', { name: 'write_item', arguments: { x: 1 } });
    const text = ((r.body?.result?.content as { text: string }[])[0]!).text;
    expect(JSON.parse(text)).toEqual({ tool: 'write_item', args: { x: 1 }, token: 16 });
    expect(process.env.FAKE_MCP_TOKEN).toBeUndefined();
  });
});
