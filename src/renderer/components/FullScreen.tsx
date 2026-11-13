// Full screen (ADR 0287; F11, Ctrl+Shift+F, the ⤢ of a strip or of a browser): ONE mode, in place of «Ingrandisci» and
// «Focus mode», which did almost the same thing under two names and neither covered the window (the maximized strip was
// «the window's height minus 190 px» inside the middle column: about 45% of a 1600 px window). The agent's window
// (ChatTile.tsx: its chat, its browser, or both side by side) or a browser tab without a strip covers the whole app
// window: top bar, navigation and the Orchestrator column are under it. Its head is the one bar left (back with Esc,
// who it is, what waits elsewhere, the Orchestrator: FullTools.tsx). The Orchestrator is never lost: Ctrl+R, a question
// opened with Ctrl+J or the bar's button shrinks the window and shows the column beside it, full height (shell.css
// .app.is-full); Esc closes the column first, then the full screen. Mounted by App.tsx in place of the page.
import { useEffect, useRef } from 'react';
import { setFullOrch, ui } from '../store/ui';
import { BrowserTile } from './BrowserTile';
import { ChatTile } from './ChatTile';

export function FullScreen({ chatId, tabId }: { chatId?: string | null; tabId?: string | null }) {
  // a question called from here (Ctrl+J, «N ti aspettano», «Ti aspetta») is a row of the Orchestrator: show the column
  const call = ui.use(s => s.qwin.call);
  const seen = useRef(call);
  useEffect(() => { if (call !== seen.current) { seen.current = call; setFullOrch(true); } }, [call]);
  return (
    <div className="full-layer" data-testid="maximized" data-key={chatId ? `chat:${chatId}` : `browser:${tabId}`}>
      {chatId ? <ChatTile chatId={chatId} focus /> : tabId ? <BrowserTile tabId={tabId} maximized /> : null}
    </div>
  );
}
