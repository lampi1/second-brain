// Demo BrowserService (SB_DEMO=1): two tabs owned by demo chats, each a real WebContentsView (own in-memory partition,
// sandboxed) showing a local fictional page (demo-pages.ts), placed exactly where the renderer's browser tiles report
// (views:layout; rect null = hidden), with a live JPEG thumbnail in BrowserTab.thumb for the Grindhouse strip and for the
// frozen frame shown under overlays. Why: the browser tiles and the layout protocol can be built and tested before
// the real browser module lands. Used by wiring.ts; e2e tests read globalThis.__sbDemo.layout() to check what the UI
// reported (e.g. every rect null while the palette is open).
import { timersFor } from './timers';
const { setInterval, clearInterval } = timersFor('demo-browser');
import { WebContentsView, type BrowserWindow } from 'electron';
import type { BrowserEnv, BrowserHandoff, CredentialEntry, BrowserTab, Rect, ViewLayout } from '../shared/contract';
import type { BrowserService, FeedInput } from './services';
import type { DemoAction, DemoBrowserHooks, Emit } from './demo';
import { pageUrl, type DemoPage } from './demo-pages';
import { swallowCloseKey } from './keyguard';
import { log } from './log';

const DEMO_CREDENTIALS: CredentialEntry[] = [
  { id: 'demo-1', group: 'air · test', user: 'mario.rossi@example.com', url: 'https://test-3.demo.test/Account/Login', note: 'holding con modulo X attivo (prove modulo X)' },
  { id: 'demo-2', group: 'air · test', user: 'anna.bianchi@example.com', note: 'Prodotto B (area B), holding di prova' },
  { id: 'demo-3', group: 'air · local', user: 'admin@localhost.test', url: 'https://localhost:44300/Account/Login', note: 'stack locale Prodotto A' },
  { id: 'demo-4', group: 'sistemaTsTest', user: 'MEDICO-DEMO-01', note: 'Sistema TS TEST (invio 730), medico' },
];

interface Entry { tab: BrowserTab; view: WebContentsView | null; page: DemoPage }

export class DemoBrowser implements BrowserService, DemoBrowserHooks {
  private tabs = new Map<string, Entry>();
  private last: ViewLayout[] = [];
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private n = 0;

  constructor(private win: () => BrowserWindow | null, private emit: Emit, private freeze: boolean, onChatTabs: (chatId: string, tabIds: string[]) => void) {
    this.onChatTabs = onChatTabs;
  }
  private onChatTabs: (chatId: string, tabIds: string[]) => void;

  seed(tabs: BrowserTab[], pages: Record<string, DemoPage>): void {
    for (const t of tabs) this.add({ ...t }, pages[t.id] ?? 'blank');
    if (!this.freeze) this.interval = setInterval(() => void this.capture(), 2500);
  }

