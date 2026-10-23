// The user's personal browser (the Browser page, ADR 0133). Why: the owner, 2026-10-23: «una sezione per far usare
// all'utente il browser proprio per tutti i giorni … con la possibilità di salvare sessioni e preferiti … slegato dai
// browser che aprono gli agenti». Its tabs are WebContentsViews in ONE partition of their own (persist:personal), apart
// from every agent environment (browser/envs.ts): agents never see them (no MCP tool, no app_state, no app_screenshot,
// app_logs carries no address), and they never see the agents' sessions. No CDP, no device emulation: a plain
// browser. Shown in the app window at the rect the Browser page reports through views:layout (the same reporter as
// the agent tiles, renderer lib/viewports.ts); a tab not in the layout is taken out of the window (it keeps running,
// so music or a call go on). Popups and target=_blank open as tabs (opener kept: OAuth popups work), downloads use
// the normal save dialog, a right click gives a small menu (copy, paste, open link in a new tab). Sites see Chrome's
// user agent (address.ts). Bookmarks, sessions and history: store.ts; passwords: vault.ts (filled only into a page of
// their own site, at the user's click). Every change is pushed as `personal:changed`. Used by wiring.ts and index.ts.
import { Menu, WebContentsView, clipboard, dialog, session as electronSession, shell, type BrowserWindow, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Emitter } from '../ipc';
import type { Lang, PersonalLogin, PersonalState, PersonalTab, ViewLayout } from '../../shared/contract';
import type { SecretCipher } from '../engines/secrets';
import { log, errText } from '../log';
import { isCloseKey } from '../keyguard';
import { PersonalStore, keepable } from './store';
import { LoginVault, loginsFromCsv, siteOf } from './vault';
import { SEARCH_URL, cleanUserAgent, resolveInput } from './address';
import { PERSONAL_WORLD, detectScript, fillScript, readScript } from './page';

export const PERSONAL_PARTITION = 'persist:personal';
const MAX_TABS = 40;
/** How long a copied password stays on the clipboard. */
const CLEAR_MS = 30_000;
const MAX_CSV = 20 * 1024 * 1024;

interface PTab { id: string; view: WebContentsView; wc: WebContents; login: boolean; shown: boolean; createdAt: number }

export interface PersonalOptions {
  emitter: Emitter;
  window: () => BrowserWindow | null;
  userData: string;
  cipher: SecretCipher;
  appName?: string;
  lang?: () => Lang;
}

/** The clipboard: the system one, or (SB_TEST=1) the in-memory one the e2e suite reads (browser/service.ts's). */
function clip(): { writeText(t: string): void; readText(): string | Promise<string>; clear(): void } {
  const mem = (globalThis as Record<string, unknown>).__sbClipboard as ReturnType<typeof clip> | undefined;
  return process.env.SB_TEST === '1' && mem ? mem : clipboard;
}

export class PersonalBrowser {
  private readonly tabs = new Map<string, PTab>();
  private order: string[] = [];
  private active: string | null = null;
  private seq = 0;
  private ses: Session | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;
  private closing = false;
  readonly store: PersonalStore;
  readonly vault: LoginVault;

  constructor(private readonly o: PersonalOptions) {
    this.store = new PersonalStore(path.join(o.userData, 'personal-browser.json'));
    this.vault = new LoginVault(path.join(o.userData, 'personal-passwords.json'), o.cipher);
  }

  private it(): boolean { return (this.o.lang?.() ?? 'it') === 'it'; }

