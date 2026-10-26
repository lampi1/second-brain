// Internal browser tabs. Each tab is a WebContentsView owned by a tab group ('user' = the user's own, 'chat:<id>' = an
// app chat, 'mcp:<session>' = an external MCP client) and living in one ENVIRONMENT: its own persistent, sandboxed
// session partition persist:env-<id> (envs.ts), so cookies and storage are never shared between environments; the
// default environment comes from the host, sharing one is explicit. A tab that has not loaded a real page yet is
// re-created in the right environment on its first navigation (a partition cannot change later).
// Visible tabs are placed in the app window at the rects the renderer reports (views:layout, the complete visible set);
// agent tabs always lay out at a fixed desktop size (DESKTOP, CDP device emulation) and are shown scaled to fit their
// rect, so a small tile never narrows the page an agent tests nor its screenshots (Tab.scale = view px per CSS px);
// every other tab is "parked" in an invisible offscreen window so it keeps rendering at its last size: screenshots,
// rAF, hit-testing into cross-origin iframes all need a live compositor (a detached view has none). Agent tabs get a
// CDP session (cdp.ts) for trusted input, dialogs and network; Electron's own native dialog box is suppressed on them
// (the agent answers with handle_dialog). window.open / target=_blank become tabs of the same group and environment
// (opener kept, so OAuth popups work); downloads of agent tabs go to <userData>/evidence/<group>/downloads. Session
// status per environment (valid / expiring / expired) is tracked from auth cookies and login pages. Every change is
// pushed as `browser:tabs` / `browser:envs` events. Used by browser/actions.ts, browser/tools.ts, browser/service.ts.
import { timersFor } from '../timers';
const { setInterval, clearInterval } = timersFor('browser/tabs');
import { BrowserWindow, WebContentsView, app, screen, session as electronSession, type WebContents, type WebFrameMain, type Session } from 'electron';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { assertBrowserOrigin, type RoutineBrowserAccess, type RoutineBrowserPolicy } from './routine-policy';
import path from 'node:path';
import type { BrowserEnv, BrowserHandoff, BrowserSessionStatus, BrowserTab, Rect, ViewLayout } from '../../shared/contract';
import type { Emitter } from '../ipc';
import type { FeedInput } from '../services';
import { log, errText, redact } from '../log';
import { TabCdp } from './cdp';
import { onceDialogCallback, settleDialog } from './dialogs';
import { NetLog } from './netlog';
import { Handoffs } from './handoffs';
import { Credentials } from './logins';
import { groupFolder } from './evidence';
import { UserClosed } from './closed';
import { EnvStore, computeSession, envColor, envForUrl, envPartition, envSlug, isAuthCookie, isLoginUrl } from './envs';
import { cookieEncryptionEnabled } from './fuses';
import { hasPasswordField, pageCall } from './page';
import { isCloseKey, swallowCloseKey } from '../keyguard';
import { DESKTOP, fitDesktop } from './desktop';

const DEFAULT_SIZE = { width: 1280, height: 800 };
const PARK_SIZE = { width: 1920, height: 1200 };
const MAX_TABS_PER_GROUP = 20;

// Parked tabs live in a shown-but-offscreen window; Windows' native occlusion tracking would mark it hidden (no
// frames, no capture), so it is turned off for the app. Must run before app 'ready': this module is imported at startup.
if (!app.isReady()) {
  const prev = app.commandLine.getSwitchValue('disable-features');
  app.commandLine.appendSwitch('disable-features', [prev, 'CalculateNativeWinOcclusion'].filter(Boolean).join(','));
}

export interface ConsoleEntry { seq: number; at: number; level: string; text: string; source: string; frame: string }
export interface OpenDialog { type: string; message: string; defaultPrompt: string; url: string; at: number }
export interface DownloadEntry { path: string; url: string; state: string; at: number }

export interface Tab {
  id: string;
  group: string;
  owner: string | null;                       // chat id for chat groups
  agent: boolean;                             // driven by an agent (has CDP, no native dialogs)
  env: string;                                // environment = session partition persist:env-<env>
  envExplicit: boolean;                       // named by the caller (never re-derived from the host)
  fresh: boolean;                             // no real page loaded yet (can still move to another environment)
  pointer?: boolean;                          // the user's mouse is over the page (renderer lights up its pair)
  view: WebContentsView;
  wcId: number;
  wc: WebContents;
  cdp: TabCdp | null;
  host: 'main' | 'park' | null;
  size: { width: number; height: number };
  scale: number;                              // view px per CSS px: < 1 while an agent tab is shown in a smaller tile
  emu: number | null;                         // the scale the CDP device emulation was last set to (null = not set)
  committed: boolean;                         // a navigation committed (emulating before that crashes Electron)
  frameNos: Map<number, number>;              // frameTreeNodeId → frame number (f1, f2...)
  frameSeq: number;
  refStart: Map<number, number>;              // frame number → highest ref number handed out (refs stay unique across reloads)
  console: ConsoleEntry[];
  consoleSeq: number;
  net: NetLog;
  dialog: OpenDialog | null;
  dialogSeq: number;
  lastDialog: (OpenDialog & { result: string }) | null;
  dialogWaiters: Set<() => void>;
  pendingDialogCb: ((ok: boolean, text: string) => void) | null;
  lastAction?: string;
  forceUnload: boolean;
  unloadBlockedAt: number;
  downloads: DownloadEntry[];
  openedBy: string | null;
  createdAt: number;
  closedByUser?: { url: string };             // the user closed it in the app (✕ / Ctrl+W on its tile): its agent is told so
  /** a tab of the user's personal browser lent to this chat (ADR 0133): closing it gives it back, never destroys it */
  lentBack?: (view: WebContentsView) => void;
  agentInput?: number;                        // CDP input of an agent running on it (actions.ts): its keys are not the user's
}

interface Group { key: string; owner: string | null; active: string | null }
interface EnvRuntime { loginPage: boolean; hadAuth: boolean; status: { status: BrowserSessionStatus; detail: string; authExpiresAt: number | null } }

