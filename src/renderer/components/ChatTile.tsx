// One chat as a tile: header (harness mark, title, state pill, ■ stop, ⋯ menu with model / effort / permissions /
// rename / focus / hand-off / "Riprendi" / close, ⤢ maximize, ✕ close: Ctrl+W too, with the usual undo), sub-line (model · effort · cost · folder · context
// size), the DevOps link chips (ChatLinkChips.tsx), the "Riprendi" links and the long-chat notice (ContextBar.tsx), the transcript, the inline
// question/permission/command panel (with "Domande in finestra" on, one line: the questions window shows it; while
// "Rispondi dopo" is on, one "Da rispondere" line: the chat waits, lib/later.ts), an error bar with one action, and the always-visible input (the menu is ChatMenu). Small tiles render compact
// (last line, "sta pensando…" while the turn runs, the open request). Selectors read only this chat, so other chats streaming never re-render it.
// A chat that drives browser tabs shares their accent color and hover (lib/pairs.ts). Used by Mosaico, Corsie and the
// focus view.
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PendingRequest } from '@shared/contract';
import { chatCost, queueReason, folderName, minutes, permissionBadge, prettyModel, stateInfo, workTime } from '../lib/format';
import { useNow } from '../lib/clock';
import { COMPACT_TILE_H } from '../lib/grid';
import { isBusy, sameList } from '../store/state';
import { closeChat, send, stop, useApp } from '../store/store';
import { setFocused, setChatExpanded,ui } from '../store/ui';
import {t}from'../i18n';
import {schedule,suspendViews}from'../lib/viewports';
import { answerLater } from '../lib/later';
import { admitNow, toggleMaximize } from '../actions';
import { pairHover, usePair } from '../lib/pairs';
import { ChatLinkChips } from './ChatLinkChips';
import { EffortControl } from './EffortControl';
import { AgentIdentity } from './AgentIdentity';
import { AgentAvatar } from './AgentAvatar';
import { AutoCloseNotice } from './AutoCloseNotice';
import { ChatLinks, ContextMeter, ContextNotice, useWarnTokens } from './ContextBar';
import { turnActivity, Typing } from './ChatItems';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { RequestPanel } from './RequestPanel';
import { InWindowLine } from './QuestionsWindow';
import { questionsModalOn } from '../lib/questions';
import { IconAlert, IconMaximize, IconMinimize, IconMore, IconStop, IconX } from './Icons';
import { IconButton, StatePill, useSize } from './ui';

// the ✕ (of a chat or a browser tile) ignores the later clicks of a double click (detail > 1): the grid reflows and the
// next tile's ✕ lands under the pointer, so a double click would close two tiles. Not a time window: one swallowed a
// deliberate ✕ right after a close and Annulla (close-fast.spec)
export function closeFromX(e: { detail: number }, close: () => void): void {
  if (e.detail > 1) return;
  close();
}
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

