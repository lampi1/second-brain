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
// A broken server is not opened again for every chat (ADR 0370, after #417 and #437; on the owner's PC one server answered
// 401 at every chat, ~700 times in 7 hours): its failures in a row go to the health state machine (health.ts). The first
// one goes on its Connettori card (onBroken); N in a row mark it «needs-login» (HTTP 401/403) or «broken» (its program
// does not start, it times out or is unreachable): every chat then gets the same answer at once, nothing is opened, the
// user gets one notice (onMarked: «Accedi» for a login), and it is tried again only when the user signs in, edits or
// tries it (reset) or after a long back-off, one probe at a time. One log line per change of its state, never per chat;
// a refused access is the user's to fix, never an app warning.
import type { McpServer, McpTool } from '../mcp/server';
import { EndpointTokens } from '../mcp/tokens';
import { ToolRefusal, UpstreamError } from '../mcp/refusal';
import { McpClientError } from './client';
import { log, errText } from '../log';
import type { McpServerDef, RoleMcpAccess } from '../../shared/mcp-servers';
import { serversFor, toolFor, type ChatMcpContext } from './access';
import { connect, type Endpoint, type Upstream, type UpstreamTool } from './client';
import { ConnectorHealth, failKind, waitText, type ServerHealth, type Transition } from './health';

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
  /** a server whose process did not start, or that refused the access: its card shows the failure (service.ts records
   *  it as its last test) */
  onBroken?: (server: string, error: unknown) => void;
  /** it started again after that: its card shows its tools again */
  onWorks?: (server: string, tools: UpstreamTool[]) => void;
  /** it was just marked «needs-login» or «broken» (N failures in a row): the one notice to the user (service.ts) */
  onMarked?: (server: string, health: ServerHealth, error: unknown) => void;
  now?: () => number;
  idleMs?: number;
}

/** listed: it gave its tools once (its program started: a later failure of it is not one that does not start) */
interface Conn { up: Upstream; tools: Promise<UpstreamTool[]> | null; toolsAt: number; used: number; def: string; listed?: boolean }
const TOOLS_TTL = 5 * 60_000;

export class McpGateway {
  private readonly tokens = new EndpointTokens();
  private readonly conns = new Map<string, Conn>();
  /** each server's failures in a row and whether it is held back (health.ts) */
  readonly health: ConnectorHealth;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    this.health = new ConnectorHealth(deps.now ?? Date.now);
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

  /** Code Mode (ADR 0331): the servers this chat may use, for run_code's in-process forwarding. */
  chatServers(chatId: string): string[] {
    const ctx = this.deps.context(chatId);
    return ctx ? serversFor(this.deps.servers(), ctx, this.deps.roleAccess) : [];
  }

