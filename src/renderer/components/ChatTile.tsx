// One chat as a tile: header (harness mark, title, state pill, ■ stop, ⋯ menu with model / effort / permissions /
// rename / focus / close, ⤢ maximize), sub-line (model · effort · cost · folder), the transcript, the inline
// question/permission panel, an error bar with one action, and the always-visible input. Small tiles render compact
// (last line + the open request). Selectors read only this chat, so other chats streaming never re-render it.
// Used by Mosaico, Corsie and the focus view.
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatItem, PendingRequest } from '@shared/contract';
import { chatCost, EFFORTS, effortLabel, folderName, formatCost, permissionBadge, permissionLabel, PERMISSION_MODES, prettyModel, stateInfo } from '../lib/format';
import { MODELS } from '../lib/models';
import { isBusy, sameList } from '../store/state';
import { closeChat, send, setChat, stop, useApp } from '../store/store';
import { setFocused, ui } from '../store/ui';
import { copyLink, toggleFocusMode, toggleMaximize } from '../actions';
import { makeLink } from '../lib/notify';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { RequestPanel } from './RequestPanel';
import { HarnessMark, IconAlert, IconMaximize, IconMinimize, IconMore, IconStop } from './Icons';
import { IconButton, MenuItem, MenuLabel, MenuSep, Popover, StatePill, useSize } from './ui';

const EMPTY_ITEMS: readonly ChatItem[] = [];
const EMPTY_REQS: readonly PendingRequest[] = [];
export const pendingOf = (list: readonly PendingRequest[], chatId: string) => {
  const r = list.filter(p => p.chatId === chatId);
  return r.length ? r : EMPTY_REQS;
};

/** Flash a tile briefly when Ctrl+J / the palette brings it on screen. */
export function useFlash(key: string): boolean {
  const n = ui.use(s => (s.flash?.key === key ? s.flash.n : 0));
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!n) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 900);
    return () => clearTimeout(t);
  }, [n]);
  return on;
}

