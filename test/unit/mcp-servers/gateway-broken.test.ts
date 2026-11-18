// A user's MCP server whose program does not start (#417: 59 «MCP server tools not listed» warnings in 3 days for one
// server whose program could not start): the gateway does not start it again for every chat for BROKEN_MS, warns once
// until it works again, and puts the failure on its card (onBroken); «Prova» or a definition change (reset) tries it
// again at once. A slow or unreachable server keeps the hourly warning of #347. A server that refuses the access (#437:
// a login that ended) is never a warning: its card is told once, the chat reads what the user must do. Fakes for the
// upstream and the clock.
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
  const broken: string[] = [], works: string[] = [];
  const g = new McpGateway({
    mcp, servers: () => [def], roleAccess: () => undefined, endpoint: () => ({ transport: 'stdio', command: 'kb', args: [], env: {} }),
    context: () => ({ roles: [null], policy: null }), now: () => t, onBroken: s => broken.push(s), onWorks: s => works.push(s),
    connect: () => { started++; const e = fail(); return { serverInfo: undefined, tools: async () => { if (e) throw e; return [{ name: 'find', description: 'd', inputSchema: {} }]; }, call: async () => ({}), close() {} } as unknown as Upstream; },
  });
  gateways.push(g);
  const list = (chatId: string) => tools!({ params: { chatId, server: 'kb' } });
  return { g, list, started: () => started, broken, works, at: (ms: number) => { t = ms; } };
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
    expect(s.works).toEqual(['kb']);                          // its card shows it working again
    const slow = setup(() => new McpClientError('timeout', 'Il server non ha risposto', 'x'));
    await expect(slow.list('c1')).rejects.toThrow(/did not list/);
    await expect(slow.list('c2')).rejects.toThrow(/did not list/);
    expect(slow.started()).toBe(2);
    expect(slow.broken).toEqual([]);
  });

  it('a chat whose connection is up keeps it; a server that listed and then exits is not one that does not start', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {}); vi.spyOn(log, 'info').mockImplementation(() => {});
    let err: Error | null = null;
    const s = setup(() => err);
    await expect(s.list('c1')).resolves.toHaveLength(1);      // c1's program started
    err = new McpClientError('spawn', 'non è partito', 'x');
    await expect(s.list('c2')).rejects.toThrow(/did not list/);
    expect(s.broken).toEqual(['kb']);
    await expect(s.list('c1')).resolves.toHaveLength(1);      // not held back: its connection is up
    expect(s.works).toEqual([]);                              // a cached list says nothing about a new process
    await expect(s.list('c3')).rejects.toThrow(/did not start/);

    const up = setup(() => null);
    const conn = vi.fn();
    await expect(up.list('c1')).resolves.toHaveLength(1);
    // the same connection fails later with «spawn» (its program exited): the usual warning, no cool-down
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 3_600_000);
    (up.g as unknown as { conns: Map<string, { up: { tools: () => Promise<unknown> } }> }).conns.get('c1|kb')!.up.tools = async () => { conn(); throw new McpClientError('spawn', 'Il server si è chiuso', 'x'); };
    await expect(up.list('c1')).rejects.toThrow(/did not list/);
    later.mockRestore();
    expect(conn).toHaveBeenCalled();
    expect(up.broken).toEqual([]);
  });
});

describe('a user MCP server that refuses the access (#437)', () => {
  it('is never an app warning: its card is told once and the chat reads what the user must do', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {}), info = vi.spyOn(log, 'info').mockImplementation(() => {});
    let err: Error | null = new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'premi «Accedi» sulla scheda del connettore.', true);
    const s = setup(() => err);
    await expect(s.list('c1')).rejects.toThrow(/refused the access.*Only the user can fix it.*«Accedi»/);
    await expect(s.list('c2')).rejects.toThrow(/refused the access/);
    s.at(1000 + 2 * 3_600_000);                               // hours later: still no warning
    await expect(s.list('c3')).rejects.toThrow(/refused the access/);
    expect(s.started()).toBe(3);                              // never held back: it works as soon as the user signs in
    expect(warn.mock.calls.filter(c => c[0] === 'mcp-servers')).toHaveLength(0);
    expect(info.mock.calls.filter(c => c[1] === 'MCP server refuses the access')).toHaveLength(3);
    expect(s.broken).toEqual(['kb']);                         // the card once
    err = null;                                               // the user signed in
    await expect(s.list('c4')).resolves.toHaveLength(1);
    expect(s.works).toEqual(['kb']);
    err = new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'x', true);
    await expect(s.list('c5')).rejects.toThrow(/refused the access/);
    expect(s.broken).toEqual(['kb', 'kb']);                   // refused again later: the card is told again
  });
});
