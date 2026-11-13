// A browser tab (ADR 0287). Embedded in its agent's window (ChatTile.tsx: beside the chat or alone) it is only the
// address bar: back/forward/reload, the address, what the agent is doing in the page right now, ✕ close (Ctrl+W too,
// also inside the page, with the same 6-second undo as a chat; its agent is told at its next call); the window's own
// head already says whose it is. A tab without a strip (the user's own, the Orchestrator's, one waiting for a login
// under a closed strip) is a tile of its own: the same bar plus ⤢ full screen (F11, FullScreen.tsx) and, when an
// agent drives it, the chip that jumps to that chat. Under the bar an empty placeholder whose screen rect is reported
// to main (lib/viewports.ts), where the real page (a native WebContentsView) is drawn on top; under the view the tab's
// last snapshot fills the placeholder, so overlays and screenshots show the page instead of a hole. An open hand-off
// (the chat waits for the user: login, MFA) shows its banner between the bar and the page (HandoffBanner.tsx).
import { t as auditText } from '../i18n';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { registerView } from '../lib/viewports';
import { closeTab, goTab, navigateTab, useApp } from '../store/store';
import { setFocused, ui } from '../store/ui';
import { focusChat, toggleMaximize } from '../actions';
import { closeFromX, useFlash } from './ChatTile';
import { HandoffBanner } from './HandoffBanner';
import { useHandoff } from '../store/handoffs';
import { FullTools } from './FullTools';
import { IconArrowLeft, IconArrowRight, IconMaximize, IconRefresh, IconSpinner, IconX } from './Icons';
import { IconButton, Kbd } from './ui';

function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    return { host: u.host || u.protocol, rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}` };
  } catch { return { host: url, rest: '' }; }
}

export const BrowserTile = memo(function BrowserTile({ tabId, maximized, embedded }: { tabId: string; maximized?: boolean; embedded?: boolean }) {
  const tab = useApp(s => s.tabs.find(t => t.id === tabId));
  const owner = useApp(s => (tab?.ownerChatId ? s.chats[tab.ownerChatId] : undefined));
  const key = `browser:${tabId}`;
  const isFocused = ui.use(s => s.focused === key);
  const flash = useFlash(key);
  const holder = useRef<HTMLDivElement>(null);
  const handoff = useHandoff(tabId);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => (holder.current ? registerView(tabId, holder.current) : undefined), [tabId, tab !== undefined]);
  if (!tab) return null;
  const { host, rest } = splitUrl(tab.url);
  return (
    <section className={`tile browser-tile ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${handoff ? 'has-handoff' : ''}${embedded ? ' is-embedded' : ''}${maximized ? ' is-full' : ''}`} role="region"
      aria-label={auditText('auditExpression.BrowserTile.text10', { v0: tab.title, v1: owner ? auditText('auditExpression.BrowserTile.text11', { v0: owner.title }) : '' })} data-testid={`tile-browser-${tabId}`} data-tab-id={tabId} data-sb-id={`tab-${tabId}`}
      onFocus={() => setFocused(key)} onPointerDown={() => setFocused(key)}>
      <header className="tile-head">
        <div className="th-row">
          {maximized && <button type="button" className="btn btn-ghost btn-s aw-back" onClick={() => toggleMaximize(key)} data-testid="focus-exit" aria-label={t('aw.fullExit')}><IconArrowLeft size={13} /><Kbd>Esc</Kbd></button>}
          <span className="bt-nav">
            <IconButton label={auditText('audit.BrowserTile.back')} onClick={() => void goTab(tabId, 'back')} testid={`browser-back-${tabId}`}><IconArrowLeft size={14} /></IconButton>
            <IconButton label={auditText('audit.BrowserTile.forward')} onClick={() => void goTab(tabId, 'forward')} testid={`browser-forward-${tabId}`}><IconArrowRight size={14} /></IconButton>
            <IconButton label={auditText('audit.BrowserTile.reload')} onClick={() => void goTab(tabId, 'reload')} testid={`browser-reload-${tabId}`}>{tab.loading ? <IconSpinner size={14} /> : <IconRefresh size={14} />}</IconButton>
          </span>
          {editing ? (
            <input className="url-input" defaultValue={tab.url==='about:blank'?'':tab.url} placeholder={t('ui.browserAddress')} autoFocus aria-label={t('ui.browserAddress')} data-testid={`browser-url-input-${tabId}`}
              onKeyDown={e => {
                if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) void navigateTab(tabId, /^[a-z]+:/i.test(v) ? v : `https://${v}`); setEditing(false); }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
              }}
              onBlur={() => setEditing(false)} />
          ) : (
            <button type="button" className="url" onClick={() => setEditing(true)} title={tab.url} data-testid={`browser-url-${tabId}`} aria-label={t('ui.browserEditAddress')}>
              <span className="url-host">{tab.url==='about:blank'?t('ui.browserAddress'):host}</span><span className="url-rest">{tab.url==='about:blank'?'':rest}</span>
            </button>
          )}
          {/* what the agent is doing in the page, next to the address */}
          {tab.lastAction && <span className="last-action" data-testid={`browser-action-${tabId}`} title={tab.lastAction}>{tab.lastAction}</span>}
          {!embedded && (owner ? (
            <button type="button" className="pair-chip" onClick={() => focusChat(owner.id)} data-testid={`browser-owner-${tabId}`}
              aria-label={auditText('auditExpression.BrowserTile.text14', { v0: owner.title })} data-tip={auditText('audit.BrowserTile.goToTheChatControllingThis')}><span className="pair-name">{owner.title}</span></button>
          ) : <span className="drv mine">{t('ui.browserMine')}</span>)}
          {maximized && <FullTools />}
          {!maximized && <IconButton className="browser-max" label={auditText('auditExpression.BrowserTile.text13')} shortcut="F11" onClick={() => toggleMaximize(key)} testid={`browser-max-${tabId}`}><IconMaximize size={14} /></IconButton>}
          <IconButton label={auditText('audit.BrowserTile.closeTab')} shortcut="Ctrl+W" onClick={e => closeFromX(e, () => closeTab(tabId))} testid={`browser-x-${tabId}`}><IconX size={14} /></IconButton>
        </div>
      </header>
      {handoff && <HandoffBanner h={handoff} chatTitle={owner?.title ?? null} />}
      <div className="viewport-wrap">
        <div className="viewport" ref={holder} data-testid={`browser-view-${tabId}`}>
          {tab.thumb ? <img src={tab.thumb} alt="" draggable={false} />
            : tab.loading ? <div className="viewport-loading"><IconSpinner size={16} />{' '}{auditText('audit.BrowserTile.loadingThePage')}</div>
            : <div className="viewport-info" data-testid={`browser-info-${tabId}`}><b>{tab.title || auditText('cmp.browserTile.page')}</b><span>{tab.url}</span></div>}
        </div>
      </div>
    </section>
  );
});