export const ChatTile = memo(function ChatTile({ chatId, index, maximized, focus }: { chatId: string; index?: number; maximized?: boolean; focus?: boolean }) {
  const chat = useApp(s => s.chats[chatId]);
  const items = useApp(s => s.items[chatId]);
  const reqs = useApp(s => pendingOf(s.pending, chatId), sameList);
  const key = `chat:${chatId}`;
  const isFocused = ui.use(s => s.focused === key);
  const focusReq = ui.use(s => (s.focusReq?.chatId === chatId ? s.focusReq.n : 0));
  const flash = useFlash(key);
  const ref = useRef<HTMLElement>(null);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const size = useSize(ref);
  useEffect(() => {
    if (!focusReq) return;
    input.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusReq]);
  if (!chat) return null;
  const compact = !maximized && !focus && size.height > 0 && size.height < 250;
  const smallPanel = !maximized && !focus && size.height > 0 && size.height < 440;
  const busy = isBusy(chat);
  const st = stateInfo(chat);
  const sub = [prettyModel(chat.model, chat.harness), effortLabel(chat.effort), chatCost(chat), folderName(chat.cwd)].filter(Boolean).join(' · ');
  const perm = permissionBadge(chat.permissionMode);
  const ctxPct = chat.contextTokens && chat.contextMaxTokens ? Math.min(100, Math.round((chat.contextTokens / chat.contextMaxTokens) * 100)) : null;
  const est = chat.estimate === null ? 'stima senza dati' : chat.estimate ? `stima ${formatCost(chat.estimate.usdLow).replace(' $', '')}–${formatCost(chat.estimate.usdHigh)}` : null;
  return (
    <section ref={ref} className={`tile chat-tile tone-${st.tone} ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${compact ? 'compact' : ''}`} role="region"
      aria-label={`Chat ${chat.title}, ${st.label}`} data-testid={`tile-chat-${chatId}`} data-chat-id={chatId} data-sb-id={`chat-${chatId}`} data-chat-index={index} data-state={chat.state}
      onFocus={() => setFocused(key)} onPointerDown={() => setFocused(key)}>
      <header className="tile-head">
        <div className="th-row">
          <HarnessMark harness={chat.harness} />
          {renaming ? (
            <input className="th-title-input" defaultValue={chat.title} autoFocus aria-label="Nome della chat" data-testid={`chat-title-input-${chatId}`}
              onKeyDown={e => {
                if (e.key === 'Enter') { const t = e.currentTarget.value.trim(); if (t && t !== chat.title) void setChat(chatId, { title: t }); setRenaming(false); }
                if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); }
              }}
              onBlur={e => { const t = e.currentTarget.value.trim(); if (t && t !== chat.title) void setChat(chatId, { title: t }); setRenaming(false); }} />
          ) : (
            <h3 className="th-title" title={chat.title} onDoubleClick={() => setRenaming(true)}>{chat.title}</h3>
          )}
          <StatePill chat={chat} testid={`chat-state-${chatId}`} />
          <span className="sp" />
          {(busy || chat.state === 'waiting') && (
            <IconButton label="Ferma" shortcut="Ctrl+." tone="danger" onClick={() => void stop(chatId)} testid={`chat-stop-${chatId}`}><IconStop size={14} /></IconButton>
          )}
          <IconButton ref={menuBtn} label="Modello, ragionamento e altro" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid={`chat-menu-${chatId}`}><IconMore /></IconButton>
          <IconButton label={maximized ? 'Ripristina' : 'Ingrandisci'} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize(key)} testid={`chat-max-${chatId}`}>
            {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </IconButton>
        </div>
        <div className="th-sub" data-testid={`chat-sub-${chatId}`}>
          <span className={`pill pill-${st.tone} pill-sub`} aria-hidden="true">{st.label}</span>
          <span className="th-sub-text">{sub}</span>
          {perm && <span className="th-badge">{perm}</span>}
          {est && <span className="th-est" data-tip={chat.estimate ? `Stima da ${chat.estimate.basis} lavori simili; finora ${chatCost(chat)}` : 'Meno di 5 lavori simili: niente stima'}>{est}</span>}
          {ctxPct !== null && <span className={`th-ctx ${ctxPct >= 80 ? 'hot' : ''}`} data-tip={`Contesto usato: ${ctxPct}%`} aria-label={`Contesto ${ctxPct}%`}><b style={{ width: `${ctxPct}%` }} /></span>}
        </div>
      </header>
      {compact ? (
        <div className="compact-body" data-testid={`chat-last-${chatId}`}>{chat.lastText || 'Nessun messaggio ancora.'}</div>
      ) : items === undefined ? (
        <div className="items-wrap"><div className="items skeleton" aria-label="Caricamento"><i /><i /><i className="short" /></div></div>
      ) : (
        <ItemList items={items ?? EMPTY_ITEMS} empty="Nessun messaggio ancora: scrivi qui sotto da dove partire."
          footer={busy ? <Typing what={turnActivity(items)} testid={`typing-${chatId}`} /> : null} />
      )}
      {reqs.length > 0 && (
        <div className="tile-requests">
          {reqs.map(r => <RequestPanel key={r.id} req={r} variant={compact || smallPanel ? 'compact' : 'tile'} chatTitle={chat.title} harness={chat.harness} />)}
        </div>
      )}
      {chat.state === 'error' && (
        <div className="error-bar" role="alert">
          <IconAlert size={14} /><span>{chat.lastError || 'La chat si è fermata con un errore.'}</span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => send(chatId, 'Riprova da dove eri rimasto.')} data-testid={`chat-retry-${chatId}`}>Riprova</button>
        </div>
      )}
      <ChatInput ref={input} chat={chat} testid={`chat-input-${chatId}`} />
      <Popover anchor={menuBtn} open={menu} onClose={() => setMenu(false)} testid={`chat-menu-pop-${chatId}`} width={260}>
        <MenuLabel>Modello</MenuLabel>
        {MODELS[chat.harness].map(m => (
          <MenuItem key={m.id || 'default'} checked={(chat.model ?? '') === m.id} onSelect={() => { void setChat(chatId, { model: m.id }); setMenu(false); }} testid={`chat-model-${chatId}-${m.id || 'default'}`}>{m.label}</MenuItem>
        ))}
        {chat.harness === 'claude' && (
          <>
            <MenuSep />
            <MenuLabel>Ragionamento</MenuLabel>
            {EFFORTS.map(e => (
              <MenuItem key={e} checked={chat.effort === e} onSelect={() => { void setChat(chatId, { effort: e }); setMenu(false); }} testid={`chat-effort-${chatId}-${e}`}>{effortLabel(e)}</MenuItem>
            ))}
            <MenuSep />
            <MenuLabel>Permessi</MenuLabel>
            {PERMISSION_MODES.map(p => (
              <MenuItem key={p} checked={(chat.permissionMode ?? 'default') === p} danger={p === 'bypassPermissions'} onSelect={() => { void setChat(chatId, { permissionMode: p }); setMenu(false); }} testid={`chat-perm-${chatId}-${p}`}>{permissionLabel(p)}</MenuItem>
            ))}
          </>
        )}
        <MenuSep />
        <MenuItem onSelect={() => { setMenu(false); setRenaming(true); }} testid={`chat-rename-${chatId}`}>Rinomina…</MenuItem>
        <MenuItem onSelect={() => { setMenu(false); void copyLink(makeLink('workspace', `chat-${chatId}`)); }} testid={`chat-link-${chatId}`}>Copia link</MenuItem>
        <MenuItem onSelect={() => { setMenu(false); setFocused(key); toggleFocusMode(); }} shortcut="Ctrl+Shift+F" testid={`chat-focusmode-${chatId}`}>Modalità focus</MenuItem>
        <MenuItem onSelect={() => { setMenu(false); closeChat(chatId); }} danger testid={`chat-close-${chatId}`}>Chiudi chat</MenuItem>
      </Popover>
    </section>
  );
});
