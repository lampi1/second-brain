// A user's MCP server whose program does not start (#417: 59 «MCP server tools not listed» warnings in 3 days for one
// server whose program could not start): the gateway does not start it again for every chat for BROKEN_MS, warns once
// until it works again, and puts the failure on its card (onBroken); «Prova» or a definition change (reset) tries it
// again at once. A slow or unreachable server keeps the hourly warning of #347. Fakes for the upstream and the clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROKEN_MS, McpGateway } from '../../../src/main/mcp-servers/gateway';
import { McpClientError, type Upstream } from '../../../src/main/mcp-servers/client';
import type { McpServer } from '../../../src/main/mcp/server';
import type { McpServerDef } from '../../../src/shared/mcp-servers';
import { log } from '../../../src/main/log';

const gateways: McpGateway[] = [];
afterEach(() => { for (const g of gateways.splice(0)) g.stop(); vi.restoreAllMocks(); });

function setup(fail: () => Error | null) {
  let tools: ((a: { params: Record<string, string> }) => Promise<unknown>) | undefined;
  const mcp = { mount: (_p: string, o: { tools: typeof tools }) => { tools = o.tools; } } as unknown as McpServer;
  const def = { id: 'kb', label: 'KB', transport: 'stdio', command: 'kb', args: [], secrets: [], enabled: true } as unknown as McpServerDef;
  let t = 1000, started = 0;
  const broken: string[] = [];
  const g = new McpGateway({
    mcp, servers: () => [def], roleAccess: () => undefined, endpoint: () => ({ transport: 'stdio', command: 'kb', args: [], env: {} }),
    context: () => ({ roles: [null], policy: null }), now: () => t, onBroken: s => broken.push(s),
    connect: () => { started++; const e = fail(); return { serverInfo: undefined, tools: async () => { if (e) throw e; return [{ name: 'find', description: 'd', inputSchema: {} }]; }, call: async () => ({}), close() {} } as unknown as Upstream; },
  });
  gateways.push(g);
  const list = (chatId: string) => tools!({ params: { chatId, server: 'kb' } });
  return { g, list, started: () => started, broken, at: (ms: number) => { t = ms; } };
}

describe('a user MCP server whose program does not start (#417)', () => {
  it('is not started again for every chat, is warned once, and goes on its card', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {}), info = vi.spyOn(log, 'info').mockImplementation(() => {});
    const s = setup(() => new McpClientError('spawn', 'Il server si è chiuso (codice 1)', 'Controlla il comando'));
    await expect(s.list('c1')).rejects.toThrow(/did not list its tools/);
    await expect(s.list('c2')).rejects.toThrow(/did not start .*tries it again in 10 min.*Prova/);
    expect(s.started()).toBe(1);                              // the second chat started nothing
    expect(s.broken).toEqual(['kb']);
    s.at(1000 + BROKEN_MS);                                   // tried again later: fails again, not warned again
    await expect(s.list('c3')).rejects.toThrow(/did not list/);
    expect(s.started()).toBe(2);
    expect(warn.mock.calls.filter(c => c[0] === 'mcp-servers')).toHaveLength(1);
    expect(info.mock.calls.some(c => c[1] === 'MCP server still does not start')).toBe(true);
    expect(s.broken).toEqual(['kb']);
    s.g.reset('kb');                                          // «Prova» or a changed definition: at once
    await expect(s.list('c4')).rejects.toThrow(/did not list/);
    expect(s.started()).toBe(3);
    expect(warn.mock.calls.filter(c => c[0] === 'mcp-servers')).toHaveLength(2);
  });

  it('works again: a later failure is warned again; a slow server is never held back', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {}); vi.spyOn(log, 'info').mockImplementation(() => {});
    let err: Error | null = new McpClientError('spawn', 'non è partito', 'x');
    const s = setup(() => err);
    await expect(s.list('c1')).rejects.toThrow();
    err = null;
    s.at(1000 + BROKEN_MS);
    await expect(s.list('c2')).resolves.toHaveLength(1);
    const slow = setup(() => new McpClientError('timeout', 'Il server non ha risposto', 'x'));
    await expect(slow.list('c1')).rejects.toThrow(/did not list/);
    await expect(slow.list('c2')).rejects.toThrow(/did not list/);
    expect(slow.started()).toBe(2);
    expect(slow.broken).toEqual([]);
  });
});
