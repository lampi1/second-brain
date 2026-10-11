// Internal browser tabs. Each tab is a WebContentsView owned by a tab group ('user' = the user's own, 'chat:<id>' = an
// app chat, 'mcp:<session>' = an external MCP client) and living in one ENVIRONMENT: its own persistent, sandboxed
// session partition persist:env-<id> (envs.ts), so cookies and storage are never shared between environments; the
// default environment comes from the host, sharing one is explicit. A tab that has not loaded a real page yet is
// re-created in the right environment on its first navigation (a partition cannot change later).
// Visible tabs are placed in the app window at the rects the renderer reports (views:layout, the complete visible set);
// every other tab is "parked" in an invisible offscreen window so it keeps rendering at its last size: screenshots,
// rAF, hit-testing into cross-origin iframes all need a live compositor (a detached view has none). Agent tabs get a
// CDP session (cdp.ts) for trusted input, dialogs and network; Electron's own native dialog box is suppressed on them
// (the agent answers with handle_dialog). window.open / target=_blank become tabs of the same group and environment
// (opener kept, so OAuth popups work); downloads of agent tabs go to <userData>/evidence/<group>/downloads. Session
// status per environment (valid / expiring / expired) is tracked from auth cookies and login pages. Every change is
// pushed as `browser:tabs` / `browser:envs` events. Used by browser/actions.ts, browser/tools.ts, browser/service.ts.
import { BrowserWindow, WebContentsView, app, session as electronSession, type WebContents, type WebFrameMain, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserEnv, BrowserHandoff, BrowserSessionStatus, BrowserTab, Rect, ViewLayout } from '../../shared/contract';
import type { Emitter } from '../ipc';
import type { FeedInput } from '../services';
import { log, errText, redact } from '../log';
import { TabCdp } from './cdp';
import { NetLog } from './netlog';
import { Handoffs } from './handoffs';
import { groupFolder } from './evidence';
import { EnvStore, computeSession, envColor, envForUrl, envPartition, envSlug, isAuthCookie, isLoginUrl } from './envs';
import { cookieEncryptionEnabled } from './fuses';
import { hasPasswordField, pageCall } from './page';

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
  view: WebContentsView;
  wcId: number;
  wc: WebContents;
  cdp: TabCdp | null;
  host: 'main' | 'park' | null;
  size: { width: number; height: number };
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
}

interface Group { key: string; owner: string | null; active: string | null }
interface EnvRuntime { loginPage: boolean; hadAuth: boolean; status: { status: BrowserSessionStatus; detail: string; authExpiresAt: number | null } }

export interface TabsOptions { emitter: Emitter; window: () => BrowserWindow | null; userData: string }

