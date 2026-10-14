// The global request layer (product requirement: questions must reach the user wherever they are in the app, and be
// answerable there). Browser tabs are native views drawn ABOVE the app page, so a DOM
// overlay would hide under a browser tile: the layer is its own small, transparent, top-most WebContentsView that loads
// the same renderer bundle (index.html#overlay) with the same preload. Main owns it: it is attached only while it has
// cards, toasts or the waiting strip (so it never intercepts clicks or shows up as a view otherwise), placed bottom-right (beside the Regia widget: the model's `avoid`), sized to what its page
// reports (overlay:size), kept on top whenever other views are added, and focused only on demand (overlay:focus from
// Ctrl+J or a click: it never steals the keyboard while the user types). The app page decides the cards (overlay:model);
// what the user does in the layer goes back to the app page (overlay:action). Used by index.ts.
import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import type { OverlayAction, OverlayModel } from '../shared/contract';
import { Emitter } from './ipc';
import { swallowCloseKey } from './keyguard';
import { log } from './log';

const MARGIN = 16;      // from the window's right and bottom edges
const MIN_TOP = 56;     // never over the top bar
const WIDTH = 420;      // the page lays its cards out in this width (shadows included)

/** A room the page asks the layer to keep free, kept sane: a number, leaving the layer at least `keep` px. */
const clampAvoid = (v: unknown, size: number, keep: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), size - keep)) : 0);

export class OverlayLayer {
  private view: WebContentsView | null = null;
  private model: OverlayModel | null = null;
  private size = { width: WIDTH, height: 0 };
  private attached = false;
  private keepTop: ReturnType<typeof setInterval> | null = null;
  private toOverlay: Emitter;
  private toApp: Emitter;
  private ready = false;

  constructor(private win: () => BrowserWindow | null, private outDir: string) {
    this.toOverlay = new Emitter(() => this.view?.webContents ?? null);
    this.toApp = new Emitter(() => this.win()?.webContents ?? null);
  }

  /** The layer page's webContents (index.ts allows it as an IPC sender for the overlay:* channels only). */
  get contents(): WebContents | null { return this.view?.webContents ?? null; }

