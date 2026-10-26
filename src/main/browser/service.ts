// The browser module: BrowserService (tabs for the UI, IPC) + the local MCP server that lets agents drive those tabs.
// Routes: /mcp (external clients; each MCP session gets its own tab group) and /mcp/chat/<chatId>/<token> (one per app
// chat, token from mcpUrlFor). The server is returned too, so wiring.ts can mount more tool sets (e.g. /mcp/app).
// Port: SB_MCP_PORT (0 = random, tests), default 4319; if it is taken the app falls back to a random port and logs
// why. Hand-offs: the user's answer wakes a chat whose agent stopped waiting (setWake), and Copia puts a login
// hand-off's user name or password on the clipboard (the password read from the credentials file at the click, cleared
// after 30 s if still there: logins.ts, ADR 0012); the "Credenziali" panel copies the same way (credentials:copy).
// Used by wiring.ts.
import { app, clipboard, nativeImage, safeStorage } from 'electron';
import type { BrowserWindow } from 'electron';
import type { BrowserService } from '../services';
import type { Emitter } from '../ipc';
import { log, errText } from '../log';
import { recordMcpPort } from '../health';
import { McpServer, type CallCtx, type McpTool } from '../mcp/server';
import { EndpointTokens } from '../mcp/tokens';
import { BrowserTabs } from './tabs';
import { BrowserActions, normalizeUrl } from './actions';
import path from 'node:path';
import { safeStorageCipher } from '../engines/secrets';
import { SiteVault } from './site-vault';
import type { RoutineBrowserAccess } from './routine-policy';
import { browserTools, type Scope } from './tools';
import { SHOW_UI_HINT } from '../genui/artifacts';
import { SCREENSHOT_HINT } from '../ask-image';
import { BROWSER_READ_TOOLS, type BrowserAccess } from '../agents/tool-policy';

export { mcpPortFromEnv } from '../mcp/server';

const INSTRUCTIONS = [
  "Internal browser of the user's second-brain app (Electron, persistent profile: logins survive restarts).",
  'You see and drive only your own tabs. Read with read_page (tree with refs: e12 in the page, f1e7 inside iframe f1, cross-origin iframes included), find, get_page_text.',
  'Act with click, type, key, fill_form, select_option, scroll, hover, drag: trusted input, like a real user. Every action returns what changed (URL, dialogs, console errors, failed requests, new tabs, downloads).',
  'To know what is on the page, try read_page, find or get_page_text first: text costs far fewer tokens than an image. Take a screenshot only when you must really see the page (layout, colours, a chart, something the text does not show).',
  'screenshot: the image you get is scaled (long side ~1000 px); its text says the factor: click coordinate = image px × factor. save_to stores a full-size PNG as QA evidence and returns only its path and size, no image (add view: true to see it too).',
  'A JavaScript alert/confirm blocks the page until you call handle_dialog. Popups and target=_blank links open as new tabs of yours.',
  'You open and drive the pages yourself (tabs_create, navigate): never ask the user to open a browser, a URL or a page, and never give them sign-in steps.',
  'Each tab lives in an environment (its own cookies and storage; default from the host, e.g. example-test-3, local); environments shows them with their sign-in status. Local stacks (localhost, 127.0.0.1, *.localhost) always load in environment "local" (the tools refuse another).',
  'HARD LIMIT: you never type a password on a remote host (the tools refuse it). On a sign-in page call handoff_to_user with kind "login": the user signs in once and the environment keeps the session. On local stacks (localhost, 127.0.0.1, *.localhost, *.test) you may sign in with the project\'s test accounts.',
  'For MFA, CAPTCHA or anything only the user can do, call handoff_to_user and wait: never ask them for passwords.',
].join('\n');

/** addChatTools: more tools on every chat's own endpoint (/mcp/chat/:chatId/:token), e.g. send_to_chat (wiring.ts).
 *  setBrowserAccess: which of the browser tools each chat sees there (all, the reading ones for 'browser-read', or none).
 *  setChatToolFilter: which of the added tools a chat sees (ChatManager.chatToolShown). */
export interface BrowserModule { setApprovedBrowserOrigins(origins: () => string[]): void; setRoutineBrowserAccess(access: RoutineBrowserAccess): void; service: BrowserService; mcp: McpServer; addChatTools: (tools: McpTool[]) => void; setBrowserAccess: (access: (chatId: string) => BrowserAccess) => void; setChatToolFilter: (shown: (chatId: string, tool: string) => boolean) => void }

/** The clipboard of Copia: the system one, or (SB_TEST=1) an in-memory one the e2e suite reads through
 *  globalThis.__sbClipboard, so a test never overwrites what the user copied. */
interface Clip { writeText(t: string): void; readText(): string | Promise<string>; clear(): void }
function clipFor(env: NodeJS.ProcessEnv = process.env): Clip {
  if (env.SB_TEST !== '1') return clipboard;
  let text = '';
  const mem: Clip = { writeText: t => { text = t; }, readText: () => text, clear: () => { text = ''; } };
  (globalThis as Record<string, unknown>).__sbClipboard = mem;
  return mem;
}

