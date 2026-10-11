// The browser module: BrowserService (tabs for the UI, IPC) + the local MCP server that lets agents drive those tabs.
// Routes: /mcp (external clients; each MCP session gets its own tab group) and /mcp/chat/<chatId>/<token> (one per app
// chat, token from mcpUrlFor). The server is returned too, so wiring.ts can mount more tool sets (e.g. /mcp/app).
// Port: SB_MCP_PORT (0 = random, tests), default 4319; if it is taken the app falls back to a random port and logs
// why. Used by wiring.ts.
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import type { BrowserService } from '../services';
import type { Emitter } from '../ipc';
import { log, errText } from '../log';
import { McpServer, type CallCtx } from '../mcp/server';
import { EndpointTokens } from '../mcp/tokens';
import { BrowserTabs } from './tabs';
import { BrowserActions, normalizeUrl } from './actions';
import { browserTools, type Scope } from './tools';

export { mcpPortFromEnv } from '../mcp/server';

const INSTRUCTIONS = [
  "Internal browser of the user's second-brain app (Electron, persistent profile: logins survive restarts).",
  'You see and drive only your own tabs. Read with read_page (tree with refs: e12 in the page, f1e7 inside iframe f1, cross-origin iframes included), find, get_page_text.',
  'Act with click, type, key, fill_form, select_option, scroll, hover, drag: trusted input, like a real user. Every action returns what changed (URL, dialogs, console errors, failed requests, new tabs, downloads).',
  'screenshot: image pixels = CSS pixels = click coordinates; save_to stores QA evidence and returns the path.',
  'A JavaScript alert/confirm blocks the page until you call handle_dialog. Popups and target=_blank links open as new tabs of yours.',
  'Each tab lives in an environment (its own cookies and storage; default from the host, e.g. example-test-3, local); environments shows them with their sign-in status.',
  'HARD LIMIT: you never type a password on a remote host (the tools refuse it). On a sign-in page call handoff_to_user with kind "login": the user signs in once and the environment keeps the session. On local stacks (localhost, 127.0.0.1, *.localhost, *.test) you may sign in with the project\'s test accounts.',
  'For MFA, CAPTCHA or anything only the user can do, call handoff_to_user and wait: never ask them for passwords.',
].join('\n');

export interface BrowserModule { service: BrowserService; mcp: McpServer }

export async function createBrowserModule(o: { emitter: Emitter; window: () => BrowserWindow | null; userData: string; port: number }): Promise<BrowserModule> {
  const tabs = new BrowserTabs({ emitter: o.emitter, window: o.window, userData: o.userData });
  const actions = new BrowserActions(tabs);
  const tokens = new EndpointTokens();
  const mcp = new McpServer({ name: 'second-brain-browser', version: app.getVersion() });

  const generic = (ctx: CallCtx): Scope => ({ group: `mcp:${ctx.sessionId || 'default'}`, owner: null, chatId: null });
  const perChat = (ctx: CallCtx): Scope => ({ group: `chat:${ctx.params.chatId}`, owner: ctx.params.chatId ?? null, chatId: ctx.params.chatId ?? null });
  mcp.mount('/mcp', {
    name: 'browser', instructions: INSTRUCTIONS, tools: browserTools(tabs, actions, generic), who: (_p, sid) => (sid ? `mcp:${sid.slice(0, 8)}` : 'mcp'),
    // an external client (Claude desktop, Cursor) ended its MCP session: its tabs would be unreachable, close them
    onSessionEnd: (_p, sid) => { const n = tabs.closeGroup(`mcp:${sid}`); log.info('browser', 'external session ended', { data: { session: sid.slice(0, 8), closedTabs: n } }); },
  });
  mcp.mount('/mcp/chat/:chatId/:token', {
    name: 'browser-chat', instructions: INSTRUCTIONS, tools: browserTools(tabs, actions, perChat),
    authorize: p => !!p.chatId && !!p.token && tokens.check(p.chatId, p.token),
    who: p => p.chatId,
  });

  try {
    await mcp.listen(o.port);
  } catch (e) {
    if (o.port === 0) throw e;
    log.error('mcp', `port ${o.port} unavailable, using a random port`, {
      cause: errText(e),
      hint: `another second-brain (or the prototype) may hold ${o.port}: close it, or set SB_MCP_PORT. App chats still work; external clients configured on ${o.port} will not connect this run`,
    });
    await mcp.listen(0);
  }

  const tabById = (id: string) => {
    const t = tabs.tabs.get(id);
    if (!t) throw new Error(`browser: no tab ${id}`);
    return t;
  };

  const service: BrowserService = {
    list: () => tabs.list(),
    open: (url, ownerChatId, env) => {
      const target = url ? normalizeUrl(url) : 'about:blank';
      const tab = tabs.create(ownerChatId ? `chat:${ownerChatId}` : 'user', ownerChatId ?? null, target, env ? { env } : {});
      return tabs.toBrowserTab(tab);
    },
    navigate: async (tabId, url) => {
      const target = normalizeUrl(url);
      const t = tabs.prepareFor(tabById(tabId), target).tab;   // a fresh tab moves to the host's environment first
      await t.wc.loadURL(target).catch(e => { if (!/ERR_ABORTED/.test(errText(e))) throw new Error(`browser: could not load ${url}: ${errText(e)}`); });
    },
    go: async (tabId, dir) => {
      const t = tabById(tabId);
      if (dir === 'back' && t.wc.navigationHistory.canGoBack()) t.wc.navigationHistory.goBack();
      else if (dir === 'forward' && t.wc.navigationHistory.canGoForward()) t.wc.navigationHistory.goForward();
      else if (dir === 'reload') t.wc.reload();
    },
    close: tabId => tabs.close(tabId),
    layout: views => tabs.layout(views),
    mcpUrlFor: chatId => (chatId ? mcp.url(`/mcp/chat/${encodeURIComponent(chatId)}/${tokens.tokenFor(chatId)}`) : mcp.url('/mcp')),
    handoffs: () => tabs.handoffs.list(),
    resolveHandoff: (id, outcome, note) => {
      const h = tabs.handoffs.resolve(id, outcome, note);
      log.info('browser', 'hand-off answered by the user', { chat: h.chatId ?? undefined, data: { id, outcome } });
    },
    envs: () => tabs.envList(),
    forgetChat: chatId => {
      const n = tabs.closeGroup(`chat:${chatId}`);
      tokens.revoke(chatId);
      log.info('browser', 'chat forgotten: tabs closed, MCP token revoked', { chat: chatId, data: { closedTabs: n } });
    },
    setFeed: fn => tabs.setFeed(fn),
    shutdown: async () => {
      await tabs.shutdown();
      await mcp.close();
    },
  };
  return { service, mcp };
}
