// A user's MCP server that keeps failing is not opened again for every chat (ADR 0370, after #417 and #437; on the
// owner's PC one server answered 401 at every chat, ~700 times in 7 hours, and one program never started): its failures
// in a row go to the health state machine (health.ts); marked needs-login or broken, every chat gets the same answer
// at once and nothing is opened, the user gets ONE notice (onMarked), the log one line per change of state, and the user's
// action (reset: «Accedi», a token, an edit, «Prova») or the back-off's probe tries it again. A refused access is never an
// app warning. Fakes for the upstream and the clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpGateway } from '../../../src/main/mcp-servers/gateway';
import { BACKOFF_MS } from '../../../src/main/mcp-servers/health';
import { McpClientError, type Upstream } from '../../../src/main/mcp-servers/client';
import { ToolRefusal } from '../../../src/main/mcp/refusal';
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
  const broken: string[] = [], works: string[] = [], marked: string[] = [];
  const g = new McpGateway({
    mcp, servers: () => [def], roleAccess: () => undefined, endpoint: () => ({ transport: 'stdio', command: 'kb', args: [], env: {} }),
    context: () => ({ roles: [null], policy: null }), now: () => t, onBroken: s => broken.push(s), onWorks: s => works.push(s),
    onMarked: (s, h) => marked.push(`${s}:${h.state}`),
    connect: () => { started++; const e = fail(); return { serverInfo: undefined, tools: async () => { if (e) throw e; return [{ name: 'find', description: 'd', inputSchema: {} }]; }, call: async () => ({}), close() {} } as unknown as Upstream; },
  });
  gateways.push(g);
  const list = (chatId: string) => tools!({ params: { chatId, server: 'kb' } });
  return { g, list, started: () => started, broken, works, marked, at: (ms: number) => { t = ms; } };
}
const quiet = () => ({ warn: vi.spyOn(log, 'warn').mockImplementation(() => {}), info: vi.spyOn(log, 'info').mockImplementation(() => {}) });
const lines = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.filter(c => c[0] === 'mcp-servers').map(c => String(c[1]));

describe('a user MCP server whose program does not start', () => {
  it('is marked broken after two failures in a row: no chat starts it again, one notice, one log line per change', async () => {
    const { warn, info } = quiet();
    const s = setup(() => new McpClientError('spawn', 'Il server si è chiuso (codice 1)', 'Controlla il comando'));
    await expect(s.list('c1')).rejects.toThrow(/did not list its tools/);
    await expect(s.list('c2')).rejects.toThrow(/did not list its tools/);
    for (const c of ['c3', 'c4', 'c5']) await expect(s.list(c)).rejects.toThrow(/marked broken after 2 failures.*again in 15 min.*Prova/);
    expect(s.started()).toBe(2);                              // the later chats started nothing
    expect(s.marked).toEqual(['kb:broken']);                  // ONE notice
    expect(s.broken).toEqual(['kb', 'kb']);                   // its card: the first failure, then marked
    expect(lines(warn)).toEqual(['MCP server failed', 'MCP server marked broken: not opened again for every chat']);
    s.at(1000 + BACKOFF_MS.broken[0]!);                       // the back-off ended: one probe, fails, nothing new told
    await expect(s.list('c6')).rejects.toThrow(/did not list/);
    await expect(s.list('c7')).rejects.toThrow(/again in 60 min/);
    expect(s.started()).toBe(3);
    expect(s.marked).toEqual(['kb:broken']);
    expect(lines(warn)).toHaveLength(2);
    expect(lines(info).filter(l => /MCP server/.test(l) && !/opened for a chat/.test(l))).toEqual([]);
    s.g.reset('kb');                                          // «Prova» or a changed definition: at once
    await expect(s.list('c8')).rejects.toThrow(/did not list/);
    expect(s.started()).toBe(4);
  });

  it('works again: its card shows it, a later failure counts from zero', async () => {
    quiet();
    let err: Error | null = new McpClientError('spawn', 'non è partito', 'x');
    const s = setup(() => err);
    await expect(s.list('c1')).rejects.toThrow();
    await expect(s.list('c2')).rejects.toThrow();
    err = null;
    s.at(1000 + BACKOFF_MS.broken[0]!);
    await expect(s.list('c3')).resolves.toHaveLength(1);
    expect(s.works).toEqual(['kb']);
    err = new McpClientError('spawn', 'non è partito', 'x');
    await expect(s.list('c4')).rejects.toThrow(/did not list/);
    expect(s.g.health.get('kb')).toMatchObject({ state: 'failing', streak: 1 });
  });

  it('a slow server is marked only after three timeouts in a row', async () => {
    const { warn } = quiet();
    const slow = setup(() => new McpClientError('timeout', 'Il server non ha risposto in 30 s.', 'x'));
    for (const c of ['c1', 'c2', 'c3']) await expect(slow.list(c)).rejects.toThrow(/did not list/);
    await expect(slow.list('c4')).rejects.toThrow(/marked broken after 3 failures/);
    expect(slow.started()).toBe(3);
    expect(slow.marked).toEqual(['kb:broken']);
    expect(lines(warn)).toEqual(['MCP server failed', 'MCP server marked broken: not opened again for every chat']);
  });

  it('a chat whose connection is up keeps it; a server that listed and then exits is not one that does not start', async () => {
    quiet();
    let err: Error | null = null;
    const s = setup(() => err);
    await expect(s.list('c1')).resolves.toHaveLength(1);      // c1's program started
    err = new McpClientError('spawn', 'non è partito', 'x');
    await expect(s.list('c2')).rejects.toThrow(/did not list/);
    await expect(s.list('c3')).rejects.toThrow(/did not list/);
    expect(s.marked).toEqual(['kb:broken']);
    await expect(s.list('c1')).resolves.toHaveLength(1);      // not held back: its connection is up
    expect(s.works).toEqual([]);                              // a cached list says nothing about a new process
    await expect(s.list('c4')).rejects.toThrow(/marked broken/);

    const up = setup(() => null);
    const conn = vi.fn();
    await expect(up.list('c1')).resolves.toHaveLength(1);
    // the same connection fails later with «spawn» (its program exited): it reconnects, nothing counted
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 3_600_000);
    (up.g as unknown as { conns: Map<string, { up: { tools: () => Promise<unknown> } }> }).conns.get('c1|kb')!.up.tools = async () => { conn(); throw new McpClientError('spawn', 'Il server si è chiuso', 'x'); };
    await expect(up.list('c1')).rejects.toThrow(/did not list/);
    later.mockRestore();
    expect(conn).toHaveBeenCalled();
    expect(up.broken).toEqual([]);
    expect(up.g.health.get('kb').state).toBe('ok');
  });
});

