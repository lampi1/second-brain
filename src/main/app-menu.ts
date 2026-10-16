// The native application menu on macOS (ADR 0054): without one, Cmd+C/Cmd+V/Cmd+A do nothing in text fields and
// Cmd+Q does not quit, because on macOS those shortcuts live in the menu bar. Only Electron's standard roles (app,
// edit, window): the app's own commands stay in its top bar. Windows and Linux keep no menu bar (autoHideMenuBar in
// window.ts), as before. Used by index.ts once the app is ready.
import { Menu, type MenuItemConstructorOptions } from 'electron';

/** The menu template per OS: null where the app shows no native menu. Pure, for the unit test. */
export function appMenuTemplate(platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null;
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}

export function installAppMenu(): void {
  const t = appMenuTemplate();
  if (t) Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}