  private add(tab: BrowserTab, page: DemoPage): Entry {
    const win = this.win();
    let view: WebContentsView | null = null;
    if (win) {
      view = new WebContentsView({ webPreferences: { partition: 'sb-demo-browser', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
      view.setBackgroundColor('#ffffff');
      view.setBorderRadius(8);
      view.setVisible(false);
      view.setBounds({ x: 0, y: 0, width: 820, height: 560 });
      win.contentView.addChildView(view);
      const wc = view.webContents;
      swallowCloseKey(wc);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('will-navigate', e => e.preventDefault());
      wc.on('did-finish-load', () => this.scheduleCapture(150));
      void wc.loadURL(pageUrl(page));
    }
    const e: Entry = { tab, view, page };
    this.tabs.set(tab.id, e);
    return e;
  }

  private publish(): void { this.emit('browser:tabs', this.list()); }

  // ---- BrowserService
  list(): BrowserTab[] { return [...this.tabs.values()].map(e => e.tab); }

  open(url: string | undefined, ownerChatId: string | null): BrowserTab {
    const id = `tab-${++this.n}`;
    const e = this.add({ id, url: url || 'about:blank', title: 'Nuova scheda', loading: false, ownerChatId }, 'blank');
    if (ownerChatId) this.onChatTabs(ownerChatId, this.list().filter(t => t.ownerChatId === ownerChatId).map(t => t.id));
    this.publish();
    return e.tab;
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const e = this.tabs.get(tabId);
    if (!e) return;
    // the demo never leaves its local pages: the address changes, the page stays fictional
    e.tab = { ...e.tab, url, lastAction: `navigate ${url}` };
    this.publish();
  }

  async go(tabId: string, dir: 'back' | 'forward' | 'reload'): Promise<void> {
    const e = this.tabs.get(tabId);
    if (!e) return;
    if (dir === 'reload') e.view?.webContents.reload();
    e.tab = { ...e.tab, lastAction: dir === 'reload' ? 'ricarica' : dir === 'back' ? 'indietro' : 'avanti' };
    this.publish();
  }

  close(tabId: string): void {
    const e = this.tabs.get(tabId);
    if (!e) return;
    this.tabs.delete(tabId);
    if (e.view) { this.win()?.contentView.removeChildView(e.view); e.view.webContents.close(); }
    if (e.tab.ownerChatId) this.onChatTabs(e.tab.ownerChatId, this.list().filter(t => t.ownerChatId === e.tab.ownerChatId).map(t => t.id));
    this.publish();
  }

  layout(views: ViewLayout[]): void {
    for (const v of views) {
      const e = this.tabs.get(v.tabId);
      if (!e?.view) continue;
      const r = v.rect && sane(v.rect);
      if (r) { e.view.setBounds(r); e.view.setVisible(true); } else e.view.setVisible(false);
    }
    this.last = views;
    this.scheduleCapture(350);
  }

  mcpUrlFor(): string { return this.mcpUrl; }
  mcpUrl = 'http://127.0.0.1/mcp (demo)';

  // ---- environments, feed, forgetting a chat: the demo has one fictional environment per test host
  async envs(): Promise<BrowserEnv[]> {
    const byEnv = new Map<string, BrowserEnv>();
    for (const e of this.tabs.values()) {
      const host = (() => { try { return new URL(e.tab.url).host; } catch { return 'demo'; } })();
      const id = host.split('.')[0] ?? 'demo';
      const env = byEnv.get(id) ?? { id, color: id === 'test' ? '#7b93ff' : '#4fd18b', hosts: [host], tabIds: [], createdAt: 0, lastUsedAt: 0, lastLoginAt: null, session: 'unknown' as BrowserEnv['session'], sessionDetail: 'demo', authExpiresAt: null, encryptedAtRest: null };
      env.tabIds.push(e.tab.id);
      byEnv.set(id, env);
    }
    return [...byEnv.values()];
  }
  forgetChat(chatId: string): void { this.closeOwned(chatId); }
  setFeed(_fn: (e: FeedInput) => void): void { /* the demo browser has no events of its own */ }
  setWake(_fn: (chatId: string, text: string) => void): void { /* demo chats are scripted */ }
  /** The demo copies a fake user name, never a real secret. */
  copyFromHandoff(id: string, field: 'user' | 'password'): boolean {
    const h = this.hand.get(id);
    return !!h && h.state === 'open' && !!h.account?.found && (field === 'user' || field === 'password');
  }

  /** The "Credenziali" panel in the demo: fictional entries, and Copia never copies anything real. */
  credentials(): CredentialEntry[] { return DEMO_CREDENTIALS; }
  copyCredential(id: string, field: 'user' | 'password'): boolean { return DEMO_CREDENTIALS.some(e => e.id === id) && (field === 'user' || field === 'password'); }

  // ---- hand-offs (an agent asks the user to act in a tab): the demo can open one to show the banner
  private hand = new Map<string, BrowserHandoff>();
  handoffs(): BrowserHandoff[] { return [...this.hand.values()].filter(h => h.state === 'open'); }
  openHandoff(tabId: string, chatId: string | null, reason: string, instructions: string, at: number, extra: Partial<Pick<BrowserHandoff, 'kind' | 'env' | 'account'>> = {}): BrowserHandoff | null {
    const e = this.tabs.get(tabId);
    if (!e) return null;
    const h: BrowserHandoff = { id: `ho-${++this.n}`, tabId, chatId, reason, instructions, url: e.tab.url, state: 'open', at, ...extra };
    this.hand.set(h.id, h);
    e.tab = { ...e.tab, handoffId: h.id };
    this.emit('browser:handoff', h);
    this.publish();
    return h;
  }
  resolveHandoff(id: string, outcome: 'done' | 'failed', note?: string): void {
    const h = this.hand.get(id);
    if (!h || h.state !== 'open') return;
    const done: BrowserHandoff = { ...h, state: outcome, ...(note ? { note } : {}), resolvedAt: Date.now() };
    this.hand.set(id, done);
    const e = this.tabs.get(h.tabId);
    if (e) { const { handoffId: _drop, ...rest } = e.tab; e.tab = rest; }
    this.emit('browser:handoff', done);
    this.publish();
  }

  async shutdown(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
  }

  // ---- DemoBrowserHooks
  act(tabId: string, action: DemoAction): void {
    const e = this.tabs.get(tabId);
    if (!e) return;
    e.tab = { ...e.tab, lastAction: action.label };
    void e.view?.webContents.executeJavaScript(`window.__sb && window.__sb.move(${Number(action.x)}, ${Number(action.y)})`).catch(() => {});
    this.publish();
    this.scheduleCapture(650);
  }

  closeOwned(chatId: string): void {
    for (const e of [...this.tabs.values()]) if (e.tab.ownerChatId === chatId) this.close(e.tab.id);
  }

  /** What the renderer last reported (e2e tests read it through globalThis.__sbDemo). */
  lastLayout(): ViewLayout[] { return this.last; }
  views(): { tabId: string; visible: boolean; bounds: Rect }[] {
    return [...this.tabs.values()].filter(e => e.view).map(e => ({ tabId: e.tab.id, visible: e.view!.getVisible(), bounds: e.view!.getBounds() }));
  }

  // ---- thumbnails
  private scheduleCapture(ms: number): void {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => { this.thumbTimer = null; void this.capture(); }, ms);
  }

  /** e2e: behave like the real browser module, which has no snapshots yet */
  noThumbs = false;
  clearThumbs(): void {
    this.noThumbs = true;
    for (const e of this.tabs.values()) { const { thumb: _t, ...rest } = e.tab; e.tab = rest; }
    this.publish();
  }

  private async capture(): Promise<void> {
    if (this.noThumbs) return;
    let changed = false;
    for (const e of this.tabs.values()) {
      const wc = e.view?.webContents;
      if (!wc || wc.isDestroyed() || wc.isLoading()) continue;
      try {
        let img = await wc.capturePage(undefined, { stayHidden: true });
        if (img.isEmpty()) continue;
        if (img.getSize().width > 1100) img = img.resize({ width: 1100, quality: 'good' });
        const thumb = `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`;
        if (this.noThumbs) return; // cleared while this capture was in flight
        if (thumb !== e.tab.thumb) { e.tab = { ...e.tab, thumb }; changed = true; }
      } catch (err) {
        log.warn('demo', 'thumbnail capture failed', { data: { tab: e.tab.id, err: String(err) } });
      }
    }
    if (changed) this.publish();
  }
}

function sane(r: Rect): Rect | null {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const width = Math.round(r.width);
  const height = Math.round(r.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 8 || height < 8) return null;
  return { x, y, width, height };
}
