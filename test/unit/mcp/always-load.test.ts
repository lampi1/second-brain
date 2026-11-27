// ADR 0371 point 2 (#492): the app's own MCP tools are never deferred behind ToolSearch, for every role. A mount marked
// alwaysLoad lists each tool with _meta anthropic/alwaysLoad, and a role chat's --mcp-config marks the app's servers
// alwaysLoad, on the real ChatManager → ClaudeSession spawn path (no engine runs: the session factory only records).
// Red before ADR 0371: tools/list carried no _meta and the config no alwaysLoad, so Claude deferred agent_report,
// plan_propose and agent_delegate (29 «input schema was not in your prompt» in 20 hours).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import { ALWAYS_LOAD, McpServer, type McpTool } from '../../../src/main/mcp/server';
import { plainOwner } from '../../../src/main/agents/catalog';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-al-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const list = async (mount: { name: string; instructions: string; tools: McpTool[]; alwaysLoad?: boolean }): Promise<{ name: string; _meta?: Record<string, unknown> }[]> => {
  const s = new McpServer({ name: 't', version: '0', port: 0 } as unknown as ConstructorParameters<typeof McpServer>[0]);
  const r = await (s as unknown as { handle(m: unknown, mount: unknown, ctx: unknown): Promise<{ result: { tools: { name: string; _meta?: Record<string, unknown> }[] } }> })
    .handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, mount, { mount: 't', params: { chatId: 'c1' }, sessionId: 's', signal: new AbortController().signal, progress: () => false });
  return r.result.tools;
};
const tool = (name: string, meta?: Record<string, unknown>): McpTool => ({ name, description: 'd', inputSchema: { type: 'object' }, ...(meta ? { meta } : {}), run: () => 'ok' });

async function roleChat(harness: 'claude' | 'cursor'): Promise<SessionOptions> {
  const seen: SessionOptions[] = [];
  const m = new ChatManager({
    userData: tmp(), emitter: { emit: () => {} } as never, brainRoot: () => null,
    mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/token`,
    sessionFactory: (h, options, s): HarnessSession => { seen.push(options); return { harness: h, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { s.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {} }; },
  });
  managers.push(m);
  const owner = { ...plainOwner(harness, null), source: 'catalog' as const, id: 'strategist', version: 1 };
  const chat = await m.create({ harness, cwd: tmp(), title: 'Ordini · Piano' }, 'agent', { owner, instructions: 'Pianifica.', policy: null });
  await m.send(chat.id, 'Fai il piano.');
  return seen.at(-1)!;
}

describe('#492 point 2: the app tool schemas are always loaded', () => {
  it('an alwaysLoad mount lists every tool with _meta anthropic/alwaysLoad, keeping its own _meta; another mount adds none', async () => {
    const tools = [tool('agent_report'), tool('plan_propose', { 'anthropic/searchHint': 'plan' })];
    const on = await list({ name: 'browser-chat', instructions: '', tools, alwaysLoad: true });
    expect(on.map(t => t._meta?.[ALWAYS_LOAD])).toEqual([true, true]);
    expect(on[1]!._meta).toMatchObject({ 'anthropic/searchHint': 'plan' });
    const off = await list({ name: 'other', instructions: '', tools });
    expect(off[0]!._meta).toBeUndefined();
  });

  it('a Claude role chat gets the app servers in --mcp-config with alwaysLoad: true', async () => {
    const opts = await roleChat('claude');
    const args = new ClaudeSession(opts, { changed: () => {} } as never).args();
    const i = args.lastIndexOf('--mcp-config');
    const servers = JSON.parse(args[i + 1]!).mcpServers as Record<string, { url: string; alwaysLoad?: boolean }>;
    expect(servers['second-brain']).toMatchObject({ alwaysLoad: true });
  });

  it('another engine (Cursor) gets the same endpoint, whose tools carry the mark themselves', async () => {
    const opts = await roleChat('cursor');
    const servers = JSON.parse(opts.mcpConfig!).mcpServers as Record<string, { url: string }>;
    expect(servers['second-brain']!.url).toContain('/mcp/chat/');
  });
});