  /** One of those servers' tools as the chat's own endpoint lists them (each run checks the role again). */
  chatServerTools(chatId: string, server: string): Promise<McpTool[]> {
    return this.offered(chatId, server) ? this.toolsFor(chatId, server) : Promise.resolve([]);
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
    // held back only where a new connection would open: a chat whose connection is up keeps using it
    if (!this.conns.has(`${chatId}|${server}`)) {
      const g = this.health.gate(server);
      if (!g.open) throw new UpstreamError(heldText(server, g.health, g.waitMs));
    }
    const c = this.conn(chatId, server);
    const asked = !c.tools || Date.now() - c.toolsAt > TOOLS_TTL;   // the server is asked now (else the chat's cached list)
    if (asked) { c.tools = c.up.tools(); c.toolsAt = Date.now(); }
    let list: UpstreamTool[];
    try { list = await c.tools!; }
    catch (e) {
      // a connection the app itself closed meanwhile (the chat closed, a definition change) is not a server that failed
      const ours = this.conns.get(`${chatId}|${server}`) === c;
      this.drop(chatId, server, c);
      const code = e instanceof McpClientError ? e.code : undefined;
      // «spawn» on a connection that listed before is its program exiting later: it reconnects, it is not one that
      // does not start (#417); any other failure of a request made now counts
      if (ours && !(code === 'spawn' && c.listed)) {
        this.failed(chatId, server, e);
        if (code === 'auth') throw new UpstreamError(refusedText(server, e as McpClientError));
      }
      throw new UpstreamError(`MCP server ${server} did not list its tools: ${errText(e)}`);
    }
    c.listed = true;
    // a list the server just gave says it works; a chat's cached list says nothing about it
    if (asked) this.worked(server, list);
    return list.filter(t => toolFor(ctx, this.deps.roleAccess, server, t)).map(t => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations as McpTool['annotations'] } : {}),
      run: async (args, call) => {
        // checked again at the call: the agent card may have narrowed the role since the list
        const now = this.deps.context(chatId);
        if (!now || !toolFor(now, this.deps.roleAccess, server, t) || !this.offered(chatId, server)) throw new Error(`${t.name}: not allowed for this chat’s role (Brain → Agenti → its card → MCP)`);
        try { return { raw: await this.conn(chatId, server).up.call(t.name, args, call.signal) }; }
        catch (e) {
          this.drop(chatId, server, c);
          // the access ended after the list (a token that expired mid-chat): the same answer as at the list (#437)
          if (e instanceof McpClientError && e.code === 'auth') { this.failed(chatId, server, e); throw new ToolRefusal(refusedText(server, e)); }
          throw e;
        }
      },
    }));
  }

  /** A failure of a request made now: one more in a row. Its card is told at the first failure of a run and when its
   *  state changes, the user once when it is marked, and the log gets one line per change of state (a repeat changes
   *  nothing, so it logs nothing). */
  private failed(chatId: string, server: string, e: unknown): Transition {
    const kind = failKind(e instanceof McpClientError ? e.code : undefined);
    const t = this.health.failed(server, kind, errText(e));
    if (t.from === t.to) return t;
    const held = t.to === 'needs-login' || t.to === 'broken';
    const data = { server, kind, failures: t.health.streak, ...(held ? { retryIn: waitText(t.health.until - (this.deps.now ?? Date.now)()) } : {}) };
    const hint = kind === 'auth' ? 'its card in Impostazioni → Connettori asks for «Accedi» (or a valid token)' : 'its card in Impostazioni → Connettori shows the error; «Prova» there tries it again';
    // a refused access is the user's to fix, never an app warning (#437)
    const level = kind === 'auth' ? 'info' : 'warn';
    const msg = t.to === 'failing' ? 'MCP server failed' : `MCP server marked ${t.to}: not opened again for every chat`;
    log[level]('mcp-servers', msg, { chat: chatId, cause: errText(e), data, hint });
    if (t.from === 'ok' || held) try { this.deps.onBroken?.(server, e); } catch { /* the card is a convenience */ }
    if (held && (t.from === 'ok' || t.from === 'failing')) try { this.deps.onMarked?.(server, t.health, e); } catch { /* the notice is a convenience */ }
    return t;
  }

  /** It listed on a request made now: back to ok; told (log, card) only when something was known against it. */
  private worked(server: string, list: UpstreamTool[]): void {
    const t = this.health.worked(server);
    if (t.from === 'ok') return;
    log.info('mcp-servers', 'MCP server works again', { data: { server, was: t.from } });
    try { this.deps.onWorks?.(server, list); } catch { /* the card is a convenience */ }
  }

  /** A server's definition or token changed, or it was removed: its open connections close (the next call reopens). */
  reset(server?: string): void {
    // a changed definition gets its own first warning again
    // the user acted on it («Accedi», a token, an edit, «Prova») or it is gone: tried again at once, told anew
    this.health.reset(server);
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

/** What a chat reads while the server is held back. */
function heldText(server: string, h: ServerHealth, waitMs: number): string {
  if (h.state === 'needs-login') return `MCP server ${server} needs the user's sign-in: it refused the access ${h.streak} times in a row (${h.cause}). Only the user can fix it: «Accedi» on its notice or on its card in Impostazioni → Connettori. The app tries it again by itself in ${waitText(waitMs)}. Tell the user; do not retry before.`;
  return `MCP server ${server} is marked broken after ${h.streak} failures in a row (${h.cause}); the app tries it again in ${waitText(waitMs)}, or when the user presses «Prova» on its card (Impostazioni → Connettori).`;
}

/** What a chat reads when the server refuses the access. */
function refusedText(server: string, e: McpClientError): string {
  return `MCP server ${server} refused the access: ${errText(e)} Only the user can fix it, on the server's card in Impostazioni → Connettori: ${e.fix} Tell the user; do not retry before.`;
}
