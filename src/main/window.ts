// The app window: sandboxed renderer from out/renderer, no navigation away, no new windows, no permissions.
// SB_HIDDEN=1 (e2e tests, the dev instance run by agents): the window still renders and can be screenshotted, but it
// lives off every screen, out of the taskbar and never takes focus ("finchè testi mi apri l'app davanti").
import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppPage, setAppPage } from './ipc';

/** True when this instance must never appear in front of the user (SB_HIDDEN=1). */
export const hiddenRun = (env: NodeJS.ProcessEnv = process.env): boolean => env.SB_HIDDEN === '1';

export function createWindow(outDir: string): BrowserWindow {
  const hidden = hiddenRun();
  const win = new BrowserWindow({
    // right of every display, frameless (off every monitor Windows draws no frame: content size = window size)
    ...(hidden ? { x: Math.max(...screen.getAllDisplays().map(d => d.bounds.x + d.bounds.width)) + 400, y: 0, skipTaskbar: true, frame: false } : {}),
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640,
    title: 'second-brain', icon: path.join(outDir, 'icon.ico'), backgroundColor: '#0b0d12', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(outDir, 'preload', 'index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  const page = path.join(outDir, 'renderer', 'index.html');
  setAppPage(pathToFileURL(page).href);
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  // the window only ever shows our own page: any navigation elsewhere (even another file:// URL) is blocked
  wc.on('will-navigate', (e, url) => { if (!isAppPage(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!isAppPage(url)) e.preventDefault(); });
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // hidden: shown inactive off screen (a never-shown window stops painting and cannot be captured)
  // and its page gets the keyboard inside the app as a shown window would, without activating it on the desktop
  win.once('ready-to-show', () => { if (hidden) { win.showInactive(); wc.focus(); } else win.show(); });
  void win.loadFile(page);
  return win;
}