export const ChatTile = memo(function ChatTile({ chatId, index, maximized, focus, grip }: { chatId: string; index?: number; maximized?: boolean; focus?: boolean; grip?: ReactNode }) {
  const chat = useApp(s => s.chats[chatId]);
  const activity = useApp(s => turnActivity(s.items[chatId]));
  const reqs = useApp(s => pendingOf(s.pending, chatId), sameList);
  const inWindow = useApp(questionsModalOn);
  const queued = ui.use(s => s.later);
  const key = `chat:${chatId}`;
  const isFocused = ui.use(s => s.focused === key);
  const closing = ui.use(s => s.closing.includes(chatId));
  const focusReq = ui.use(s => (s.focusReq?.chatId === chatId ? s.focusReq.n : 0));
  const flash = useFlash(key);
  const ref = useRef<HTMLElement>(null);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const expandedChoice=ui.use(s=>s.prefs.chatPanelsV===0||s.prefs.chatExpanded[chatId]===true);
  const expanded=!!maximized||!!focus||expandedChoice;
  const expansionButton=useRef<HTMLButtonElement>(null);
  const reveal=(compose=false)=>{setChatExpanded(chatId,true);if(compose)requestAnimationFrame(()=>input.current?.focus());};
  useEffect(()=>{const release=suspendViews();schedule();const timer=setTimeout(()=>{release();schedule();},window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);return()=>{clearTimeout(timer);release();};},[expanded]);
  // the long-chat notice, hidden by the user until the context grows by another quarter of the threshold
  const warn = useWarnTokens();
  const lqCpu = useApp(s => s.settings?.loadQueueCpu ?? 75);
  const lqRam = useApp(s => s.settings?.loadQueueRam ?? 15);
  const size = useSize(ref);
  const pair = usePair(chatId);
  const now = useNow(15_000); // the running work span grows on screen
  useEffect(() => {
    if (!focusReq) return;
    reveal(true);
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusReq]);
  if (!chat) return null;
  const compact = !expanded || !maximized && !focus && size.height > 0 && size.height < COMPACT_TILE_H;
  const smallPanel = !maximized && !focus && size.height > 0 && size.height < 440;
  const busy = isBusy(chat);
  const st = stateInfo(chat);
  const queueLimits = { cpu: lqCpu, ram: lqRam };
  const sub = [prettyModel(chat.model, chat.harness), chatCost(chat)].filter(Boolean).join(' · ');
  const folder = folderName(chat.cwd);
  const perm = permissionBadge(chat.permissionMode);
  const work = workTime(chat, now);
  return (
    <section ref={ref} className={`tile chat-tile ${expanded?'is-expanded':'is-strip'} tone-${st.tone} ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${compact ? 'compact' : ''} ${closing ? 'closing' : ''} ${pair.cls}`} style={pair.style} role="region"
      aria-label={`Chat ${chat.title}, ${st.label}`} data-testid={`tile-chat-${chatId}`} data-chat-id={chatId} data-sb-id={`chat-${chatId}`} data-chat-index={index} data-state={chat.state}
      onFocus={() => setFocused(key)} onPointerDown={() => setFocused(key)} {...pairHover(chatId)} data-pair={pair.index ?? undefined}>
      <header className="tile-head">
        <div className="th-row">
          {grip}
          <AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name||chat.title} size={24}/>
          <h3 className="th-title" title={chat.agent?.purpose||chat.title}>{chat.agent?.name||chat.title}</h3>
          <StatePill chat={chat} testid={`chat-state-${chatId}`} />
          <EffortControl chat={chat} />
          {chat.resumedAt && (
            <span className="th-resumed" data-tip="Il suo turno si era interrotto con il riavvio dell'app: l'app l'ha fatta ripartire da sola. Sparisce al tuo prossimo messaggio."
              data-testid={`chat-resumed-${chatId}`}>ripresa dopo il riavvio</span>
          )}
          <div className="chat-header-actions">
          {!focus&&!maximized&&<button ref={expansionButton} type="button" className="btn btn-ghost btn-s chat-expand" aria-expanded={expanded} aria-controls={`chat-work-${chatId}`} onClick={()=>{setChatExpanded(chatId,!expanded);if(expanded)expansionButton.current?.focus();}} data-testid={`chat-expand-${chatId}`}>{t(expanded?'product.collapse':'product.expand')}</button>}
          {(busy || chat.state === 'waiting') && (
            <IconButton label="Ferma" shortcut="Ctrl+." tone="danger" onClick={() => void stop(chatId)} testid={`chat-stop-${chatId}`}><IconStop size={14} /></IconButton>
          )}
          <IconButton ref={menuBtn} label="Rinomina, modello, permessi e altro" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid={`chat-menu-${chatId}`}><IconMore /></IconButton>
          {/* the chats of "Migliora l'app" live in their section, which has no maximized view */}
          {chat.space !== 'app' && (
            <IconButton label={maximized ? 'Ripristina' : 'Ingrandisci'} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize(key)} testid={`chat-max-${chatId}`}>
              {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
            </IconButton>
          )}
          {!chat.isRegia && !chat.appRegia && <IconButton label="Chiudi chat" shortcut="Ctrl+W" onClick={e => closeFromX(e, () => closeChat(chatId))} testid={`chat-x-${chatId}`}><IconX size={14} /></IconButton>}
          </div>
        </div>
        <div className="chat-topic-row">{renaming?<TitleInput chat={chat} onDone={()=>setRenaming(false)}/>:chat.agent?.name&&chat.title!==chat.agent.name?<span className="chat-topic" title={chat.title} onDoubleClick={()=>setRenaming(true)}>{chat.title}</span>:null}<AgentIdentity chat={chat}/></div>
        <details className="chat-session-detail" data-testid={`chat-sub-${chatId}`}><summary>{t('product.model')}</summary><div className="th-sub">
          <span className={`pill pill-${st.tone} pill-sub`} aria-hidden="true">{st.label}</span>
          <span className="th-sub-text">{sub}{work !== null && <>{' · '}<span className="th-work" data-testid={`chat-work-${chatId}`} data-tip="Tempo di lavoro effettivo: senza le attese delle tue risposte">lavoro {minutes(work)}</span></>}{folder ? ` · ${folder}` : ''}</span>
          {perm && <span className="th-badge">{perm}</span>}
          <ContextMeter chat={chat} warn={warn} />
        </div></details>
        {!compact && <ChatLinkChips chatId={chatId} />}
      </header>
      <AutoCloseNotice chatId={chatId} />
      {!expanded&&<div className="chat-strip-line">{busy?<Typing what={activity} testid={`typing-${chatId}`}/>:chat.work?.status==='waiting-mail'?t('product.workWaiting'):chat.lastText.slice(0,140)}<button type="button" className="link-btn" onClick={()=>reveal(true)}>{t('product.write')}</button></div>}
      <div className={`chat-work${expanded?' expanded':''}`} id={`chat-work-${chatId}`} inert={!expanded} aria-hidden={!expanded}><div className="chat-work-inner">
      {!compact && <ChatLinks chat={chat} />}
      {!compact && chat.handoffBusy && <ContextNotice chat={chat} />}
      <ChatTranscript key={chatId} chatId={chatId} busy={busy} expanded={expanded} />
      <ChatInput ref={input} chat={chat} testid={`chat-input-${chatId}`} />
      </div></div>
      {reqs.length > 0 && (queued ? <InWindowLine reqs={reqs} queued testid={`chat-queued-${chatId}`} /> : inWindow ? <InWindowLine reqs={reqs} testid={`chat-in-window-${chatId}`} /> : (
        <div className="tile-requests">
          {reqs.map(r => <RequestPanel key={r.id} req={r} variant={compact || smallPanel ? 'compact' : 'tile'} chatTitle={chat.title} harness={chat.harness} onLater={answerLater} />)}
        </div>
      ))}
      {chat.queued && !chat.closedAt && (
        <div className="queued-bar" data-testid={`chat-queued-${chatId}`}>
          <span className="queued-text" data-tip={`Il PC è sotto sforzo (CPU ${chat.queued.cpu}%, RAM libera ${chat.queued.freeRam}%): ${chat.queued.kind === 'start' ? 'questa chat parte' : 'il messaggio della Regia o di un’altra chat parte'} quando il carico scende, una alla volta: prima le chat di lavoro, poi quelle sull’app. I tuoi messaggi partono sempre subito.`}>
            In coda · {queueReason(chat.queued, queueLimits)} · {chat.queued.position === 1 ? 'la prossima' : `${chat.queued.position}ª in fila`}
          </span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => void admitNow(chatId)} data-testid={`chat-admit-${chatId}`}>Avvia ora</button>
        </div>
      )}
      {chat.state === 'error' && (
        <div className="error-bar" role="alert">
          <IconAlert size={14} /><span>{chat.lastError || 'La chat si è fermata con un errore.'}</span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => send(chatId, 'Riprova da dove eri rimasto.')} data-testid={`chat-retry-${chatId}`}>Riprova</button>
        </div>
      )}
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} />
    </section>
  );
});