  /** The partition, hardened once: only fullscreen and the clipboard's sanitized write are granted (no camera,
   *  microphone, location or notifications: the app has no prompt for them yet). */
  private session(): Session {
    if (this.ses) return this.ses;
    const ses = electronSession.fromPartition(PERSONAL_PARTITION);
    const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent(), this.o.appName));
    this.ses = ses;
    return ses;
  }

  // ---------- state ----------

  owns(wc: WebContents | undefined | null): boolean { return !!wc && [...this.tabs.values()].some(t => t.wc === wc); }
  /** A personal tab is on screen (app_screenshot then leaves the window out: it would show the user's pages). */
  anyShown(): boolean { return [...this.tabs.values()].some(t => t.shown); }

  private toTab(t: PTab): PersonalTab {
    const dead = t.wc.isDestroyed();
    const url = dead ? '' : t.wc.getURL();
    return {
      id: t.id, url: url === 'about:blank' ? '' : url, title: dead ? '' : t.wc.getTitle(), loading: !dead && t.wc.isLoading(),
      canBack: !dead && t.wc.navigationHistory.canGoBack(), canForward: !dead && t.wc.navigationHistory.canGoForward(), active: this.active === t.id, login: t.login,
    };
  }

  state(): PersonalState {
    return {
      tabs: this.order.flatMap(id => { const t = this.tabs.get(id); return t ? [this.toTab(t)] : []; }),
      bookmarks: this.store.bookmarks(), sessions: this.store.sessions(), history: this.store.history(300), logins: this.vault.list(),
      vault: this.vault.unavailable(), lastTabs: this.restored ? 0 : this.store.lastTabs().length,
    };
  }

  private emit(): void {
    if (this.emitTimer || this.closing) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.o.emitter.emit('personal:changed', this.state());
      if (this.restored || this.tabs.size) this.store.setLastTabs(this.openTabs());
    }, 60);
  }

  private openTabs(): { url: string; title: string }[] {
    return this.order.flatMap(id => { const t = this.tabs.get(id); return t && !t.wc.isDestroyed() && keepable(t.wc.getURL()) ? [{ url: t.wc.getURL(), title: t.wc.getTitle() }] : []; });
  }

  private tab(id: unknown): PTab {
    const t = this.tabs.get(String(id));
    if (!t || t.wc.isDestroyed()) throw new Error(this.it() ? 'Scheda non trovata: forse è stata chiusa.' : 'Tab not found: it may have been closed.');
    return t;
  }

  // ---------- tabs ----------

  open(url?: string, opts: { webContents?: WebContents; background?: boolean } = {}): PersonalTab {
    if (this.tabs.size >= MAX_TABS) throw new Error(this.it() ? `Hai già ${MAX_TABS} schede aperte: chiudine qualcuna.` : `${MAX_TABS} tabs are open already: close some.`);
    const ses = this.session();
    const view = opts.webContents
      ? new WebContentsView({ webContents: opts.webContents })
      : new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: true } });
    view.setBackgroundColor('#ffffff');
    const t: PTab = { id: `p${++this.seq}`, view, wc: view.webContents, login: false, shown: false, createdAt: Date.now() };
    this.tabs.set(t.id, t);
    const at = this.active ? this.order.indexOf(this.active) : -1;
    if (opts.webContents && at >= 0) this.order.splice(at + 1, 0, t.id); else this.order.push(t.id);
    if (!opts.background) this.active = t.id;
    this.wire(t);
    if (!opts.webContents && url) this.load(t, resolveInput(url));
    this.emit();
    return this.toTab(t);
  }

  private load(t: PTab, url: string): void {
    if (url === 'about:blank' && !t.wc.getURL()) return;   // a new tab: the page shows its start screen
    t.wc.loadURL(url).catch(e => { if (!/ERR_ABORTED/.test(errText(e))) log.info('personal', 'page did not load', { data: { tab: t.id, cause: errText(e).replace(/https?:\/\/\S+/g, '<url>') } }); });
  }

  navigate(tabId: string, input: string): void {
    const t = this.tab(tabId);
    this.load(t, resolveInput(input));
    this.active = t.id;
    this.emit();
  }

  go(tabId: string, dir: 'back' | 'forward' | 'reload' | 'stop'): void {
    const t = this.tab(tabId);
    const h = t.wc.navigationHistory;
    if (dir === 'back' && h.canGoBack()) h.goBack();
    else if (dir === 'forward' && h.canGoForward()) h.goForward();
    else if (dir === 'reload') t.wc.reload();
    else if (dir === 'stop') t.wc.stop();
  }

  select(tabId: string): void { this.active = this.tab(tabId).id; this.emit(); }

  close(tabId: string): void {
    const t = this.tabs.get(tabId);
    if (!t) return;
    if (!t.wc.isDestroyed()) t.wc.close({ waitForBeforeUnload: false });
    this.remove(t);
  }

  private remove(t: PTab): void {
    if (this.tabs.get(t.id) !== t) return;
    this.unshow(t);
    this.tabs.delete(t.id);
    const i = this.order.indexOf(t.id);
    this.order = this.order.filter(x => x !== t.id);
    if (this.active === t.id) this.active = this.order[Math.min(i, this.order.length - 1)] ?? null;
    this.emit();
  }

  /** The tabs open when the app last closed, once (the start page's «Riapri le schede»). */
  restore(): boolean {
    if (this.restored) return false;
    this.restored = true;
    const last = this.store.lastTabs();
    for (const x of last.slice(0, MAX_TABS - this.tabs.size)) this.open(x.url, { background: true });
    if (last.length && !this.active) this.active = this.order[0] ?? null;
    this.emit();
    return last.length > 0;
  }

  /** The start page's «Non ora»: the last tabs are not offered again (they are forgotten at the next change). */
  private markRestored(): void { this.restored = true; }

  private wire(t: PTab): void {
    const wc = t.wc;
    const changed = () => this.emit();
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate-in-page'] as const) wc.on(ev as 'did-stop-loading', changed);
    wc.on('did-navigate', (_e, url) => { t.login = false; this.markRestored(); this.store.visit(url, wc.getTitle()); this.emit(); });
    // a single-page sign-in (Google: e-mail, then password) changes its form without a load
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { this.store.visit(url, wc.getTitle()); setTimeout(() => void this.detect(t), 700); } });
    wc.on('page-title-updated', (_e, title) => { this.store.retitle(wc.getURL(), title); });
    wc.on('did-stop-loading', () => { void this.detect(t); });
    wc.on('destroyed', () => this.remove(t));
    wc.on('render-process-gone', (_e, d) => log.warn('personal', 'page crashed', { data: { tab: t.id, reason: d.reason }, hint: 'reload the tab' }));
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const k = input.key.toLowerCase();
      if (isCloseKey(input)) { e.preventDefault(); this.close(t.id); }
      else if (ctrl && !input.alt && k === 't') { e.preventDefault(); this.open(); }
      else if ((ctrl && !input.alt && k === 'r') || input.key === 'F5') { e.preventDefault(); wc.reload(); }
      else if (input.alt && !ctrl && input.key === 'ArrowLeft') { e.preventDefault(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
      else if (input.alt && !ctrl && input.key === 'ArrowRight') { e.preventDefault(); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
    });
    wc.setWindowOpenHandler(d => {
      if (/^(?:mailto|tel):/i.test(d.url)) { void shell.openExternal(d.url); return { action: 'deny' }; }
      if (!/^(?:https?:|about:blank)/i.test(d.url) || this.tabs.size >= MAX_TABS) return { action: 'deny' };
      const background = d.disposition === 'background-tab';
      return { action: 'allow', createWindow: options => { this.open(undefined, { webContents: (options as { webContents?: WebContents }).webContents, background }); return (options as { webContents: WebContents }).webContents; } };
    });
    wc.on('will-navigate', (e, url) => { if (/^(?:mailto|tel):/i.test(url)) { e.preventDefault(); void shell.openExternal(url); } });
    wc.on('context-menu', (_e, p) => this.menu(t, p));
  }

  private menu(t: PTab, p: Electron.ContextMenuParams): void {
    const it = this.it();
    const wc = t.wc;
    const items: MenuItemConstructorOptions[] = [];
    if (p.linkURL && /^https?:/i.test(p.linkURL)) {
      items.push({ label: it ? 'Apri il link in una nuova scheda' : 'Open link in new tab', click: () => { try { this.open(p.linkURL, { background: true }); } catch { /* too many tabs */ } } });
      items.push({ label: it ? 'Copia indirizzo del link' : 'Copy link address', click: () => clip().writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ label: it ? 'Taglia' : 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() });
      items.push({ label: it ? 'Copia' : 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() });
      items.push({ label: it ? 'Incolla' : 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() });
      items.push({ label: it ? 'Seleziona tutto' : 'Select all', click: () => wc.selectAll() });
      items.push({ type: 'separator' });
    } else if (p.selectionText.trim()) {
      const q = p.selectionText.trim().slice(0, 200);
      items.push({ label: it ? 'Copia' : 'Copy', click: () => wc.copy() });
      items.push({ label: it ? `Cerca «${q.slice(0, 30)}${q.length > 30 ? '…' : ''}» con Google` : `Search Google for “${q.slice(0, 30)}${q.length > 30 ? '…' : ''}”`, click: () => { try { this.open(`${SEARCH_URL}${encodeURIComponent(q)}`); } catch { /* too many tabs */ } } });
      items.push({ type: 'separator' });
    }
    if (p.mediaType === 'image' && /^https?:/i.test(p.srcURL)) {
      items.push({ label: it ? 'Apri immagine in una nuova scheda' : 'Open image in new tab', click: () => { try { this.open(p.srcURL, { background: true }); } catch { /* too many tabs */ } } });
      items.push({ label: it ? 'Salva immagine…' : 'Save image…', click: () => wc.downloadURL(p.srcURL) });
      items.push({ type: 'separator' });
    }
    items.push({ label: it ? 'Indietro' : 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
    items.push({ label: it ? 'Avanti' : 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
    items.push({ label: it ? 'Ricarica' : 'Reload', click: () => wc.reload() });
    const win = this.o.window();
    Menu.buildFromTemplate(items).popup(win && !win.isDestroyed() ? { window: win } : {});
  }

  /** Does the page show a sign-in form? (the key button lights up) */
  private async detect(t: PTab): Promise<void> {
    if (t.wc.isDestroyed() || !/^https?:/i.test(t.wc.getURL())) { if (t.login) { t.login = false; this.emit(); } return; }
    const login = await this.run<boolean>(t, detectScript(), 1500).then(v => v === true, () => false);
    if (login !== t.login) { t.login = login; this.emit(); }
  }

  private async run<T>(t: PTab, code: string, ms: number): Promise<T | null> {
    return Promise.race([
      t.wc.executeJavaScriptInIsolatedWorld(PERSONAL_WORLD, [{ code }]) as Promise<T>,
      new Promise<null>(r => setTimeout(() => r(null), ms)),
    ]);
  }

  // ---------- layout ----------

  /** The rects the renderer reports (views:layout): a personal tab is in the window only while it has one. */
  layout(views: ViewLayout[]): void {
    const rects = new Map<string, ViewLayout['rect']>();
    for (const v of Array.isArray(views) ? views : []) if (v && typeof v.tabId === 'string' && this.tabs.has(v.tabId)) rects.set(v.tabId, v.rect);
    const win = this.o.window();
    for (const t of this.tabs.values()) {
      const r = rects.get(t.id);
      const ok = !!r && [r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n)) && r.width >= 20 && r.height >= 20;
      if (!ok || !win || win.isDestroyed() || t.wc.isDestroyed()) { this.unshow(t); continue; }
      try {
        if (!t.shown) { win.contentView.addChildView(t.view); t.shown = true; }
        t.view.setBounds({ x: Math.round(r!.x), y: Math.round(r!.y), width: Math.round(r!.width), height: Math.round(r!.height) });
      } catch (e) { log.warn('personal', 'placing a tab failed', { cause: errText(e), data: { tab: t.id }, hint: 'switch page and back' }); }
    }
  }

  private unshow(t: PTab): void {
    if (!t.shown) return;
    t.shown = false;
    try { const win = this.o.window(); if (win && !win.isDestroyed()) win.contentView.removeChildView(t.view); } catch { /* window gone */ }
  }

  // ---------- bookmarks, sessions, history ----------

  addBookmark(url: string, title: string) { const b = this.store.addBookmark(url, title); this.emit(); return b; }
  removeBookmark(id: string): void { this.store.removeBookmark(id); this.emit(); }
  saveSession(name: string) { const s = this.store.saveSession(name, this.openTabs()); this.emit(); return s; }
  openSession(id: string): void {
    const s = this.store.session(id);
    if (!s) throw new Error(this.it() ? 'Sessione non trovata.' : 'Session not found.');
    this.markRestored();
    let first: string | null = null;
    for (const x of s.tabs.slice(0, Math.max(0, MAX_TABS - this.tabs.size))) { const tab = this.open(x.url, { background: true }); first ??= tab.id; }
    if (first) this.active = first;
    this.emit();
  }
  removeSession(id: string): void { this.store.removeSession(id); this.emit(); }
  clearHistory(): void { this.store.clearHistory(); this.emit(); }

  // ---------- passwords ----------

  /** Fills the tab's form with a saved login: only one of the page's own site (vault.ts passwordFor). */
  async fillLogin(tabId: string, id: string): Promise<boolean> {
    const t = this.tab(tabId);
    const cred = this.vault.passwordFor(id, t.wc.getURL());
    if (!cred) return false;
    const r = await this.run<string>(t, fillScript(cred.user, cred.password), 3000).catch(() => null);
    return r === 'both' || r === 'user' || r === 'password';
  }

  /** «Salva password»: what the user typed in the tab's form, encrypted at once. */
  async saveLogin(tabId: string): Promise<{ ok: boolean; reason?: string; login?: PersonalLogin }> {
    const it = this.it();
    const t = this.tab(tabId);
    const why = this.vault.unavailable();
    if (why) return { ok: false, reason: it ? `Non posso salvare password: ${why}.` : `Passwords cannot be saved: ${why}.` };
    if (!siteOf(t.wc.getURL())) return { ok: false, reason: it ? 'Le password si salvano solo su siti https.' : 'Passwords are saved only on https sites.' };
    const typed = await this.run<{ user: unknown; password: unknown } | null>(t, readScript(), 3000).catch(() => null);
    if (!typed || typeof typed.password !== 'string' || !typed.password) return { ok: false, reason: it ? 'Scrivi prima user name e password nel modulo della pagina, poi premi Salva.' : 'Type the user name and password in the page’s form first, then press Save.' };
    try {
      const { login } = this.vault.save(t.wc.getURL(), typeof typed.user === 'string' ? typed.user : '', typed.password);
      log.info('personal', 'password saved');
      this.emit();
      return { ok: true, login };
    } catch (e) { return { ok: false, reason: errText(e) }; }
  }

  removeLogin(id: string): void { this.vault.remove(id); this.emit(); }

  /** «Copia»: the user name, or the password (cleared from the clipboard after 30 s if still there). */
  copyLogin(id: string, field: 'user' | 'password'): boolean {
    const cred = this.vault.passwordFor(id, null);
    if (!cred) return false;
    const c = clip();
    if (field === 'user') { c.writeText(cred.user); return true; }
    c.writeText(cred.password);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => { this.clearTimer = null; void Promise.resolve(c.readText()).then(now => { if (now === cred.password) c.clear(); }); }, CLEAR_MS);
    this.clearTimer.unref?.();
    return true;
  }

  /** The CSV that Google Password Manager (passwords.google.com → Impostazioni → Esporta), Chrome, Edge or Firefox export. */
  async importLogins(): Promise<{ added: number; updated: number; skipped: number; cancelled?: boolean; reason?: string }> {
    const it = this.it();
    const why = this.vault.unavailable();
    if (why) return { added: 0, updated: 0, skipped: 0, reason: it ? `Non posso salvare password: ${why}.` : `Passwords cannot be saved: ${why}.` };
    const win = this.o.window();
    const opts: Electron.OpenDialogOptions = { title: it ? 'Importa password (CSV)' : 'Import passwords (CSV)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] };
    const pick = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = pick.filePaths[0];
    if (pick.canceled || !file) return { added: 0, updated: 0, skipped: 0, cancelled: true };
    try {
      if (fs.statSync(file).size > MAX_CSV) throw new Error(it ? 'File troppo grande per un export di password.' : 'File too large for a passwords export.');
      const { logins, skipped } = loginsFromCsv(fs.readFileSync(file, 'utf8'));
      const r = this.vault.saveMany(logins);
      log.info('personal', 'passwords imported', { data: { added: r.added, updated: r.updated, skipped } });
      this.emit();
      return { ...r, skipped };
    } catch (e) { return { added: 0, updated: 0, skipped: 0, reason: errText(e) }; }
  }

  // ---------- shutdown ----------

  async shutdown(): Promise<void> {
    if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; }
    if (this.restored || this.tabs.size) this.store.setLastTabs(this.openTabs());
    this.closing = true;
    this.store.flush();
    for (const t of [...this.tabs.values()]) { try { this.close(t.id); } catch { /* gone */ } }
    await this.ses?.cookies.flushStore().catch(() => {});
  }
}
