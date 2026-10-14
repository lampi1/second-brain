// One chat as a tile: header (harness mark, title, state pill, ■ stop, ⋯ menu with model / effort / permissions /
// rename / focus / hand-off / "Riprendi" / close, ⤢ maximize, ✕ close: Ctrl+W too, with the usual undo), sub-line (model · effort · cost · folder · context
// size), the DevOps link chips (ChatLinkChips.tsx), the "Riprendi" links and the long-chat notice (ContextBar.tsx), the transcript, the inline
// question/permission/command panel (with "Domande in finestra" on, one line: the questions window shows it; while
// "Rispondi dopo" is on, one "Da rispondere" line: the chat waits, lib/later.ts), an error bar with one action, and the always-visible input (the menu is ChatMenu). Small tiles render compact
// (last line, "sta pensando…" while the turn runs, the open request). Selectors read only this chat, so other chats streaming never re-render it.
// A chat that drives browser tabs shares their accent color and hover (lib/pairs.ts). Used by Mosaico, Corsie and the
// focus view.
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatItem, PendingRequest } from '@shared/contract';
import { chatCost, queueReason, effortLabel, estimateText, estimateTip, folderName, minutes, permissionBadge, prettyModel, stateInfo, workTime } from '../lib/format';
import { useNow } from '../lib/clock';
import { COMPACT_TILE_H } from '../lib/grid';
import { isBusy, sameList } from '../store/state';
import { closeChat, send, stop, useApp } from '../store/store';
import { hideCtxNotice, setFocused, ui } from '../store/ui';
import { answerLater } from '../lib/later';
import { admitNow, toggleMaximize } from '../actions';
import { pairHover, usePair } from '../lib/pairs';
import { ChatLinkChips } from './ChatLinkChips';
import { ChatLinks, ContextMeter, ContextNotice, useWarnTokens } from './ContextBar';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { RequestPanel } from './RequestPanel';
import { InWindowLine } from './QuestionsWindow';
import { questionsModalOn } from '../lib/questions';
import { HarnessMark, IconAlert, IconMaximize, IconMinimize, IconMore, IconStop, IconX } from './Icons';
import { IconButton, StatePill, useSize } from './ui';