/** After the user answers, how long a still-running or returning tool call has to take the outcome before the chat is messaged. */
export const WAKE_DELAY_MS = 4000;
/** After a "still waiting" answer, how long the agent has to call again before the chat gets a message instead. */
export const RECALL_GRACE_MS = 60_000;
/** The grace in use: SB_RECALL_GRACE_MS overrides it only under SB_TEST, so the e2e suite need not wait a minute. */
function recallGrace(env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(env.SB_RECALL_GRACE_MS);
  return env.SB_TEST === '1' && Number.isFinite(ms) && ms >= 0 ? ms : RECALL_GRACE_MS;
}
/** How long a copied password stays on the clipboard (and agents may not paste). */
export const CLIPBOARD_CLEAR_MS = 30_000;

export async function createBrowserModule(o: { emitter: Emitter; window: () => BrowserWindow | null; userData: string; port: number; brainRoot?: () => string | null }): Promise<BrowserModule> {
  const tabs = new BrowserTabs({ emitter: o.emitter, window: o.window, userData: o.userData });
  if (o.brainRoot) tabs.credentials.setRoot(o.brainRoot);
  let approvedOrigins: () => string[] = () => [];
  const siteVault = new SiteVault(path.join(o.userData, 'routine-site-credentials.json'), safeStorageCipher(safeStorage), () => approvedOrigins());
  const actions = new BrowserActions(tabs, png => nativeImage.createFromBuffer(png));
  const tokens = new EndpointTokens();
  const mcp = new McpServer({ name: 'second-brain-browser', version: app.getVersion() });

  const generic = (ctx: CallCtx): Scope => ({ group: `mcp:${ctx.sessionId || 'default'}`, owner: null, chatId: null });
  const perChat = (ctx: CallCtx): Scope => ({ group: `chat:${ctx.params.chatId}`, owner: ctx.params.chatId ?? null, chatId: ctx.params.chatId ?? null });
  mcp.mount('/mcp', {
    name: 'browser', instructions: INSTRUCTIONS, tools: browserTools(tabs, actions, generic), who: (_p, sid) => (sid ? `mcp:${sid.slice(0, 8)}` : 'mcp'),
    // an external client (Claude desktop, Cursor) ended its MCP session: its tabs would be unreachable, close them
    onSessionEnd: (_p, sid) => { const n = tabs.closeGroup(`mcp:${sid}`); log.info('browser', 'external session ended', { data: { session: sid.slice(0, 8), closedTabs: n } }); },
  });
  const chatBrowserTools = browserTools(tabs, actions, perChat, siteVault);
  const chatTools: McpTool[] = [];
  let browserAccess: (chatId: string) => BrowserAccess = () => 'all';
  const readTools = chatBrowserTools.filter(t => BROWSER_READ_TOOLS.includes(t.name));
  // what a chat is never allowed to call (the Orchestrator's agent_delegate, a root chat's agent_ask_parent…) is left
  // out of its list: the schema and description cost tokens in every turn and the call would only be refused
  let chatToolShown: (chatId: string, tool: string) => boolean = () => true;
  const CHAT_HINTS = `send_to_chat / list_chats: write to the user's other chats (delivered at once when open in the app); never an ok or a permission of the user.
${SHOW_UI_HINT}
${SCREENSHOT_HINT}`;
  mcp.mount('/mcp/chat/:chatId/:token', {
    // the browser's instructions only for a chat that has browser tools
    name: 'browser-chat', instructions: params => browserAccess(params.chatId ?? '') === 'none' ? CHAT_HINTS : `${INSTRUCTIONS}\n${CHAT_HINTS}`,
    tools: ({ params }) => {
      const id = params.chatId ?? '', access = browserAccess(id);
      return [...(access === 'all' ? chatBrowserTools : access === 'read' ? readTools : []), ...chatTools.filter(t => chatToolShown(id, t.name))];
    },
    authorize: p => !!p.chatId && !!p.token && tokens.check(p.chatId, p.token),
    who: p => p.chatId,
  });

  try {
    recordMcpPort(o.port, await mcp.listen(o.port));
  } catch (e) {
    if (o.port === 0) throw e;
    log.error('mcp', `port ${o.port} unavailable, using a random port`, {
      cause: errText(e),
      hint: `another second-brain (or the prototype) may hold ${o.port}: close it, or set SB_MCP_PORT. App chats still work; external clients configured on ${o.port} will not connect this run`,
    });
    // the user sees it too (AppInfo.health → HealthBanner), not only the log
    recordMcpPort(o.port, await mcp.listen(0), errText(e));
  }

  let wake: (chatId: string, text: string) => void = () => {};
  let clearTimer: NodeJS.Timeout | null = null;
  let copied: string | null = null;            // the password on the clipboard, until it is cleared
  const clip = clipFor();
  const clearCopied = async () => {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    const pw = copied;
    copied = null;
    tabs.credentials.cleared();
    if (pw !== null && (await Promise.resolve(clip.readText())) === pw) clip.clear();
  };
  /** A password to the clipboard: cleared after CLIPBOARD_CLEAR_MS if still there; agents may not paste meanwhile. */
  const copyPassword = (pw: string) => {
    clip.writeText(pw);
    copied = pw;
    tabs.credentials.markCopied(CLIPBOARD_CLEAR_MS);
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { void clearCopied(); }, CLIPBOARD_CLEAR_MS);
    clearTimer.unref?.();
  };
  /** The agent ended its turn instead of waiting: tell its chat, a few seconds later (a call may be on its way). */
  const wakeIfNobodyWaits = (id: string) => {
    // an agent that just got "still waiting" is probably calling again after its turn: give it that time first
    const poll = tabs.handoffs.lastPoll(id);
    const delay = Math.max(WAKE_DELAY_MS, poll !== undefined ? poll + recallGrace() - Date.now() : 0);
    const t = setTimeout(() => {
      const h = tabs.handoffs.get(id);
      if (!h || !h.chatId || tabs.handoffs.wasDelivered(id)) return;
      const where = h.env ? ` (ambiente ${h.env}, scheda ${h.tabId})` : ` (scheda ${h.tabId})`;
      const text = h.state === 'done'
        ? (h.kind === 'login' ? `Ho fatto l'accesso nel browser${where}: riprendi da dove eri.` : `Ho fatto quello che chiedevi nel browser${where}: riprendi da dove eri.`)
        : `Nel browser non ci sono riuscito${where}${h.note ? `: ${h.note}` : ''}.`;
      tabs.handoffs.delivered(id);
      log.info('browser', 'hand-off answered after the agent stopped waiting: chat woken', { chat: h.chatId, data: { id, state: h.state } });
      wake(h.chatId, text);
    }, delay);
    t.unref?.();
  };

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
    close: tabId => tabs.close(tabId, 'user'),       // the app's ✕ / Ctrl+W: the tab's agent is told at its next call
    lend: (chatId, view, back) => tabs.toBrowserTab(tabs.lend(chatId, view, () => back())),
    layout: views => tabs.layout(views),
    mcpUrlFor: chatId => (chatId ? mcp.url(`/mcp/chat/${encodeURIComponent(chatId)}/${tokens.tokenFor(chatId)}`) : mcp.url('/mcp')),
    handoffs: () => tabs.handoffs.list(),
    resolveHandoff: (id, outcome, note) => {
      const h = tabs.handoffs.resolve(id, outcome, note);
      log.info('browser', 'hand-off answered by the user', { chat: h.chatId ?? undefined, data: { id, outcome } });
      wakeIfNobodyWaits(id);
    },
    copyFromHandoff: (id, field) => {
      const h = tabs.handoffs.get(id);
      if (!h || h.state !== 'open' || !h.account) return false;
      if (field === 'user') { clip.writeText(h.account.user); return true; }
      const pw = h.account.found ? tabs.credentials.password(h.account.user, h.url) : null;
      if (!pw) return false;
      copyPassword(pw);
      log.info('browser', 'password copied for a login hand-off', { chat: h.chatId ?? undefined, data: { id } });   // never the value
      return true;
    },
    capturePrivacyVersion: () => tabs.capturePrivacyVersion(),
    hasPrivateTabs: () => tabs.hasPrivateTabs(),
    siteCredentials: () => siteVault.list(),
    saveSiteCredential: input => siteVault.save(input),
    removeSiteCredential: id => siteVault.remove(id),
    credentials: () => tabs.credentials.list(),
    copyCredential: (id, field) => {
      const e = tabs.credentials.byId(id);
      if (!e) return false;
      if (field === 'user') { clip.writeText(e.user); return true; }
      copyPassword(e.password);
      log.info('browser', 'password copied from the Credenziali panel', { data: { id } });   // never the value
      return true;
    },
    setWake: fn => { wake = fn; },
    envs: () => tabs.envList(),
    forgetChat: chatId => {
      const n = tabs.closeGroup(`chat:${chatId}`);
      tokens.revoke(chatId);
      log.info('browser', 'chat forgotten: tabs closed, MCP token revoked', { chat: chatId, data: { closedTabs: n } });
    },
    setFeed: fn => tabs.setFeed(fn),
    shutdown: async () => {
      await clearCopied().catch(() => {});      // never leave the password on the clipboard when the app closes
      await tabs.shutdown();
      await mcp.close();
    },
  };
  return { setApprovedBrowserOrigins: origins => { approvedOrigins = origins; }, setRoutineBrowserAccess: access => tabs.setRoutineAccess(access), service, mcp, addChatTools: tools => { chatTools.push(...tools); }, setBrowserAccess: access => { browserAccess = access; }, setChatToolFilter: shown => { chatToolShown = shown; } };
}
