// The app window: sandboxed renderer from out/renderer, no navigation away, no new windows, no permissions.
// SB_HIDDEN=1 (e2e tests, the dev instance run by agents): the window still renders and can be screenshotted, but it
// lives off every screen, out of the taskbar, never takes focus ("finchè testi mi apri l'app davanti") and is muted (a
// DevOps alert's chime from a test never reaches the speakers).
// Its renderer is only a view: chats, CLIs, MCP and the brain live in main, so a crashed or hung page is reloaded and
// nothing else is lost (guardRenderer; counted in health.ts for app_state).
import { BrowserWindow, screen, shell, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppPage, setAppPage } from './ipc';
import { swallowCloseKey } from './keyguard';
import { log } from './log';
import { recordRenderer } from './health';

/** True when this instance must never appear in front of the user (SB_HIDDEN=1). */
export const hiddenRun = (env: NodeJS.ProcessEnv = process.env): boolean => env.SB_HIDDEN === '1';
/** What a hidden run would have opened outside the app (files, Explorer, the system browser): e2e reads it (__sbOpened). */
export const hiddenOpened: string[] = [];

export function createWindow(outDir: string): BrowserWindow {
  const hidden = hiddenRun();
  const win = new BrowserWindow({
    // right of every display, frameless (off every monitor Windows draws no frame: content size = window size)
    ...(hidden ? { x: Math.max(...screen.getAllDisplays().map(d => d.bounds.x + d.bounds.width)) + 400, y: 0, skipTaskbar: true, frame: false } : {}),
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640,
    title: 'second-brain', icon: path.join(outDir, process.platform === 'win32' ? 'icon.ico' : 'icon.png'), backgroundColor: '#0b0d12', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(outDir, 'preload', 'index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  const page = path.join(outDir, 'renderer', 'index.html');
  setAppPage(pathToFileURL(page).href);
  const wc = win.webContents;
  // a link the page opens (a chat's DevOps chips, a question's context links, "Apri fuori") goes to the system browser;
  // an agent's run (SB_HIDDEN, the e2e suite) never opens one: it records it (hiddenOpened)
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { if (hidden) hiddenOpened.push(`external ${url}`); else void shell.openExternal(url); }
    return { action: 'deny' };
  });
  // the window only ever shows our own page: any navigation elsewhere (even another file:// URL) is blocked
  wc.on('will-navigate', (e, url) => { if (!isAppPage(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!isAppPage(url)) e.preventDefault(); });
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (hidden) wc.setAudioMuted(true);
  // DevTools pass unhandled keys to the window's default menu, whose Ctrl+W would quit the app (keyguard.ts)
  wc.on('devtools-opened', () => { if (wc.devToolsWebContents) swallowCloseKey(wc.devToolsWebContents); });
  // hidden: shown inactive off screen (a never-shown window stops painting and cannot be captured)
  // and its page gets the keyboard inside the app as a shown window would, without activating it on the desktop
  win.once('ready-to-show', () => { if (hidden) { win.showInactive(); wc.focus(); } else win.show(); });
  // SB_HANG_RELOAD_MS: e2e only, a hang reloads at once
  guardRenderer(win, () => win.loadFile(page), { hangMs: Number(process.env.SB_HANG_RELOAD_MS) || undefined });
  void win.loadFile(page);
  return win;
}

/** How long the page may stay unresponsive before it is reloaded (a heavy render may block it for a few seconds). */
export const HANG_RELOAD_MS = 15000;
/** Reloads allowed in RELOAD_WINDOW_MS: past that the page crashes in a loop and is left as it is (logged). */
export const MAX_RELOADS = 3;
export const RELOAD_WINDOW_MS = 60000;

/** Whether one more reload is allowed, given the times of the earlier ones (pure, for tests). */
export function reloadAllowed(times: number[], now: number): boolean {
  return times.filter(t => now - t < RELOAD_WINDOW_MS).length < MAX_RELOADS;
}

/** Main window: a renderer crash reloads the page; a hang longer than HANG_RELOAD_MS kills the renderer, which then
 *  reloads the same way. Never while the window closes (a quit ends the renderer cleanly). */
export function guardRenderer(win: BrowserWindow, reload: () => Promise<void>, opts: { hangMs?: number } = {}): void {
  const wc: WebContents = win.webContents;
  const times: number[] = [];
  let hangTimer: NodeJS.Timeout | null = null;
  let killedForHang = false;
  const clearHang = (): void => { if (hangTimer) clearTimeout(hangTimer); hangTimer = null; };
  wc.on('render-process-gone', (_e, d) => {
    clearHang();
    if (win.isDestroyed() || d.reason === 'clean-exit') return;
    const hang = killedForHang;
    killedForHang = false;
    if (!hang) {
      recordRenderer('gone', d.reason);
      log.error('app', 'main window renderer gone, reloading it', { data: { reason: d.reason, exitCode: d.exitCode }, cause: `render-process-gone: ${d.reason} (exit ${d.exitCode})`, hint: 'chats and CLIs keep running in main; if it repeats, npm run logs -- --level warn --since 15m and look for a renderer error just before' });
    }
    const now = Date.now();
    if (!reloadAllowed(times, now)) {
      log.error('app', 'main window renderer keeps crashing, not reloading it', { cause: `${MAX_RELOADS} reloads in ${RELOAD_WINDOW_MS / 1000} s`, hint: 'restart the app; the last renderer error in the log is the likely cause' });
      return;
    }
    times.push(now);
    setTimeout(() => {
      if (win.isDestroyed()) return;
      recordRenderer('reload');
      reload().catch(e => log.error('app', 'main window reload failed', { cause: String(e), hint: 'restart the app' }));
    }, 300);
  });
  win.on('unresponsive', () => {
    if (hangTimer || win.isDestroyed()) return;
    log.warn('app', 'main window not responding', { data: { reloadInMs: opts.hangMs ?? HANG_RELOAD_MS } });
    hangTimer = setTimeout(() => {
      hangTimer = null;
      if (win.isDestroyed() || wc.isCrashed()) return;
      recordRenderer('hang', 'unresponsive');
      log.error('app', 'main window hung, reloading it', { cause: `unresponsive for ${(opts.hangMs ?? HANG_RELOAD_MS) / 1000} s`, hint: 'chats and CLIs keep running in main; a long render or a loop in the page; npm run logs -- --since 15m' });
      killedForHang = true;
      wc.forcefullyCrashRenderer();
    }, opts.hangMs ?? HANG_RELOAD_MS);
  });
  win.on('responsive', () => { if (hangTimer) log.info('app', 'main window responding again'); clearHang(); });
  win.on('closed', clearHang);
}