export interface TabsOptions { emitter: Emitter; window: () => BrowserWindow | null; userData: string }

export class BrowserTabs {
  readonly tabs = new Map<string, Tab>();
  private readonly groups = new Map<string, Group>();
  private readonly userClosed = new UserClosed();
  private readonly byWc = new Map<number, Tab>();
  private readonly sessions = new Map<string, Session>();
  private readonly envRt = new Map<string, EnvRuntime>();
  private readonly reserved = new Set<string>();       // download paths in use (two downloads never share a file)
  private visible = new Map<string, Rect>();
  private park: BrowserWindow | null = null;
  private hooked: BrowserWindow | null = null;
  private seq = 0;
  private emitTimer: NodeJS.Timeout | null = null;
  private envTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private warnedDialogs = false;
  private closing = false;
  private feed: (e: FeedInput) => void = () => {};
  encryptedAtRest: boolean | null = null;
  readonly envStore: EnvStore;
  readonly handoffs: Handoffs;
  /** The user's credentials file (login hand-offs): set to the brain folder by service.ts. */
  readonly credentials = new Credentials();

  constructor(private readonly opts: TabsOptions) {
    this.envStore = new EnvStore(path.join(opts.userData, 'browser-envs.json'));
    this.handoffs = new Handoffs(h => this.onHandoff(h));
    void cookieEncryptionEnabled(process.execPath).then(on => {
      this.encryptedAtRest = on;
      if (on === false) log.warn('browser', 'cookies are not encrypted at rest', { cause: 'the Electron binary has its EnableCookieEncryption fuse off (the default)', hint: 'node scripts/fuses.mjs --enable-cookie-encryption <electron.exe> with the app closed (release.mjs does it for the stable copy); ADR 0003' });
      this.emitEnvs();
    });
    this.tick = setInterval(() => { for (const env of this.envRt.keys()) void this.refreshEnv(env); }, 10 * 60 * 1000);
    this.tick.unref?.();
  }

  private captureVersion = 0;
  capturePrivacyVersion(): number { return this.captureVersion; }
  hasPrivateTabs(): boolean { return [...this.tabs.values()].some(t => this.isShown(t) && (!!this.loginSecrets.get(t) || !!this.routinePolicy(t.owner) && this.handoffs.list().some(h => h.tabId === t.id && h.state === 'open'))); }
  private readonly loginSecrets = new WeakMap<Tab, { secret: string; origin: string; frame: string }>();
  private routineAccess: RoutineBrowserAccess = () => null;
  /** A pre-existing same-origin opener can inspect a filled form; host login requires one standalone tab. */
  hostLoginAllowed(tab: Tab): boolean { return !tab.openedBy && this.tabsOf(tab.group).length === 1; }
  private privateGroup(group: string): boolean { return this.tabsOf(group).some(t => this.loginSecrets.has(t) || this.handoffs.list().some(h => h.tabId === t.id && h.state === 'open' && h.kind === 'login')); }
  protectLogin(tab: Tab, secret: string, origin: string): void {
    if (!this.hostLoginAllowed(tab)) throw new Error('Routine host login requires one standalone tab; close other tabs or use login handoff');
    this.captureVersion++;
    this.loginSecrets.set(tab, { secret, origin, frame: tab.wc.mainFrame.url });
    tab.net.clear(); tab.console = [];
  }
  /** No reads/screenshots while a host-filled secret remains in the login document. */
  async assertLoginReadable(tab: Tab): Promise<void> {
    const saved = this.loginSecrets.get(tab); if (!saved) return;
    const safe = await tab.wc.executeJavaScriptInIsolatedWorld(1014, [{ code: `(() => {
      const secret = ${JSON.stringify(saved.secret)};
      if (globalThis.__sbRoutineLoginPrivate === true) return false;
      return !document.body?.innerText.includes(secret) && ![...document.querySelectorAll('input,textarea')].some(e => e.value.includes(secret));
    })()` }]).catch(() => false);
    if (!safe) throw new Error('Routine browser: login document is protected; finish login with handoff_to_user kind login. No screenshot or page evidence is available yet.');
    // A safe new document must not be able to revive the credential-bearing form through Back/BFCache.
    tab.wc.navigationHistory.clear();
    this.loginSecrets.delete(tab); this.captureVersion++;
  }
  setRoutineAccess(access: RoutineBrowserAccess): void { this.routineAccess = access; }
  routinePolicy(owner: string | null): RoutineBrowserPolicy | null { return owner ? this.routineAccess(owner) : null; }
  assertRoutine(tab: Tab, frames = false): RoutineBrowserPolicy | null {
    const policy = this.routinePolicy(tab.owner);
    if (!policy) return null;
    assertBrowserOrigin(policy, tab.wc.getURL());
    if (this.handoffs.list().some(h => this.tabs.get(h.tabId)?.group === tab.group && h.state === 'open')) throw new Error('Routine browser: user handoff active; wait for handoff_to_user');
    if (frames) for (const frame of tab.wc.mainFrame.framesInSubtree) {
      if (frame.url === 'about:blank' && frame.parent && policy.targets.includes(new URL(frame.parent.url).origin)) continue;
      assertBrowserOrigin(policy, frame.url);
    }
    return policy;
  }

  setFeed(fn: (e: FeedInput) => void): void { this.feed = fn; }

  evidenceDir(group: string): string { return path.join(this.opts.userData, 'evidence', groupFolder(group)); }

  // ---------- environments ----------

