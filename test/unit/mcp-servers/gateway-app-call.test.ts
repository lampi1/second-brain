// The app's own call to a connector (McpGateway.callServer, ADR 0373: the «Attività pianificate» Outlook/Teams/Gmail readers):
// no chat, its own connection that every chat's never shares, the same health rules as a chat's call (a held server throws
// with the user's words and opens nothing; a failure counts in a row, the back-off's probe lets one call through), and
// heldReason tells why a server is held. Fakes for the upstream and the clock; no process, no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpGateway } from '../../../src/main/mcp-servers/gateway';
import { McpClientError } from '../../../src/main/mcp-servers/client';
import { log } from '../../../src/main/log';
import type { McpServer } from '../../../src/main/mcp/server';
import type { McpServerDef } from '../../../src/shared/mcp-servers';

const gateways: McpGateway[] = [];
afterEach(() => { for (const g of gateways.splice(0)) g.stop(); vi.restoreAllMocks(); });

function setup(callResult: () => Error | null) {
  vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(log, 'info').mockImplementation(() => {});
  const mcp = { mount: () => {} } as unknown as McpServer;
  const def = { id: 'mail', label: 'Mail', transport: 'stdio', command: 'mail', args: [], secrets: [], enabled: true } as unknown as McpServerDef;
  let started = 0;
  const calls: string[] = [];
  const g = new McpGateway({
    mcp, servers: () => [def], roleAccess: () => undefined, endpoint: () => ({ transport: 'stdio', command: 'mail', args: [], env: {} }),
    context: () => ({ roles: [null], policy: null }), now: () => 1000,
    connect: () => {
      started++;
      return {
        serverInfo: undefined,
        tools: async () => [],
        call: async (name: string) => { calls.push(name); const e = callResult(); if (e) throw e; return { content: [{ type: 'text', text: 'ok' }] }; },
        close: () => {},
      };
    },
  } as never);
  gateways.push(g);
  return { g, started: () => started, calls };
}

describe('McpGateway.callServer', () => {
  it('calls the tool on the app\'s own connection and reuses it', async () => {
    const s = setup(() => null);
    expect(s.g.heldReason('mail')).toBeNull();
    await expect(s.g.callServer('mail', 'outlook_get_unread', {})).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }] });
    await s.g.callServer('mail', 'outlook_get_unread', {});
    expect(s.calls).toEqual(['outlook_get_unread', 'outlook_get_unread']);
    expect(s.started()).toBe(1);
  });

  it('failures in a row mark the server held: the next call throws with the reason and opens nothing', async () => {
    const s = setup(() => new McpClientError('auth', 'Sessione scaduta', 'Accedi'));
    await expect(s.g.callServer('mail', 't', {})).rejects.toThrow(/Sessione scaduta/);
    await expect(s.g.callServer('mail', 't', {})).rejects.toThrow(/Sessione scaduta/);
    expect(s.g.heldReason('mail')).toEqual(expect.any(String));
    const opened = s.started();
    await expect(s.g.callServer('mail', 't', {})).rejects.toThrow();
    expect(s.started()).toBe(opened);
  });
});