  /** Create the view and load its page once the window exists (it stays detached until there are cards). */
  start(): void {
    const win = this.win();
    if (!win || this.view) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(this.outDir, 'preload', 'index.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, transparent: true,
      },
    });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', e => e.preventDefault());
    swallowCloseKey(wc); // focused layer + Ctrl+W would reach the default menu and quit the app (keyguard.ts)
    wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    wc.on('did-finish-load', () => { this.ready = true; if (this.model) this.toOverlay.emit('overlay:model', this.model); });
    wc.on('did-start-loading', () => { this.ready = false; });
    wc.on('render-process-gone', (_e, d) => {
      this.ready = false; // events sent now would be lost: the reloaded page gets the model on did-finish-load
      log.error('overlay', 'layer page crashed', { cause: d.reason, hint: 'it reloads by itself; questions stay answerable in the app' });
      setTimeout(() => { if (!wc.isDestroyed()) void wc.loadFile(path.join(this.outDir, 'renderer', 'index.html'), { hash: 'overlay' }); }, 300);
    });
    void wc.loadFile(path.join(this.outDir, 'renderer', 'index.html'), { hash: 'overlay' });
    this.view = view;
    win.on('resize', () => this.place());
    win.on('closed', () => this.stop());
  }

  stop(): void {
    if (this.keepTop) clearInterval(this.keepTop);
    this.keepTop = null;
    this.attached = false;
  }

  /** overlay:model from the app page. */
  setModel(model: OverlayModel): void {
    const hadCards = (this.model?.cards.length ?? 0) > 0;
    this.model = model;
    // the last card answered while the layer had the keyboard (toasts may keep it on screen): back to the app
    if (hadCards && model.cards.length === 0 && this.view?.webContents.isFocused()) this.win()?.webContents.focus();
    if (this.ready) this.toOverlay.emit('overlay:model', model);
    this.sync();
  }

  /** overlay:size from the layer page. */
  setSize(width: number, height: number): void {
    const w = Math.max(200, Math.min(640, Math.round(width) || WIDTH));
    const h = Math.max(0, Math.min(2000, Math.round(height) || 0));
    this.size = { width: w, height: h };
    this.sync();
  }

  /** overlay:action from the layer page → the app page (its store answers, postpones, opens). */
  relay(action: OverlayAction): void {
    // a click on the waiting strip (no card here): the keyboard goes back to the app first; if the request floats
    // here after all, focusLayer's overlay:focus brings it back
    if (action.kind === 'next' && !this.model?.cards.length) this.focus('app');
    this.toApp.emit('overlay:action', action);
    // leaving, opening a chat or using a toast (Apri / ✕): the keyboard goes back to the app
    if (action.kind === 'leave' || action.kind === 'open' || action.kind === 'toast') this.focus('app');
  }

  /** overlay:focus: keyboard to the layer (Ctrl+J, click) or back to the app. */
  focus(target: 'overlay' | 'app'): void {
    const win = this.win();
    if (!win || win.isDestroyed()) return;
    if (target === 'overlay' && this.attached && this.view) this.view.webContents.focus();
    else win.webContents.focus();
  }

  // attached as soon as there are cards (the page must be on screen to lay out and report its real size)
  private wanted(): boolean { return !!this.model && (this.model.cards.length > 0 || (this.model.toasts?.length ?? 0) > 0 || !!this.model.strip); }

  private sync(): void {
    const win = this.win();
    if (!win || win.isDestroyed() || !this.view) return;
    if (this.wanted() && !this.attached) {
      win.contentView.addChildView(this.view);
      this.attached = true;
      // other modules add browser views later: put the layer back on top whenever it is not the last child
      this.keepTop = setInterval(() => this.raise(), 250);
    } else if (!this.wanted() && this.attached) {
      const hadFocus = this.view.webContents.isFocused();
      win.contentView.removeChildView(this.view);
      this.attached = false;
      if (this.keepTop) clearInterval(this.keepTop);
      this.keepTop = null;
      if (hadFocus) win.webContents.focus();
    }
    this.place();
  }

  private raise(): void {
    const win = this.win();
    if (!win || win.isDestroyed() || !this.view || !this.attached) return;
    const kids = win.contentView.children;
    if (kids[kids.length - 1] !== this.view) win.contentView.addChildView(this.view);
  }

  private place(): void {
    const win = this.win();
    if (!win || win.isDestroyed() || !this.view || !this.attached) return;
    const [cw = 0, ch = 0] = win.getContentSize();
    // the Regia widget's corner (ADR 0028): left of the expanded panel, above the collapsed bar
    const right = clampAvoid(this.model?.avoid?.right, cw, 200 + 2 * MARGIN), bottom = clampAvoid(this.model?.avoid?.bottom, ch, MIN_TOP + MARGIN + 120);
    const width = Math.min(this.size.width, Math.max(200, cw - 2 * MARGIN - right));
    const height = Math.min(this.size.height || 260, Math.max(0, ch - MIN_TOP - MARGIN - bottom));
    this.view.setBounds({ x: Math.max(0, cw - width - MARGIN - right), y: ch - height - MARGIN - bottom, width, height });
  }

  /** For e2e tests and the app-control screenshot: where the layer is, if shown. */
  state(): { attached: boolean; bounds: { x: number; y: number; width: number; height: number } | null; cards: number; toasts: number; strip: number } {
    return { attached: this.attached, bounds: this.attached && this.view ? this.view.getBounds() : null, cards: this.model?.cards.length ?? 0, toasts: this.model?.toasts?.length ?? 0, strip: this.model?.strip?.count ?? 0 };
  }
}