export class BrowserTabs {
  readonly tabs = new Map<string, Tab>();
  private readonly groups = new Map<string, Group>();
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
      if (!t || t.group !== group) throw new Error(`No tab "${String(tabId)}" among your tabs: call tabs_list (you only see the tabs you opened).`);
      return t;
    }
    const t = this.activeOf(group);
    if (!t) throw new Error('You have no open tab: call navigate with a url (it opens one) or tabs_create.');
    return t;
  }

  select(group: string, tabId: string): Tab {
    const t = this.tabFor(group, tabId);
    this.group(group, t.owner).active = t.id;
    this.emitTabs();
    return t;
  }

  closeGroup(group: string): number {
    const mine = this.tabsOf(group);
    for (const t of mine) this.close(t.id);
    this.groups.delete(group);
    return mine.length;
  }

  // ---------- tabs ----------

  create(group: string, owner: string | null, url?: string, opts: { webContents?: WebContents; openedBy?: string; env?: string; id?: string } = {}): Tab {
    if (this.tabsOf(group).length >= MAX_TABS_PER_GROUP) throw new Error(`Too many tabs (${MAX_TABS_PER_GROUP}) in this group: close some with tabs_close.`);
    const envExplicit = opts.env !== undefined && opts.env !== '';
    const env = envExplicit ? envSlug(opts.env) : envForUrl(url);
    const id = opts.id ?? `t${++this.seq}`;
    this.sessionFor(env);
    const view = opts.webContents
      ? new WebContentsView({ webContents: opts.webContents })
      : new WebContentsView({
        webPreferences: { partition: envPartition(env), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
      });
    const wc = view.webContents;
    const agent = group !== 'user';
    if (agent) this.envStore.markAgent(env);
    const tab: Tab = {
      id, group, owner, agent, env, envExplicit, fresh: !opts.webContents && (!url || url === 'about:blank'),
      view, wc, wcId: wc.id, cdp: null, host: null, size: { ...DEFAULT_SIZE }, frameNos: new Map(), frameSeq: 0, refStart: new Map(),
      console: [], consoleSeq: 0, net: new NetLog(), dialog: null, dialogSeq: 0, lastDialog: null, dialogWaiters: new Set(), pendingDialogCb: null,
      forceUnload: false, unloadBlockedAt: 0, downloads: [], openedBy: opts.openedBy ?? null, createdAt: Date.now(),
    };
    this.tabs.set(id, tab);
    this.byWc.set(wc.id, tab);
    this.group(group, owner).active = id;
    view.setBackgroundColor('#ffffff');
    this.wire(tab);
    if (agent) {
      tab.cdp = new TabCdp(wc, (m, p, s) => this.onCdp(tab, m, p, s), id, () => this.onDetached(tab));
      void tab.cdp.attach();
    }
    this.place(tab);
    if (url && !opts.webContents) wc.loadURL(url).catch(e => { if (!/ERR_ABORTED/.test(errText(e))) log.info('browser', 'initial load failed', { data: { tab: id, url: redact(url), cause: errText(e) } }); });
    log.info('browser', 'tab opened', { chat: owner ?? undefined, data: { tab: id, group, env, popup: !!opts.webContents } });
    this.emitTabs();
    this.emitEnvs();
    return tab;
  }

  /** A tab that has not loaded a real page yet moves to another environment (same id, same place on screen). */
  rebind(old: Tab, env: string): Tab {
    if (old.env === env || !old.fresh) return old;
    const wasActive = this.groups.get(old.group)?.active === old.id;
    const prevActive = this.groups.get(old.group)?.active ?? null;
    this.tabs.delete(old.id);
    this.byWc.delete(old.wcId);
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

  close(tabId: string): void {
    const t = this.tabs.get(tabId);
    if (!t) return;
    if (!t.wc.isDestroyed()) t.wc.close({ waitForBeforeUnload: false });
    this.remove(t);
  }

  private remove(t: Tab): void {
    if (this.tabs.get(t.id) !== t) return;           // already removed, or replaced by rebind()
    this.tabs.delete(t.id);
    this.byWc.delete(t.wcId);
    this.visible.delete(t.id);
    t.cdp?.dispose();
    this.unplace(t);
    for (const w of t.dialogWaiters) w();
    this.handoffs.cancelTab(t.id);
    const g = this.groups.get(t.group);
    if (g && g.active === t.id) {
      const rest = this.tabsOf(t.group);
      g.active = (t.openedBy && this.tabs.has(t.openedBy) ? t.openedBy : rest[rest.length - 1]?.id) ?? null;
    }
    log.info('browser', 'tab closed', { chat: t.owner ?? undefined, data: { tab: t.id } });
    this.emitTabs();
    this.emitEnvs();
  }

  private onDetached(tab: Tab): void {
    if (tab.pendingDialogCb) { tab.pendingDialogCb(false, ''); tab.pendingDialogCb = null; }
    if (tab.dialog) {                                  // no Page.javascriptDialogClosed will come once detached
      tab.lastDialog = { ...tab.dialog, result: 'dismissed (automation detached)' };
      tab.dialog = null;
      this.emitTabs();
    }
  }

  private wire(tab: Tab): void {
    const wc = tab.wc;
    const changed = () => this.emitTabs();
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate-in-page', 'page-title-updated'] as const) wc.on(ev as 'did-stop-loading', changed);
    wc.on('did-navigate', (_e, url) => { if (url && url !== 'about:blank') tab.fresh = false; this.emitTabs(); });
    wc.on('did-stop-loading', () => { void this.onPageLoaded(tab); });
    wc.on('did-navigate-in-page', (_e, _url, isMain) => { if (isMain) void this.onPageLoaded(tab); });
    wc.on('destroyed', () => this.remove(tab));
    wc.on('console-message', e => {
      const d = e as unknown as { level: string; message: string; lineNumber: number; sourceId: string; frame?: WebFrameMain | null };
      tab.console.push({ seq: ++tab.consoleSeq, at: Date.now(), level: d.level, text: redact(String(d.message)).slice(0, 2000), source: `${d.sourceId ?? ''}:${d.lineNumber ?? ''}`, frame: safeFrameUrl(d.frame) });
      if (tab.console.length > 500) tab.console.shift();
    });
    wc.on('will-prevent-unload', e => {
      if (!tab.agent || tab.forceUnload) { e.preventDefault(); return; }
      tab.unloadBlockedAt = Date.now();
    });
    wc.on('render-process-gone', (_e, d) => log.warn('browser', 'tab renderer gone', { data: { tab: tab.id, reason: d.reason }, hint: 'reload the tab (navigate reload)' }));
    wc.setWindowOpenHandler(d => {
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
      if (tab.cdp?.isAttached) { tab.pendingDialogCb = cb; return; }
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

  private place(t: Tab): void {
    if (this.closing || t.wc.isDestroyed()) return;
    const win = this.opts.window();
    if (win && !win.isDestroyed() && win !== this.hooked) this.hook(win);
    const showing = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const rect = showing ? this.visible.get(t.id) : undefined;
    try {
      if (rect && win) {
        if (t.host !== 'main') { win.contentView.addChildView(t.view); t.host = 'main'; }
        t.view.setBounds(rect);
        t.size = { width: Math.min(rect.width, PARK_SIZE.width), height: Math.min(rect.height, PARK_SIZE.height) };
      } else {
        const park = this.parkWindow();
        if (t.host !== 'park') { park.contentView.addChildView(t.view); t.host = 'park'; }
        t.view.setBounds({ x: 0, y: 0, ...t.size });
      }
    } catch (e) {
      log.warn('browser', 'placing a tab failed', { cause: errText(e), data: { tab: t.id } });
    }
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
