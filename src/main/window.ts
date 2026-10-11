// The app window: sandboxed renderer from out/renderer, no navigation away, no new windows, no permissions.
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

export function createWindow(outDir: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640,
    title: 'second-brain', backgroundColor: '#0b0d12', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(outDir, 'preload', 'index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(outDir, 'renderer', 'index.html'));
  return win;
}
