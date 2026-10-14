// Start-menu and desktop shortcuts of the STABLE app (ADR 0007), written by the app itself on start: they run the
// hidden launcher (launch.vbs → launch.cmd → release.mjs launch, with fallback to the previous release) and carry the
// AppUserModelId 'second-brain', which Windows needs to show the app's toast notifications. Only for a stable release
// (SB_RELEASE set by the launcher, release.ts); a dev build never writes shortcuts, even one started from a chat of the
// stable app. Used by index.ts.
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log';
import { releaseId } from './release';

export const APP_ID = 'second-brain';

export function ensureShortcuts(): void {
  if (process.platform !== 'win32' || !releaseId()) return;
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'second-brain');
  const vbs = path.join(base, 'launch.vbs');
  if (!fs.existsSync(vbs)) { log.warn('shortcuts', 'launch.vbs missing: shortcuts not written', { data: { vbs } }); return; }
  const opts: Electron.ShortcutDetails = {
    target: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe'),
    args: `"${vbs}"`,
    cwd: base,
    description: 'second-brain: la cabina di comando di Claude e Cursor',
    // the app's own icon (scripts/make-icon.cjs → out/icon.ico), not Electron's
    icon: fs.existsSync(path.join(app.getAppPath(), 'out', 'icon.ico')) ? path.join(app.getAppPath(), 'out', 'icon.ico') : process.execPath, iconIndex: 0,
    appUserModelId: APP_ID,
  };
  for (const dir of [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')]) {
    const lnk = path.join(dir, 'second-brain.lnk');
    try {
      const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
      if (!ok) log.warn('shortcuts', 'shortcut not written', { data: { lnk } });
    } catch (e) { log.warn('shortcuts', 'shortcut failed', { data: { lnk, error: String(e) } }); }
  }
}