const EMPTY_ITEMS: readonly ChatItem[] = [];
// the ✕ (of a chat or a browser tile) is ignored for half a second after a close: the grid reflows and the next tile's
// ✕ lands under the pointer, so a double click would close two tiles
let lastXAt = 0;
export function closeFromX(close: () => void): void {
  if (Date.now() - lastXAt < 500) return;
  lastXAt = Date.now();
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

export const ChatTile = memo(function ChatTile({ chatId, index, maximized, focus }: { chatId: string; index?: number; maximized?: boolean; focus?: boolean }) {
  const chat = useApp(s => s.chats[chatId]);
  const items = useApp(s => s.items[chatId]);
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
  // the long-chat notice, hidden by the user until the context grows by another quarter of the threshold
  const ctxHiddenAt = ui.use(s => s.ctxHidden[chatId] ?? 0);
  const warn = useWarnTokens();
  const lqCpu = useApp(s => s.settings?.loadQueueCpu ?? 75);
  const lqRam = useApp(s => s.settings?.loadQueueRam ?? 15);
  const size = useSize(ref);
  const pair = usePair(chatId);
  const now = useNow(15_000); // the running work span grows on screen
  useEffect(() => {
    if (!focusReq) return;
    input.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusReq]);
  if (!chat) return null;
  const compact = !maximized && !focus && size.height > 0 && size.height < COMPACT_TILE_H;
  const smallPanel = !maximized && !focus && size.height > 0 && size.height < 440;
  const busy = isBusy(chat);
  const st = stateInfo(chat);
  const queueLimits = { cpu: lqCpu, ram: lqRam };
  const sub = [prettyModel(chat.model, chat.harness), effortLabel(chat.effort), chatCost(chat)].filter(Boolean).join(' · ');
  const folder = folderName(chat.cwd);
  const perm = permissionBadge(chat.permissionMode);
  const est = estimateText(chat.estimate);
  const work = workTime(chat, now);
  return (
    <section ref={ref} className={`tile chat-tile tone-${st.tone} ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${compact ? 'compact' : ''} ${closing ? 'closing' : ''} ${pair.cls}`} style={pair.style} role="region"
      aria-label={`Chat ${chat.title}, ${st.label}`} data-testid={`tile-chat-${chatId}`} data-chat-id={chatId} data-sb-id={`chat-${chatId}`} data-chat-index={index} data-state={chat.state}
      onFocus={() => setFocused(key)} onPointerDown={() => setFocused(key)} {...pairHover(chatId)} data-pair={pair.index ?? undefined}>
      <header className="tile-head">
        <div className="th-row">
          <HarnessMark harness={chat.harness} />
          {renaming ? (
            <TitleInput chat={chat} onDone={() => setRenaming(false)} />
          ) : (
            <h3 className="th-title" title={chat.title} onDoubleClick={() => setRenaming(true)}>{chat.title}</h3>
          )}
          <StatePill chat={chat} testid={`chat-state-${chatId}`} />
          {chat.resumedAt && (
            <span className="th-resumed" data-tip="Il suo turno si era interrotto con il riavvio dell'app: l'app l'ha fatta ripartire da sola. Sparisce al tuo prossimo messaggio."
              data-testid={`chat-resumed-${chatId}`}>ripresa dopo il riavvio</span>
          )}
          <span className="sp" />
          {(busy || chat.state === 'waiting') && (
            <IconButton label="Ferma" shortcut="Ctrl+." tone="danger" onClick={() => void stop(chatId)} testid={`chat-stop-${chatId}`}><IconStop size={14} /></IconButton>
          )}
          <IconButton ref={menuBtn} label="Modello, ragionamento e altro" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid={`chat-menu-${chatId}`}><IconMore /></IconButton>
          {/* the chats of "Migliora l'app" live in their section, which has no maximized view */}
          {chat.space !== 'app' && (
            <IconButton label={maximized ? 'Ripristina' : 'Ingrandisci'} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize(key)} testid={`chat-max-${chatId}`}>
              {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
            </IconButton>
          )}
          {!chat.isRegia && !chat.appRegia && <IconButton label="Chiudi chat" shortcut="Ctrl+W" onClick={() => closeFromX(() => closeChat(chatId))} testid={`chat-x-${chatId}`}><IconX size={14} /></IconButton>}
        </div>
        <div className="th-sub" data-testid={`chat-sub-${chatId}`}>
          <span className={`pill pill-${st.tone} pill-sub`} aria-hidden="true">{st.label}</span>
          <span className="th-sub-text">{sub}{work !== null && <>{' · '}<span className="th-work" data-testid={`chat-work-${chatId}`} data-tip="Tempo di lavoro effettivo: senza le attese delle tue risposte">lavoro {minutes(work)}</span></>}{folder ? ` · ${folder}` : ''}</span>
          {perm && <span className="th-badge">{perm}</span>}
          {est && <span className="th-est" data-testid={`chat-est-${chatId}`} data-tip={estimateTip(chat.estimate, `${chatCost(chat)}${work !== null ? ` in ${minutes(work)} di lavoro` : ''}`)}>{est}</span>}
          <ContextMeter chat={chat} warn={warn} />
        </div>
        {!compact && <ChatLinkChips chatId={chatId} items={items} />}
      </header>
      {!compact && <ChatLinks chat={chat} />}
      {!compact && (chat.handoffBusy || !ctxHiddenAt || (chat.contextTokens ?? 0) >= ctxHiddenAt + warn / 4) && (
        <ContextNotice chat={chat} warn={warn} onDismiss={() => hideCtxNotice(chatId, chat.contextTokens ?? 1)} />
      )}
      {compact ? (<>
        <div className="compact-body" data-testid={`chat-last-${chatId}`}>{chat.lastText || 'Nessun messaggio ancora.'}</div>
        {busy && <div className="compact-typing"><Typing what={turnActivity(items)} testid={`typing-${chatId}`} /></div>}
      </>) : items === undefined ? (
        <div className="items-wrap"><div className="items skeleton" aria-label="Caricamento"><i /><i /><i className="short" /></div></div>
      ) : (
        <ItemList chatId={chatId} items={items ?? EMPTY_ITEMS} empty="Nessun messaggio ancora: scrivi qui sotto da dove partire."
          footer={busy ? <Typing what={turnActivity(items)} testid={`typing-${chatId}`} /> : null} />
      )}
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
      <ChatInput ref={input} chat={chat} testid={`chat-input-${chatId}`} />
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} />
    </section>
  );
});
