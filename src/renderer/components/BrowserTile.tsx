// A browser tab as a tile: header (address, back/forward/reload, ⤢), sub-line ("di: <chat>" chip in the pair color →
// jumps to that chat, and the agent's last action; the tile shares the chat's accent and hover, lib/pairs.ts), and an empty placeholder whose screen rect is reported to main
// (lib/viewports.ts), where the real page (a native WebContentsView) is drawn on top. Under the view, the tab's last
// snapshot fills the placeholder, so overlays and screenshots show the page instead of a hole. An open hand-off (the
// chat waits for the user: login, MFA) shows its banner between the header and the page (HandoffBanner.tsx).
// Used by Mosaico, Corsie (the big browser next to its chat) and the focus view.
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { registerView } from '../lib/viewports';
import { goTab, navigateTab, useApp } from '../store/store';
import { setFocused, ui } from '../store/ui';
import { focusChat, toggleMaximize } from '../actions';
import { useFlash } from './ChatTile';
import { HandoffBanner } from './HandoffBanner';
import { useHandoff } from '../store/handoffs';
import { pairHover, usePair } from '../lib/pairs';
import { IconArrowLeft, IconArrowRight, IconGlobe, IconMaximize, IconMinimize, IconRefresh, IconSpinner } from './Icons';
import { IconButton } from './ui';

function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    return { host: u.host || u.protocol, rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}` };
  } catch { return { host: url, rest: '' }; }
}

export const BrowserTile = memo(function BrowserTile({ tabId, maximized }: { tabId: string; maximized?: boolean }) {
  const tab = useApp(s => s.tabs.find(t => t.id === tabId));
  const owner = useApp(s => (tab?.ownerChatId ? s.chats[tab.ownerChatId] : undefined));
  const key = `browser:${tabId}`;
  const isFocused = ui.use(s => s.focused === key);
  const flash = useFlash(key);
  const holder = useRef<HTMLDivElement>(null);
  const handoff = useHandoff(tabId);
  const pair = usePair(tab?.ownerChatId);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => (holder.current ? registerView(tabId, holder.current) : undefined), [tabId, tab !== undefined]);
  if (!tab) return null;
  const { host, rest } = splitUrl(tab.url);
  return (
    <section className={`tile browser-tile ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${handoff ? 'has-handoff' : ''} ${pair.cls}`} style={pair.style} role="region"
      aria-label={`Browser: ${tab.title}${owner ? `, guidato da ${owner.title}` : ''}`} data-testid={`tile-browser-${tabId}`} data-tab-id={tabId} data-sb-id={`tab-${tabId}`}
      onFocus={() => setFocused(key)} onPointerDown={() => setFocused(key)} {...pairHover(tab.ownerChatId)} data-pair={pair.index ?? undefined}>
      <header className="tile-head">
        <div className="th-row">
          <span className="bt-icon" aria-hidden="true">{tab.loading ? <IconSpinner size={14} /> : <IconGlobe size={14} />}</span>
          {editing ? (
            <input className="url-input" defaultValue={tab.url} autoFocus aria-label="Indirizzo" data-testid={`browser-url-input-${tabId}`}
              onKeyDown={e => {
                if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) void navigateTab(tabId, /^[a-z]+:/i.test(v) ? v : `https://${v}`); setEditing(false); }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
              }}
              onBlur={() => setEditing(false)} />
          ) : (
            <button type="button" className="url" onClick={() => setEditing(true)} title={tab.url} data-testid={`browser-url-${tabId}`} aria-label={`Indirizzo ${tab.url}, modifica`}>
              <span className="url-host">{host}</span><span className="url-rest">{rest}</span>
            </button>
          )}
          <span className="bt-nav">
            <IconButton label="Indietro" onClick={() => void goTab(tabId, 'back')} testid={`browser-back-${tabId}`}><IconArrowLeft size={14} /></IconButton>
            <IconButton label="Avanti" onClick={() => void goTab(tabId, 'forward')} testid={`browser-forward-${tabId}`}><IconArrowRight size={14} /></IconButton>
            <IconButton label="Ricarica" onClick={() => void goTab(tabId, 'reload')} testid={`browser-reload-${tabId}`}><IconRefresh size={14} /></IconButton>
          </span>
          <IconButton label={maximized ? 'Ripristina' : 'Ingrandisci'} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize(key)} testid={`browser-max-${tabId}`}>
            {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </IconButton>
        </div>
        <div className="th-sub">
          {owner ? (
            <span className="drv"><span className="drv-of">di:</span><button type="button" className="pair-chip" onClick={() => focusChat(owner.id)} data-testid={`browser-owner-${tabId}`}
              aria-label={`Browser della chat ${owner.title}: vai alla chat`} data-tip="Vai alla chat che guida questo browser"><span className="pair-dot" aria-hidden="true" /><span className="pair-name">{owner.title}</span></button></span>
          ) : <span className="drv mine">la tua scheda</span>}
          {tab.lastAction && <span className="last-action" data-testid={`browser-action-${tabId}`}>{tab.lastAction}</span>}
        </div>
      </header>
      {handoff && <HandoffBanner h={handoff} chatTitle={owner?.title ?? null} />}
      <div className="viewport-wrap">
        <div className="viewport" ref={holder} data-testid={`browser-view-${tabId}`}>
          {tab.thumb ? <img src={tab.thumb} alt="" draggable={false} />
            : tab.loading ? <div className="viewport-loading"><IconSpinner size={16} /> Carico la pagina…</div>
            : <div className="viewport-info" data-testid={`browser-info-${tabId}`}><b>{tab.title || 'Pagina'}</b><span>{tab.url}</span></div>}
        </div>
      </div>
    </section>
  );
});