  /** The session of an environment (created on first use, with the same hardening as every tab partition). */
  sessionFor(env: string): Session {
    let ses = this.sessions.get(env);
    if (ses) return ses;
    ses = electronSession.fromPartition(envPartition(env));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (_e, item, wc) => this.onDownload(item, wc));
    ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
      if (!isAuthCookie(cookie.name)) return;
      const rt = this.rt(env);
      if (!removed && (!rt.hadAuth || rt.loginPage)) { this.envStore.markLogin(env); log.info('browser', 'sign-in seen', { data: { env, cookie: cookie.name } }); }
      if (!removed) rt.hadAuth = true;
      void this.refreshEnv(env);
    });
    this.sessions.set(env, ses);
    this.envStore.ensure(env);
    void this.refreshEnv(env);                         // knows at once whether a sign-in is already stored
    return ses;
  }

  private rt(env: string): EnvRuntime {
    let r = this.envRt.get(env);
    if (!r) { r = { loginPage: false, hadAuth: false, status: { status: 'unknown', detail: 'nessun accesso rilevato in questo ambiente', authExpiresAt: null } }; this.envRt.set(env, r); }
    return r;
  }

  sessionStatus(env: string): BrowserSessionStatus { return this.rt(env).status.status; }
  loginPage(env: string): boolean { return this.rt(env).loginPage; }

  /** Recomputes an environment's session status from its auth cookies (async) and pushes changes. */
  async refreshEnv(env: string): Promise<void> {
    const ses = this.sessions.get(env);
    if (!ses) return;
    const rt = this.rt(env);
    let auth: Array<{ expires: number | null }> = [];
    try {
      auth = (await ses.cookies.get({})).filter(c => isAuthCookie(c.name)).map(c => ({ expires: typeof c.expirationDate === 'number' ? Math.round(c.expirationDate * 1000) : null }));
    } catch { /* session gone */ }
    if (auth.length) rt.hadAuth = true;
    const next = computeSession({ authCookies: auth, seenAuth: rt.hadAuth, loginPage: rt.loginPage, now: Date.now() });
    const changed = next.status !== rt.status.status || next.detail !== rt.status.detail;
    rt.status = next;
    if (changed) { this.emitTabs(); this.emitEnvs(); }
  }

  /** After a page of the environment loaded: remember it, and see whether it is a sign-in page. */
  private async onPageLoaded(tab: Tab): Promise<void> {
    if (tab.wc.isDestroyed()) return;
    const url = tab.wc.getURL();
    if (!/^https?:/i.test(url)) return;
    this.envStore.touch(tab.env, url);
    let login = isLoginUrl(url);
    if (!login && !tab.dialog) {
      login = await Promise.race([
        tab.wc.mainFrame.executeJavaScript(pageCall(hasPasswordField, true)) as Promise<boolean>,   // also remembers the fields
        new Promise<boolean>(r => setTimeout(() => r(false), 1500)),
      ]).catch(() => false);
    }
    const rt = this.rt(tab.env);
    if (rt.loginPage && !login) { this.envStore.markLogin(tab.env); log.info('browser', 'sign-in page left', { data: { env: tab.env } }); }
    rt.loginPage = login;
    await this.refreshEnv(tab.env);
    this.emitEnvs();
  }

  async envList(): Promise<BrowserEnv[]> {
    const ids = new Set([...this.envStore.list().map(e => e.id), ...[...this.tabs.values()].map(t => t.env)]);
    await Promise.all([...ids].map(id => this.refreshEnv(id)));
    return [...ids].map(id => {
      const rec = this.envStore.ensure(id);
      const st = this.rt(id).status;
      return {
        id, color: envColor(id), hosts: rec.hosts, tabIds: [...this.tabs.values()].filter(t => t.env === id).map(t => t.id),
        createdAt: rec.createdAt, lastUsedAt: rec.lastUsedAt, lastLoginAt: rec.lastLoginAt, ...(rec.lastUrl ? { lastUrl: rec.lastUrl } : {}),
        session: st.status, sessionDetail: st.detail, authExpiresAt: st.authExpiresAt, encryptedAtRest: this.encryptedAtRest,
      };
    }).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  private emitEnvs(): void {
    if (this.envTimer || this.closing) return;
    this.envTimer = setTimeout(() => { this.envTimer = null; void this.envList().then(l => this.opts.emitter.emit('browser:envs', l)).catch(() => {}); }, 100);
  }

  private onHandoff(h: BrowserHandoff): void {
    this.captureVersion++;
    this.opts.emitter.emit('browser:handoff', h);
    if (h.kind === 'login' && h.env) {
      if (h.state === 'open') this.feed({ kind: 'login', title: `Rifai l'accesso a ${h.env}`, detail: `${h.reason} · ${h.url}`.slice(0, 300), ...(h.chatId ? { chatId: h.chatId } : {}) });
      if (h.state === 'done') {
        this.envStore.markLogin(h.env);
        const t = this.tabs.get(h.tabId);
        if (t) void this.onPageLoaded(t);
      }
    }
    this.emitTabs();
  }

  // ---------- groups ----------

  group(key: string, owner: string | null): Group {
    let g = this.groups.get(key);
    if (!g) { g = { key, owner, active: null }; this.groups.set(key, g); }
    return g;
  }

  tabsOf(group: string): Tab[] { return [...this.tabs.values()].filter(t => t.group === group); }
  activeOf(group: string): Tab | null { const id = this.groups.get(group)?.active; return (id && this.tabs.get(id)) || null; }

  /** The tab an agent addresses: its tabId (must be in its group) or the group's active tab. */
  tabFor(group: string, tabId?: unknown): Tab {
    if (tabId !== undefined && tabId !== null && tabId !== '') {
      const t = this.tabs.get(String(tabId));
      if (!t || t.group !== group) throw new Error(this.closedError(group, String(tabId)) ?? `No tab "${String(tabId)}" among your tabs: call tabs_list (you only see the tabs you opened).`);
      return t;
    }
    const t = this.activeOf(group);
    if (!t) throw new Error(this.closedError(group, null) ?? 'You have no open tab: call navigate with a url (it opens one) or tabs_create.');
    return t;
  }

  select(group: string, tabId: string): Tab {
    const t = this.tabFor(group, tabId);
    this.group(group, t.owner).active = t.id;
    this.userClosed.picked(group);
    this.emitTabs();
    return t;
  }

  /** The error for an agent call on a tab the user closed (tabId, or null = its active one); null = not such a tab. */
  closedError(group: string, tabId: string | null): string | null {
    return this.userClosed.errorFor(group, tabId, this.tabsOf(group).map(t => t.id));
  }

  closeGroup(group: string): number {
    const mine = this.tabsOf(group);
    for (const t of mine) this.close(t.id);
    this.groups.delete(group);
    this.userClosed.forget(group);
    return mine.length;
  }

  // ---------- tabs ----------

  create(group: string, owner: string | null, url?: string, opts: { webContents?: WebContents; view?: WebContentsView; openedBy?: string; env?: string; id?: string } = {}): Tab {
    if (this.tabsOf(group).length >= MAX_TABS_PER_GROUP) throw new Error(`Too many tabs (${MAX_TABS_PER_GROUP}) in this group: close some with tabs_close.`);
    const envExplicit = opts.env !== undefined && opts.env !== '';
    const policy = this.routinePolicy(owner);
    if (policy?.reason) throw new Error(policy.reason);
    if (policy && this.privateGroup(group)) throw new Error('Routine browser: login in progress; new tabs are unavailable until the protected document is gone');
    if (policy && opts.view) throw new Error('Routine browser: personal tabs cannot be lent to scoped routine steps');
    if (policy && url && url !== 'about:blank') assertBrowserOrigin(policy, url);
    const env = policy ? `routine-${createHash('sha256').update(owner!).digest('hex').slice(0, 32)}` : envExplicit ? envSlug(opts.env) : envForUrl(url);
    if (!policy && env.startsWith('routine-')) throw new Error('Routine browser sessions cannot be opened by another chat');
    if (policy && !this.sessions.has(env)) {
      const ses = this.sessionFor(env);
      ses.webRequest.onBeforeRequest((details, callback) => {
        const target = this.byWc.get(details.webContentsId ?? -1);
        try {
          const current = this.routinePolicy(owner);
          if (!current || !target || target.owner !== owner) throw new Error('Unowned routine request');
          assertBrowserOrigin(current, details.url);
          const login = this.loginSecrets.get(target);
          if (login && new URL(details.url).origin !== login.origin) throw new Error('Host login cannot send credentials to another origin');
          callback({ cancel: false });
        } catch { callback({ cancel: true }); }
      });
    }
    const id = opts.id ?? `t${++this.seq}`;
    if (!opts.view) this.sessionFor(env);             // a lent personal view keeps its own session (ADR 0133)
    const view = opts.view ?? (opts.webContents
      ? new WebContentsView({ webContents: opts.webContents })
      : new WebContentsView({
        webPreferences: { partition: envPartition(env), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
      }));
    const wc = view.webContents;
    const agent = group !== 'user';
    if (agent && !opts.view) this.envStore.markAgent(env);
    const tab: Tab = {
      id, group, owner, agent, env, envExplicit, fresh: !opts.webContents && !opts.view && (!url || url === 'about:blank'),
      view, wc, wcId: wc.id, cdp: null, host: null, size: { ...(agent ? DESKTOP : DEFAULT_SIZE) }, scale: 1, emu: null, committed: false, frameNos: new Map(), frameSeq: 0, refStart: new Map(),
      console: [], consoleSeq: 0, net: new NetLog(), dialog: null, dialogSeq: 0, lastDialog: null, dialogWaiters: new Set(), pendingDialogCb: null,
      forceUnload: false, unloadBlockedAt: 0, downloads: [], openedBy: opts.openedBy ?? null, createdAt: Date.now(),
    };
    this.tabs.set(id, tab);
    this.byWc.set(wc.id, tab);
    // a new tab the agent opened is its pick; a rebind keeps the id; a popup never takes the place of the active tab the
    // user closed (the agent's next call without tabId still hears about it)
    if (!opts.webContents || !this.userClosed.closedActive(group)) this.group(group, owner).active = id;
    if (!opts.id && !opts.webContents) this.userClosed.picked(group);
    view.setBackgroundColor('#ffffff');
    this.wire(tab);
    if (agent) {
      tab.cdp = new TabCdp(wc, (m, p, s) => this.onCdp(tab, m, p, s), id, () => this.onDetached(tab));
      void tab.cdp.attach().then(() => this.emulate(tab));
    }
    this.place(tab);
    if (url && !opts.webContents && !opts.view) wc.loadURL(url).catch(e => { if (!/ERR_ABORTED/.test(errText(e))) log.info('browser', 'initial load failed', { data: { tab: id, url: redact(url), cause: errText(e) } }); });
    log.info('browser', 'tab opened', { chat: owner ?? undefined, data: { tab: id, group, env, popup: !!opts.webContents } });
    this.emitTabs();
    this.emitEnvs();
    return tab;
  }

  /** A tab of the user's personal browser, lent to a chat on the user's click (personal/browser.ts, ADR 0133): its
   *  view joins the chat's group as an agent tab (CDP, its tools) in the environment "personal"; closing it (the agent,
   *  the user's ✕ or «Riprendi», the chat gone) gives the view back through `back` instead of destroying the page. */
  lend(chatId: string, view: WebContentsView, back: (view: WebContentsView) => void): Tab {
    const t = this.create(`chat:${chatId}`, chatId, undefined, { view, env: 'personal' });
    t.committed = true;                                // the page is already there: emulation may start now
    t.lentBack = back;
    this.emulate(t);
    log.info('browser', 'personal tab lent to a chat', { chat: chatId, data: { tab: t.id } });
    return t;
  }

  /** A tab that has not loaded a real page yet moves to another environment (same id, same place on screen). */
  rebind(old: Tab, env: string): Tab {
    if (old.env === env || !old.fresh) return old;
    const wasActive = this.groups.get(old.group)?.active === old.id;
    const prevActive = this.groups.get(old.group)?.active ?? null;
    this.tabs.delete(old.id);
    this.byWc.delete(old.wcId);
    this.dropDialog(old, 'dismissed (tab replaced)');   // before dispose and close: never a page left blocked
    old.cdp?.dispose();
    this.unplace(old);
    for (const w of old.dialogWaiters) w();
    if (!old.wc.isDestroyed()) old.wc.close({ waitForBeforeUnload: false });
    const t = this.create(old.group, old.owner, undefined, { env, id: old.id, ...(old.openedBy ? { openedBy: old.openedBy } : {}) });
    t.envExplicit = false;                             // callers that asked for this env mark it explicit
    t.size = old.size;
    if (old.lastAction) t.lastAction = old.lastAction;
    if (!wasActive) this.group(old.group, old.owner).active = prevActive;
    this.place(t);
    return t;
  }

  /** Before loading url in a tab: the right environment. A fresh tab is re-created there; an explicit env on a used tab
   *  opens a new tab in it; a used tab whose host would default elsewhere stays and the agent is told. */
  prepareFor(tab: Tab, url: string, envArg?: unknown): { tab: Tab; note: string } {
    const policy = this.routinePolicy(tab.owner);
    if (policy) { assertBrowserOrigin(policy, url); return { tab, note: '' }; }
    const want = envArg !== undefined && envArg !== null && envArg !== '' ? envSlug(envArg) : null;
    if (want) {
      if (want === tab.env) return { tab, note: '' };
      if (tab.fresh) { const t = this.rebind(tab, want); t.envExplicit = true; return { tab: t, note: '' }; }
      const t = this.create(tab.group, tab.owner, undefined, { env: want });
      return { tab: t, note: `Opened tab ${t.id} in environment ${want} (tab ${tab.id} stays in ${tab.env}).` };
    }
    const derived = envForUrl(url);
    if (tab.fresh && !tab.envExplicit && derived !== tab.env) return { tab: this.rebind(tab, derived), note: '' };
    if (!tab.fresh && derived !== tab.env && derived !== 'scratch') {
      return { tab, note: `Note: tab ${tab.id} is in environment ${tab.env} (its own session); this host would default to ${derived}. To keep sessions apart, navigate with env "${derived}" (it opens a tab there).` };
    }
    return { tab, note: '' };
  }

  /** Close a tab; by 'user' = from the app (✕ / Ctrl+W on its tile, browser:close): an agent's next call on it, or
   *  without tabId while it was the active one, gets "The user closed tab …" (closed.ts) instead of another tab. */
  close(tabId: string, by?: 'user'): void {
    const t = this.tabs.get(tabId);
    if (!t) return;
    if (by === 'user' && t.agent) t.closedByUser = { url: t.wc.isDestroyed() ? '' : redact(t.wc.getURL()) };   // before wc.close: its 'destroyed' may run remove() first
    this.dropDialog(t, 'dismissed (tab closed)');      // answered while the page is still alive
    if (t.lentBack && !t.wc.isDestroyed()) {           // a lent personal tab goes back to the user, alive
      const back = t.lentBack;
      this.closePopupsOf(t.id);                        // what the agent opened from it is signed in as the user: closed

      this.remove(t);
      back(t.view);
      return;
    }
    if (!t.wc.isDestroyed()) t.wc.close({ waitForBeforeUnload: false });
    this.remove(t);
  }

  /** Closes the tabs opened from a tab (window.open, target=_blank), and theirs. */
  private closePopupsOf(id: string): void {
    for (const x of [...this.tabs.values()]) if (x.openedBy === id && x.id !== id) { this.closePopupsOf(x.id); this.close(x.id); }
  }

  private remove(t: Tab): void {
    if (this.tabs.get(t.id) !== t) return;           // already removed, or replaced by rebind()
    this.setPointer(t, false);
    this.tabs.delete(t.id);
    this.byWc.delete(t.wcId);
    this.visible.delete(t.id);
    this.dropDialog(t, 'dismissed (tab closed)');      // a destroyed page's callback is only dropped, never called
    t.cdp?.dispose();
    this.unplace(t);
    for (const w of t.dialogWaiters) w();
    this.handoffs.cancelTab(t.id);
    const g = this.groups.get(t.group);
    const wasActive = !!g && g.active === t.id;
    if (t.closedByUser) this.userClosed.mark(t.group, t.id, t.closedByUser.url, wasActive);
    if (g && wasActive) {
      const rest = this.tabsOf(t.group);
      // closed by the user: no active tab until the agent picks one (a call without tabId must not land on another page)
      g.active = t.closedByUser ? null : (t.openedBy && this.tabs.has(t.openedBy) ? t.openedBy : rest[rest.length - 1]?.id) ?? null;
    }
    log.info('browser', 'tab closed', { chat: t.owner ?? undefined, data: { tab: t.id, ...(t.closedByUser ? { by: 'user' } : {}) } });
    this.emitTabs();
    this.emitEnvs();
  }

  private onDetached(tab: Tab): void {
    tab.emu = null;                                    // cdp.ts re-attaches by itself: set the desktop size again then
    setTimeout(() => this.emulate(tab), 1000);
    // no Page.javascriptDialogClosed will come once detached, and nobody could answer: Cancel it (once)
    if (this.dropDialog(tab, 'dismissed (automation detached)')) this.emitTabs();
  }

  /** Settles a pending dialog of the tab (issue #102): its native callback answered Cancel once while the page is
   *  alive (dropped otherwise), the dialog cleared. True when there was something to settle. */
  private dropDialog(tab: Tab, result: string): boolean {
    if (!tab.dialog && !tab.pendingDialogCb) return false;
    const r = settleDialog(tab, result, { alive: !tab.wc.isDestroyed() });
    log.info('browser', 'dialog settled', { chat: tab.owner ?? undefined, data: { tab: tab.id, result, answered: r.answered } });
    return true;
  }

  /** Clears a dialog Chromium says is no longer showing (handle_dialog got "No dialog is showing"). */
  forgetDialog(tab: Tab): void {
    if (this.dropDialog(tab, 'closed (no longer showing)')) this.emitTabs();
  }

  /** handle_dialog's fallback when CDP cannot answer (detached, or "Not attached to an active page"): answers the
   *  dialog through the native callback kept by suppressNativeDialogs. False when there is no callback to answer. */
  answerNativeDialog(tab: Tab, accept: boolean, text = ''): boolean {
    if (!tab.pendingDialogCb || tab.wc.isDestroyed()) return false;
    settleDialog(tab, accept ? 'accepted' : 'dismissed', { accept, text });
    log.info('browser', 'dialog answered natively', { chat: tab.owner ?? undefined, data: { tab: tab.id, accept } });
    this.emitTabs();
    return true;
  }

  private wire(tab: Tab): void {
    const wc = tab.wc;
    // a lent personal tab outlives this record (ADR 0133): once given back, none of these listeners acts on it
    const live = () => this.tabs.get(tab.id) === tab;
    const changed = () => { if (live()) this.emitTabs(); };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate-in-page', 'page-title-updated'] as const) wc.on(ev as 'did-stop-loading', changed);
    wc.on('did-navigate', (_e, url) => { if (!live()) return; this.dropDialog(tab, 'dismissed (page navigated)'); if (url && url !== 'about:blank') tab.fresh = false; tab.committed = true; tab.emu = null; this.emulate(tab); this.emitTabs(); });
    wc.on('did-stop-loading', () => { if (live()) void this.onPageLoaded(tab); });
    wc.on('did-navigate-in-page', (_e, _url, isMain) => { if (isMain && live()) void this.onPageLoaded(tab); });
    wc.on('destroyed', () => this.remove(tab));
    // the mouse over the page, which the UI cannot see (a native view on top of it): the UI lights up the tab's chat
    // (renderer lib/pairs.ts). Only the user's real cursor counts, never an agent's input (synthetic, no leave event).
    wc.on('input-event', (_e, ev) => {
      if (!live() || (ev.type !== 'mouseMove' && ev.type !== 'mouseEnter' && ev.type !== 'mouseLeave')) return;
      this.setPointer(tab, ev.type !== 'mouseLeave' && (process.env.SB_TEST === '1' || this.cursorOver(tab)));
    });
    swallowCloseKey(wc); // Ctrl+W in a page would reach the default menu and quit the app (keyguard.ts)
    // ... and the user's Ctrl+W in a page closes its tile, like Ctrl+W on a chat (renderer closeTab, with the undo). Only
    // with the keyboard really in this page (window and page focused): an agent's synthetic keys never close a tab.
    wc.on('before-input-event', (_e, input) => {
      if (live() && isCloseKey(input) && !tab.agentInput && (process.env.SB_TEST === '1' || this.userTyping(tab))) this.opts.emitter.emit('ui:command', { action: 'closeTab', value: tab.id });
    });
    wc.on('console-message', e => {
      if (!live()) return;
      const d = e as unknown as { level: string; message: string; lineNumber: number; sourceId: string; frame?: WebFrameMain | null };
      tab.console.push({ seq: ++tab.consoleSeq, at: Date.now(), level: d.level, text: redact(String(d.message)).slice(0, 2000), source: `${redact(String(d.sourceId ?? ''))}:${d.lineNumber ?? ''}`, frame: safeFrameUrl(d.frame) });
      if (tab.console.length > 500) tab.console.shift();
    });
    wc.on('will-prevent-unload', e => {
      if (!live()) return;
      if (!tab.agent || tab.forceUnload) { e.preventDefault(); return; }
      tab.unloadBlockedAt = Date.now();
    });
    wc.on('render-process-gone', (_e, d) => log.warn('browser', 'tab renderer gone', { data: { tab: tab.id, reason: d.reason }, hint: 'reload the tab (navigate reload)' }));
    wc.setWindowOpenHandler(d => {
      const policy = this.routinePolicy(tab.owner);
      if (policy && this.privateGroup(tab.group)) return { action: 'deny' };
      if (policy) { try { assertBrowserOrigin(policy, d.url); } catch { return { action: 'deny' }; } }
      if (!/^(?:https?:|about:blank)/i.test(d.url)) { log.info('browser', 'popup refused (scheme)', { data: { tab: tab.id, url: redact(d.url.slice(0, 200)) } }); return { action: 'deny' }; }
      if (this.tabsOf(tab.group).length >= MAX_TABS_PER_GROUP) { log.warn('browser', 'popup refused (too many tabs)', { data: { tab: tab.id } }); return { action: 'deny' }; }
      return {
        action: 'allow',
        // a popup shares its opener's session (same environment): Chromium needs that for window.opener
        createWindow: options => this.create(tab.group, tab.owner, undefined, { webContents: (options as { webContents?: WebContents }).webContents, openedBy: tab.id, env: tab.env }).wc,
      };
    });
    if (tab.agent) this.suppressNativeDialogs(tab);
  }

  /** Electron shows a native message box for alert/confirm (lib/browser/api/web-contents.ts '-run-dialog'). On agent
   *  tabs the agent answers through CDP instead, so that listener is replaced: it keeps the dialog open for CDP and
   *  falls back to Electron's box only when CDP is not attached (never a frozen page with nobody to answer). */
  private suppressNativeDialogs(tab: Tab): void {
    const em = tab.wc as unknown as NodeJS.EventEmitter;
    const original = em.listeners('-run-dialog') as Array<(info: unknown, cb: (ok: boolean, text: string) => void) => void>;
    if (!original.length) {
      if (!this.warnedDialogs) log.warn('browser', 'native dialog hook not found', { cause: 'Electron internals changed (-run-dialog)', hint: 'agent tabs will show native alert/confirm boxes; handle_dialog still works through CDP' });
      this.warnedDialogs = true;
      return;
    }
    em.removeAllListeners('-run-dialog');
    em.on('-run-dialog', (info: unknown, cb: (ok: boolean, text: string) => void) => {
      log.debug('browser', 'native dialog intercepted', { data: { tab: tab.id, cdp: !!tab.cdp?.isAttached } });
      if (tab.cdp?.isAttached) {                       // kept for handle_dialog's fallback and for teardown: called at most once
        tab.pendingDialogCb = onceDialogCallback(cb, e => log.debug('browser', 'native dialog callback failed', { data: { tab: tab.id, cause: errText(e) } }));
        return;
      }
      for (const l of original) l.call(tab.wc, info, cb);
    });
  }

  private onCdp(tab: Tab, method: string, params: Record<string, unknown>, sessionId: string): void {
    if (method.startsWith('Network.')) { tab.net.onEvent(method, params, sessionId); return; }
    if (method === 'Page.javascriptDialogOpening') {
      tab.dialog = { type: String(params.type ?? 'alert'), message: redact(String(params.message ?? '')).slice(0, 1000), defaultPrompt: String(params.defaultPrompt ?? ''), url: String(params.url ?? ''), at: Date.now() };
      tab.dialogSeq++;
      for (const w of tab.dialogWaiters) w();
      log.info('browser', 'dialog opened', { chat: tab.owner ?? undefined, data: { tab: tab.id, type: tab.dialog.type } });
      this.emitTabs();
    } else if (method === 'Page.javascriptDialogClosed') {
      if (tab.dialog) tab.lastDialog = { ...tab.dialog, result: params.result ? 'accepted' : 'dismissed' };
      tab.dialog = null;
      tab.pendingDialogCb = null;
      this.emitTabs();
    }
  }

  /** Resolves when a JavaScript dialog opens on the tab (for racing input that a dialog would block). */
  dialogOpened(tab: Tab): { promise: Promise<void>; cancel: () => void } {
    let done: () => void = () => {};
    const promise = new Promise<void>(r => { done = () => { tab.dialogWaiters.delete(done); r(); }; tab.dialogWaiters.add(done); });
    return { promise, cancel: () => tab.dialogWaiters.delete(done) };
  }

  // ---------- frames ----------

  frameNo(tab: Tab, f: WebFrameMain): number {
    if (f === tab.wc.mainFrame || !f.parent) return 0;
    let n = tab.frameNos.get(f.frameTreeNodeId);
    if (n === undefined) { n = ++tab.frameSeq; tab.frameNos.set(f.frameTreeNodeId, n); }
    return n;
  }

  frames(tab: Tab): WebFrameMain[] {
    try { return tab.wc.mainFrame.framesInSubtree.filter(f => !f.detached && /^(?:https?:|about:|data:|blob:|file:)/i.test(f.url || 'about:blank')); } catch { return []; }
  }

  frameByNo(tab: Tab, n: number): WebFrameMain {
    if (n === 0) return tab.wc.mainFrame;
    for (const f of this.frames(tab)) if (this.frameNo(tab, f) === n) return f;
    throw new Error(`Frame f${n} is gone (the iframe navigated or was removed): call read_page again for fresh refs.`);
  }

  /** A frame's index in its parent's window.frames, from the browser's own frame tree (never asked to the frame,
   *  which could lie about it to redirect a click into a sibling iframe). -1 for the top frame or when not found. */
  childIndex(f: WebFrameMain): number {
    const p = f.parent;
    if (!p) return -1;
    try { return p.frames.findIndex(c => c.frameTreeNodeId === f.frameTreeNodeId); } catch { return -1; }
  }

  // ---------- layout ----------

  layout(views: ViewLayout[]): void {
    const next = new Map<string, Rect>();
    for (const v of Array.isArray(views) ? views : []) {
      if (!v || typeof v.tabId !== 'string' || !this.tabs.has(v.tabId) || !v.rect) continue;
      const r = v.rect;
      if (![r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n))) continue;
      const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
      if (rect.width < 20 || rect.height < 20) continue;
      next.set(v.tabId, rect);
    }
    this.visible = next;
    for (const t of this.tabs.values()) this.place(t);
  }

  private setPointer(t: Tab, inside: boolean): void {
    if (!!t.pointer === inside) return;
    t.pointer = inside;
    this.opts.emitter.emit('browser:pointer', { tabId: t.id, inside });
  }

  /** Is the OS cursor over this tab's page in the main window? */
  private userTyping(t: Tab): boolean {
    const win = this.opts.window();
    return t.host === 'main' && !!win && !win.isDestroyed() && win.isFocused() && !t.wc.isDestroyed() && t.wc.isFocused();
  }

  private cursorOver(t: Tab): boolean {
    const win = this.opts.window();
    if (t.host !== 'main' || !win || win.isDestroyed()) return false;
    const c = screen.getCursorScreenPoint();
    const w = win.getContentBounds();
    const v = t.view.getBounds();
    const x = c.x - w.x - v.x;
    const y = c.y - w.y - v.y;
    return x >= 0 && y >= 0 && x < v.width && y < v.height;
  }

  private place(t: Tab): void {
    if (this.closing || t.wc.isDestroyed()) return;
    const win = this.opts.window();
    if (win && !win.isDestroyed() && win !== this.hooked) this.hook(win);
    const showing = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const rect = showing ? this.visible.get(t.id) : undefined;
    try {
      if (rect && win) {
        if (t.host !== 'main') { win.contentView.addChildView(t.view); t.host = 'main'; }
        if (t.agent) {
          const fit = fitDesktop(rect);
          t.view.setBounds(fit.bounds);
          t.scale = fit.scale;
        } else {
          t.view.setBounds(rect);
          t.size = { width: Math.min(rect.width, PARK_SIZE.width), height: Math.min(rect.height, PARK_SIZE.height) };
        }
      } else {
        const park = this.parkWindow();
        if (t.host !== 'park') { park.contentView.addChildView(t.view); t.host = 'park'; }
        this.setPointer(t, false);                     // parked under the cursor: no mouseLeave will come
        t.view.setBounds({ x: 0, y: 0, ...t.size });
        t.scale = 1;
      }
      this.emulate(t);
    } catch (e) {
      log.warn('browser', 'placing a tab failed', { cause: errText(e), data: { tab: t.id } });
    }
  }

  /** The CSS viewport the page lays out in: DESKTOP for agent tabs (while emulated), else the view's own size. */
  viewport(t: Tab): { width: number; height: number } {
    if (t.agent && t.emu !== null) return { ...DESKTOP };
    const b = t.view.getBounds();
    return { width: b.width, height: b.height };
  }

  /** Agent tabs: the page lays out at DESKTOP and is drawn at t.scale in its view (CDP device emulation, the same as
   *  DevTools' device mode: the user's clicks in the scaled view land right, CDP input and screenshots are in view px
   *  and are converted by actions.ts). Only sent when the scale changed. */
  private emulate(t: Tab): void {
    if (!t.agent || !t.committed || !t.cdp?.isAttached || t.wc.isDestroyed() || t.emu === t.scale) return;
    const scale = t.scale;
    t.emu = scale;
    t.cdp.send('Emulation.setDeviceMetricsOverride', { width: DESKTOP.width, height: DESKTOP.height, deviceScaleFactor: 0, mobile: false, scale, screenWidth: DESKTOP.width, screenHeight: DESKTOP.height })
      .catch(e => { if (t.emu === scale) t.emu = null; log.warn('browser', 'desktop size emulation failed', { cause: errText(e), data: { tab: t.id }, hint: 'the tab lays out at its tile size until the next navigation' }); });
  }

  private hook(win: BrowserWindow): void {
    this.hooked = win;
    const again = () => { for (const t of this.tabs.values()) this.place(t); };
    for (const ev of ['minimize', 'restore', 'hide', 'show'] as const) win.on(ev as 'show', again);
  }

  private parkWindow(): BrowserWindow {
    if (this.park && !this.park.isDestroyed()) return this.park;
    const park = new BrowserWindow({
      ...PARK_SIZE, show: false, frame: false, skipTaskbar: true, focusable: false, type: 'toolbar', resizable: false, title: 'second-brain tabs',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    park.setPosition(-32000, -32000);
    park.setOpacity(0);
    park.setIgnoreMouseEvents(true);
    park.showInactive();
    park.on('closed', () => { if (this.park === park) { this.park = null; for (const t of this.tabs.values()) if (t.host === 'park') t.host = null; } });
    this.park = park;
    return park;
  }

  /** View px per CSS px actually in force (1 when the emulation is not set: the page then lays out at its view size). */
  cssScale(t: Tab): number { return t.emu ?? 1; }

  isShown(t: Tab): boolean { return t.host === 'main'; }

  private unplace(t: Tab): void {
    try {
      const win = this.opts.window();
      if (t.host === 'main' && win && !win.isDestroyed()) win.contentView.removeChildView(t.view);
      if (t.host === 'park' && this.park && !this.park.isDestroyed()) this.park.contentView.removeChildView(t.view);
    } catch { /* window gone */ }
    t.host = null;
  }

  // ---------- downloads ----------

  private onDownload(item: Electron.DownloadItem, wc: WebContents): void {
    const tab = this.byWc.get(wc.id);
    if (!tab || !tab.agent) return;                               // the user's own tabs: the normal save dialog
    const dir = path.join(this.evidenceDir(tab.group), 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    const base = (item.getFilename() || 'download').replace(/[^A-Za-z0-9_.() -]+/g, '_').slice(0, 120) || 'download';
    let file = path.join(dir, base);
    for (let i = 1; fs.existsSync(file) || this.reserved.has(file); i++) file = path.join(dir, `${path.parse(base).name} (${i})${path.parse(base).ext}`);
    this.reserved.add(file);
    item.setSavePath(file);
    item.once('done', (_e, state) => {
      this.reserved.delete(file);
      tab.downloads.push({ path: file, url: redact(item.getURL()).slice(0, 300), state, at: Date.now() });
      log.info('browser', 'download finished', { chat: tab.owner ?? undefined, data: { tab: tab.id, state, file } });
      this.emitTabs();
    });
  }

  // ---------- events ----------

  toBrowserTab(t: Tab): BrowserTab {
    const destroyed = t.wc.isDestroyed();
    const h = this.handoffs.openFor(t.id);
    return {
      id: t.id,
      url: destroyed ? '' : t.wc.getURL(),
      title: destroyed ? '' : t.wc.getTitle(),
      loading: destroyed ? false : t.wc.isLoading(),
      ownerChatId: t.group.startsWith('chat:') ? t.owner : null,
      ...(t.lastAction ? { lastAction: t.lastAction } : {}),
      group: t.group,
      active: this.groups.get(t.group)?.active === t.id,
      ...(t.dialog ? { dialog: `${t.dialog.type}: ${t.dialog.message.slice(0, 200)}` } : {}),
      ...(h ? { handoffId: h.id } : {}),
      env: t.env,
      envColor: envColor(t.env),
      session: this.sessionStatus(t.env),
    };
  }

  list(): BrowserTab[] { return [...this.tabs.values()].map(t => this.toBrowserTab(t)); }

  emitTabs(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.opts.emitter.emit('browser:tabs', this.list()); }, 40);
  }

  setLastAction(t: Tab, label: string): void { t.lastAction = label.slice(0, 120); this.emitTabs(); }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.handoffs.cancelAll();
    for (const t of [...this.tabs.values()]) { try { this.close(t.id); } catch { /* gone */ } }
    for (const timer of [this.emitTimer, this.envTimer]) if (timer) clearTimeout(timer);
    if (this.tick) clearInterval(this.tick);
    this.envStore.flush();
    await Promise.allSettled([...this.sessions.values()].map(s => s.cookies.flushStore()));
    if (this.park && !this.park.isDestroyed()) this.park.destroy();
    this.park = null;
  }
}

function safeFrameUrl(f: WebFrameMain | null | undefined): string {
  try { return f && !f.detached && f.parent ? redact(f.url).slice(0, 200) : ''; } catch { return ''; }
}
