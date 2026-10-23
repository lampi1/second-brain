// Opt-in close-to-tray for the local flow runner. Explicit quit always wins; hidden test runs never show a tray.
import { Menu, Tray, type BrowserWindow } from 'electron';
import { uiLang } from '../locale';
import { log } from '../log';
interface TrayHandle { setToolTip(text: string): void; setContextMenu(menu: Electron.Menu): void; on(event: string, fn: () => void): unknown; destroy(): void }
export interface FlowBackgroundOptions {
  window: BrowserWindow; icon: string; enabled(): boolean; quit(): void; hidden?: boolean;
  createTray?(icon: string): TrayHandle;
}
export function createFlowBackground(options: FlowBackgroundOptions) {
  let tray: TrayHandle | null = null, quitting = false, stopped = false;
  const show = () => {
    if (stopped || options.hidden || options.window.isDestroyed()) return;
    if (options.window.isMinimized()) options.window.restore();
    options.window.show(); options.window.focus();
  };
  const prepare = () => {
    if (stopped || options.hidden) throw new Error('Background mode unavailable in a hidden test run.');
    if (tray) return;
    const made = (options.createTray ?? (icon => new Tray(icon)))(options.icon);
    try {
      const labels = { it: ['Apri second-brain', 'Esci e ferma il servizio'], en: ['Open second-brain', 'Quit and stop the service'], de: ['second-brain öffnen', 'Beenden und Dienst stoppen'] }[uiLang()];
      made.setToolTip('second-brain · Flussi');
      made.setContextMenu(Menu.buildFromTemplate([
        { label: labels[0], click: show },
        { type: 'separator' },
        { label: labels[1], click: () => { quitting = true; options.quit(); } },
      ]));
      made.on('click', show); tray = made;
    } catch (error) { made.destroy(); throw error; }
  };
  const enabled = () => { try { return !stopped && !options.hidden && options.enabled(); } catch { return false; } };
  const sync = () => {
    if (enabled()) {
      try { prepare(); } catch (error) { log.warn('flows', 'Background tray unavailable', { cause: String(error), hint: 'Keep the app window open; closing it will quit.' }); }
    } else if (tray) {
      // Do not strand an invisible window when its brain or background preference changes.
      if (!options.window.isDestroyed() && !options.window.isVisible() && !options.hidden && !quitting) options.window.show();
      tray.destroy(); tray = null;
    }
  };
  const close = (event: { preventDefault(): void }) => {
    if (quitting || !enabled()) return;
    try { prepare(); event.preventDefault(); options.window.hide(); }
    catch (error) { log.warn('flows', 'Background close unavailable', { cause: String(error), hint: 'The app will quit normally.' }); }
  };
  const beforeQuit = () => { quitting = true; };
  options.window.on('close', close);
  options.window.on('query-session-end', beforeQuit);
  const stop = () => { stopped = true; quitting = true; tray?.destroy(); tray = null; options.window.removeListener('close', close); options.window.removeListener('query-session-end', beforeQuit); };
  return { prepare, sync, beforeQuit, stop, show };
}
