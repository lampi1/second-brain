// The MCP gateway (ADR 0086): every app-managed MCP server reaches a chat through the app's own local MCP server, at
// /mcp/ext/<chatId>/<server>/<token> (127.0.0.1, Host/Origin checks, an unguessable per-chat token like ADR 0021's).
// Why a gateway and not the server's own definition in each engine's launch: the token stays in main (it goes only to
// that server's process or host, never on a command line, in a file or in a chat's environment); one enforcement point
// for every engine (Claude, Codex and Cursor all speak Streamable HTTP), so a role's tool limits hold the same way on
// all three; and an engine's config files are never needed (AGENTS.md rule 6). The engines get only the gateway URL:
// Claude in --mcp-config, Cursor in ACP session/new mcpServers, Codex as a `-c mcp_servers.<id>.url=` override.
// Access is checked at every request with the chat's live context (access.ts): a server the chat may not use answers
// 404, a tool it may not use is neither listed nor callable. One upstream connection per chat and server, opened on
// the first request, closed after 10 idle minutes, on a definition change and at shutdown. Used by service.ts.
import type { McpServer, McpTool } from '../mcp/server';
import { EndpointTokens } from '../mcp/tokens';
import { log, errText } from '../log';
import type { McpServerDef, RoleMcpAccess } from '../../shared/mcp-servers';
import { serversFor, toolFor, type ChatMcpContext } from './access';
import { connect, type Endpoint, type Upstream, type UpstreamTool } from './client';

export interface GatewayDeps {
  mcp: McpServer;
  servers: () => McpServerDef[];
  roleAccess: (role: string) => RoleMcpAccess | undefined;
  /** how to reach a server now, its tokens resolved (throws when one is missing) */
  endpoint: (id: string, chatId: string) => Endpoint;
  /** the chat's roles and policy; null = not a chat of this app (refused) */
  context: (chatId: string) => ChatMcpContext | null;
  /** tests and the demo: a fake upstream */
  connect?: (ep: Endpoint, def: McpServerDef) => Upstream;
  idleMs?: number;
}

interface Conn { up: Upstream; tools: Promise<UpstreamTool[]> | null; toolsAt: number; used: number; def: string }
const TOOLS_TTL = 5 * 60_000;

export class McpGateway {
  private readonly tokens = new EndpointTokens();
  private readonly conns = new Map<string, Conn>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    deps.mcp.mount('/mcp/ext/:chatId/:server/:token', {
      name: 'ext',
      instructions: 'An MCP server the user configured in the app (Impostazioni → Connettori), proxied by the app with this chat’s permissions.',
      authorize: p => !!p.chatId && !!p.server && this.tokens.check(p.chatId, p.token ?? '') && this.offered(p.chatId, p.server),
      who: p => p.chatId,
      tools: async ({ params }) => this.toolsFor(params.chatId!, params.server!),
    });
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref?.();
  }

  /** The endpoints a chat is given at launch, one per server it may use. `base` = the app MCP's origin. */
  urlsFor(chatId: string, base: string): { name: string; url: string }[] {
    const ctx = this.deps.context(chatId);
    if (!ctx) return [];
    const token = this.tokens.tokenFor(chatId);
    return serversFor(this.deps.servers(), ctx, this.deps.roleAccess).map(id => ({ name: id, url: `${base}/mcp/ext/${encodeURIComponent(chatId)}/${id}/${token}` }));
  }

  /** The managed servers this chat may not use (Claude refuses their tools by name, also a same-named server of its own). */
  deniedFor(chatId: string): string[] {
    const ctx = this.deps.context(chatId);
    const all = this.deps.servers().map(s => s.id);
    if (!ctx) return all;
    const ok = new Set(serversFor(this.deps.servers(), ctx, this.deps.roleAccess));
    return all.filter(id => !ok.has(id));
  }

  private offered(chatId: string, server: string): boolean {
    const ctx = this.deps.context(chatId);
    return !!ctx && serversFor(this.deps.servers(), ctx, this.deps.roleAccess).includes(server);
  }

  private conn(chatId: string, server: string): Conn {
    const def = this.deps.servers().find(s => s.id === server);
    if (!def) throw new Error(`MCP server ${server} is gone`);
    const key = `${chatId}|${server}`, shape = JSON.stringify(def);
    let c = this.conns.get(key);
    if (c && c.def !== shape) { c.up.close(); this.conns.delete(key); c = undefined; }
    if (!c) {
      const ep = this.deps.endpoint(server, chatId);
      c = { up: this.deps.connect ? this.deps.connect(ep, def) : connect(ep), tools: null, toolsAt: 0, used: Date.now(), def: shape };
      this.conns.set(key, c);
      log.info('mcp-servers', 'MCP server opened for a chat', { chat: chatId, data: { server, transport: def.transport } });
    }
    c.used = Date.now();
    return c;
  }

  private drop(chatId: string, server: string, c: Conn): void {
    if (this.conns.get(`${chatId}|${server}`) !== c) return;
    c.up.close();
    this.conns.delete(`${chatId}|${server}`);
  }

  private async toolsFor(chatId: string, server: string): Promise<McpTool[]> {
    const ctx = this.deps.context(chatId);
    if (!ctx) return [];
    const c = this.conn(chatId, server);
    if (!c.tools || Date.now() - c.toolsAt > TOOLS_TTL) { c.tools = c.up.tools(); c.toolsAt = Date.now(); }
    let list: UpstreamTool[];
    try { list = await c.tools; }
    catch (e) {
      this.drop(chatId, server, c);
      log.warn('mcp-servers', 'MCP server tools not listed', { chat: chatId, cause: errText(e), data: { server }, hint: 'test the server in Impostazioni → Connettori' });
      throw e;
    }
    return list.filter(t => toolFor(ctx, this.deps.roleAccess, server, t)).map(t => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations as McpTool['annotations'] } : {}),
      run: async (args, call) => {
        // checked again at the call: the agent card may have narrowed the role since the list
        const now = this.deps.context(chatId);
        if (!now || !toolFor(now, this.deps.roleAccess, server, t) || !this.offered(chatId, server)) throw new Error(`${t.name}: not allowed for this chat’s role (Brain → Agenti → its card → MCP)`);
        try { return { raw: await this.conn(chatId, server).up.call(t.name, args, call.signal) }; }
        catch (e) { this.drop(chatId, server, c); throw e; }
      },
    }));
  }

  /** A server's definition or token changed, or it was removed: its open connections close (the next call reopens). */
  reset(server?: string): void {
    for (const [key, c] of this.conns) if (!server || key.endsWith(`|${server}`)) { c.up.close(); this.conns.delete(key); }
  }

  /** connector processes / sessions open now (the health log, perf.ts) */
  get openCount(): number { return this.conns.size; }

  /** The chat closed (archived or removed): its server processes end now, not 10 idle minutes later. Every chat that
   *  starts lists its tools, so each open chat had its own copy of every connector running: closing many chats left
   *  them all up for 10 more minutes (2026-10-29). A reopened chat opens them again at its next call. */
  closeChat(chatId: string): void {
    for (const [key, c] of this.conns) if (key.startsWith(`${chatId}|`)) { c.up.close(); this.conns.delete(key); }
  }

  private sweep(): void {
    const idle = this.deps.idleMs ?? 10 * 60_000;
    for (const [key, c] of this.conns) if (Date.now() - c.used > idle) { c.up.close(); this.conns.delete(key); }
  }

  stop(): void { clearInterval(this.timer); this.reset(); }
}
