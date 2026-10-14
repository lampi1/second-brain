// Ctrl+W guard for the app's secondary web contents (browser tabs, the requests layer, demo browser views). The app sets
// no menu, so Electron's default one is live: its "Close" (Ctrl+W) closes the main window, which quits the app with every
// chat. The main window's renderer takes Ctrl+W itself (it closes the selected chat, renderer lib/keys.ts); any other
// view in the window would pass an unhandled Ctrl+W up to the menu, so it swallows it here. Matches the character, not
// the key position (AZERTY), like the menu. Used by browser/tabs.ts, overlay.ts, demo-browser.ts and window.ts (DevTools).
import type { Input, WebContents } from 'electron';

export const isCloseKey = (i: Pick<Input, 'type' | 'control' | 'meta' | 'alt' | 'key'>): boolean =>
  i.type === 'keyDown' && (i.control || i.meta) && !i.alt && i.key.toLowerCase() === 'w';

export function swallowCloseKey(wc: WebContents): void {
  wc.on('before-input-event', (e, input) => { if (isCloseKey(input)) e.preventDefault(); });
}