describe('a user MCP server that refuses the access', () => {
  it('is marked needs-login after two refusals: never an app warning, one notice, held back until the user signs in', async () => {
    const { warn, info } = quiet();
    let err: Error | null = new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'premi «Accedi» sulla scheda del connettore.', true);
    const s = setup(() => err);
    await expect(s.list('c1')).rejects.toThrow(/refused the access.*Only the user can fix it.*«Accedi»/);
    await expect(s.list('c2')).rejects.toThrow(/refused the access/);
    for (let i = 3; i < 40; i++) await expect(s.list(`c${i}`)).rejects.toThrow(/needs the user's sign-in.*refused the access 2 times.*«Accedi».*again by itself in 6 h/);
    expect(s.started()).toBe(2);                              // 37 more chats opened nothing
    expect(s.marked).toEqual(['kb:needs-login']);
    expect(lines(warn)).toEqual([]);
    expect(lines(info).filter(l => !/opened for a chat/.test(l))).toEqual(['MCP server failed', 'MCP server marked needs-login: not opened again for every chat']);
    err = null;
    s.g.reset('kb');                                          // the user signed in («Accedi» resets it)
    await expect(s.list('c40')).resolves.toHaveLength(1);
    expect(s.started()).toBe(3);
    err = new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'x', true);
    await expect(s.list('c41')).rejects.toThrow(/refused the access/);
    await expect(s.list('c42')).rejects.toThrow(/refused the access/);
    expect(s.marked).toEqual(['kb:needs-login', 'kb:needs-login']);   // a new run: told anew
  });

  it('an access that ends after the list: the call is a refusal with the same words and counts, no warning', async () => {
    const { warn } = quiet();
    const s = setup(() => null);
    const tools = await s.list('c1') as { name: string; run: (a: object, c: object) => Promise<unknown> }[];
    (s.g as unknown as { conns: Map<string, { up: { call: () => Promise<unknown> } }> }).conns.get('c1|kb')!.up.call = async () => { throw new McpClientError('auth', 'Accesso rifiutato (HTTP 401).', 'premi «Accedi».', true); };
    const call = tools[0]!.run({}, { signal: new AbortController().signal });
    await expect(call).rejects.toBeInstanceOf(ToolRefusal);
    await expect(call).rejects.toThrow(/refused the access.*Only the user can fix it/);
    expect(s.broken).toEqual(['kb']);
    expect(s.g.health.get('kb')).toMatchObject({ state: 'failing', kind: 'auth' });
    expect(lines(warn)).toEqual([]);
    await expect(s.list('c1')).resolves.toHaveLength(1);       // it lists again (a new connection): the card shows it working
    expect(s.works).toEqual(['kb']);
  });
});
