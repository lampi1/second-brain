// A Regia: one of the user's always-on coordinating chats, shown in the floating overlay (RegiaOverlay.tsx, one tab
// per Regia; ADR 0021), violet, with its own name. Its input has
// the default focus; its own open questions show as a "decisione" card (a work chat's never show here: the Regia is
// for the state and for moving between chats, the user 2026-10-13), one card at a time, the oldest, the others named
// on a "Poi:" line (the widget is a popup and at most one request popup is on screen; none while the questions window
// or the layer's card is the one); Esc or "Rispondi dopo" turns "Rispondi dopo" on (lib/later.ts): the card goes
// unanswered, a "Da rispondere" line stays; its own messages' shell blocks have
// "Esegui" too (the run and "Manda l'esito alla chat" belong to the Regia); below, a digest of the live brain feed ("Novità",
// with "mentre eri via" first; collapsible, remembered). Its ⋯ menu is the chat menu (ChatMenu) plus "Ricomincia da
// capo", "Cambia motore" (both open the Nuova Regia confirm) and "Pulisci". With no Regia yet it offers to create
// one. When it drives a browser, it wears that pair's accent like any chat (lib/pairs.ts). Used by RegiaOverlay.tsx.
import { memo, useEffect, useRef, useState } from 'react';
import type { FeedEvent } from '@shared/contract';
import { ago, chatCost, effortLabel, prettyModel } from '../lib/format';
import { useNow } from '../lib/clock';
import { engineName } from '../lib/engines';
import { isBusy, sameList } from '../store/state';
import { stop, useApp } from '../store/store';
import { openModal, setFocused, setPrefs, ui } from '../store/ui';
import { t } from '../i18n';
import { answerLater } from '../lib/later';
import { linkOfEvent } from '../lib/notify';
import { pairHover, usePair } from '../lib/pairs';
import { awaitingCard, openLink, reqKey } from '../actions';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { pendingOf, useFlash } from './ChatTile';
import { RequestPanel } from './RequestPanel';
import { InWindowLine } from './QuestionsWindow';
import { questionsModalOn } from '../lib/questions';
import { HarnessMark, IconChevronDown, IconList, IconMore, IconPlus, IconStop } from './Icons';
import { IconButton, StatePill } from './ui';

const TONE: Record<string, string> = {
  idea: 'blue', error: 'red', win: 'green', 'chat-done': 'green', 'chat-waiting': 'amber', reflection: 'violet', journal: 'dim',
};

function FeedRow({ e, now }: { e: FeedEvent; now: number }) {
  const open = () => { openLink(linkOfEvent(e)); };
  return (
    <li>
      <button type="button" className={`feed-row tone-${TONE[e.kind] ?? 'dim'} ${e.priority}`} onClick={open} data-testid={`feed-${e.id}`} data-sb-id={`feed-${e.id}`} title={e.detail}>
        <span className="feed-k">{e.label}</span>
        <span className="feed-t">{e.title}</span>
        <span className="feed-age">{ago(e.at, now)}</span>
      </button>
    </li>
  );
}

const EMPTY: readonly FeedEvent[] = [];

/** chatId = the Regia shown (the overlay's tab); null = none yet */
export const RegiaTile = memo(function RegiaTile({ chatId: id }: { chatId: string | null }) {
  const chat = useApp(s => (id ? s.chats[id] : undefined));
  const items = useApp(s => (id ? s.items[id] : undefined));
  const reqs = useApp(s => (id ? pendingOf(s.pending, id) : []), sameList);
  const inWindow = useApp(questionsModalOn);
  // one card at a time (the oldest, or the one Ctrl+J asked for); the rest named below it
  const wanted = ui.use(s => s.regiaFirst);
  // the user is answering in the global layer or the questions window (the queue): that is the one popup, the
  // Regia's card waits (named on "Poi:")
  const held = ui.use(s => !!s.layerHeld || s.qwin.shown);
  const queued = ui.use(s => s.later);
  const open = [...reqs].sort((a, b) => a.at - b.at);
  const w = open.findIndex(r => reqKey(r) === wanted);
  if (w > 0) open.unshift(...open.splice(w, 1));
  const first = held ? undefined : open[0];
  const ready = useApp(s => s.ready);
  const feed = useApp(s => s.feed.slice(0, 12), sameList) ?? EMPTY;
  const feedOpen = ui.use(s => s.prefs.feedOpen);
  const isFocused = ui.use(s => s.focused === 'regia');
  const focusReq = ui.use(s => (id && s.focusReq?.chatId === id ? s.focusReq.n : 0));
  const flash = useFlash('regia');
  const pair = usePair(id);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const now = useNow(15_000);
  // the Regia's input has the default focus (once the chat exists)
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!chat || focusedOnce.current) return;
    focusedOnce.current = true;
    // not while Ctrl+J waits for a card: a key typed right after it would land in the input
    if ((!document.activeElement || document.activeElement === document.body) && !awaitingCard()) input.current?.focus();
  }, [chat]);
  useEffect(() => { if (focusReq) input.current?.focus(); }, [focusReq]);

  // Esc / "Rispondi dopo": the card goes unanswered into "Da rispondere"; the keyboard it had goes to the input
  const later = () => {
    const had = !!(document.activeElement as HTMLElement | null)?.closest('[data-regia-overlay] [data-request-key]');
    answerLater();
    if (had) requestAnimationFrame(() => input.current?.focus());
  };
  const away = feed.filter(e => e.away);
  const fresh = feed.filter(e => !e.away).slice(0, 8);

  if (!chat) {
    return (
      <section className="tile regia-tile empty" role="region" aria-label={t('dialogs.regia.name')} data-testid="tile-regia">
        <header className="tile-head"><div className="th-row"><HarnessMark harness="claude" regia /><h3 className="th-title regia-name">{t('dialogs.regia.name')}</h3></div></header>
        <div className="empty-state">
          {ready ? (
            <>
              <p className="empty-title">{t('dialogs.regia.empty')}</p>
              <p className="empty-text">{t('dialogs.regia.emptyDescription')}</p>
              <button type="button" className="btn btn-regia btn-m" onClick={() => openModal('newChat')} data-testid="regia-create"><IconPlus size={14} /> {t('dialogs.regia.createButton')}</button>
            </>
          ) : (
            <div className="skeleton"><i /><i /><i className="short" /></div>
          )}
        </div>
      </section>
    );
  }

  const busy = isBusy(chat);
  return (
    <section className={`tile regia-tile ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${pair.cls}`} style={pair.style} role="region" aria-label={t('dialogs.regia.tileLabel', { title: chat.title })} data-testid="tile-regia" data-chat-id={chat.id} data-sb-id="regia"
      onFocus={() => setFocused('regia')} onPointerDown={() => setFocused('regia')} {...pairHover(chat.id)} data-pair={pair.index ?? undefined}>
      <header className="tile-head">
        <div className="th-row">
          <HarnessMark harness={chat.harness} regia />
          {renaming ? <TitleInput chat={chat} onDone={() => setRenaming(false)} /> : <h3 className="th-title regia-name" onDoubleClick={() => setRenaming(true)}>{chat.appRegia ? t('dialogs.regia.appName') : t('dialogs.regia.name')}</h3>}
          <StatePill chat={chat} testid="regia-state" />
          <span className="sp" />
          <IconButton label={t('dialogs.regia.statusLabel')} shortcut={t('dialogs.regia.statusShortcut')} onClick={() => openModal('stato')} testid="regia-stato"><IconList size={14} /></IconButton>
          {busy && <IconButton label={t('dialogs.regia.stopLabel')} shortcut={t('dialogs.regia.stopShortcut')} tone="danger" onClick={() => void stop(chat.id)} testid="regia-stop"><IconStop size={14} /></IconButton>}
          <IconButton ref={menuBtn} label={t('dialogs.regia.menuLabel')} onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid="regia-menu"><IconMore /></IconButton>
        </div>
        <div className="th-sub" data-testid="regia-sub">
          <span className="th-engine" data-tip={t('dialogs.regia.engineTip', { name: engineName(chat.harness) })} aria-label={t('dialogs.regia.engineTip', { name: engineName(chat.harness) })} role="img" data-engine={chat.harness} data-testid="regia-engine"><HarnessMark harness={chat.harness} size={14} /></span>
          <span className="th-sub-text">{[chat.title.trim() !== 'Regia' ? chat.title : '', prettyModel(chat.model, chat.harness), effortLabel(chat.effort), chatCost(chat)].filter(Boolean).join(' · ')}</span>
        </div>
      </header>
      <ItemList chatId={chat.id} items={items ?? []} empty={t('dialogs.regia.emptyPrompt')} footer={isBusy(chat) ? <Typing what={turnActivity(items)} testid="typing-regia" /> : null} />
      {queued && reqs.length > 0 && <InWindowLine reqs={open} queued testid="regia-queued" />}
      {!queued && inWindow && reqs.length > 0 && <InWindowLine reqs={reqs} testid="regia-in-window" />}
      {!queued && !inWindow && open.length > 0 && (
        <div className="tile-requests regia-requests">
          {first && <RequestPanel key={reqKey(first)} req={first} variant="regia" chatTitle={t('dialogs.regia.name')} harness={chat.harness} onEscape={later} onLater={later} />}
          {open.length > (first ? 1 : 0) && (
            <div className="qwin-queue regia-next" data-testid="regia-next">
              <span className="qwin-queue-k">{t('dialogs.regia.nextQueue')}</span>
              {open.slice(first ? 1 : 0, 4).map(r => <span key={reqKey(r)} className="qwin-queue-item">{r.title}</span>)}
              {open.length > 4 && <span className="qwin-queue-item">{t('dialogs.regia.moreNext', { count: open.length - 4 })}</span>}
            </div>
          )}
        </div>
      )}
      <div className={`feed ${feedOpen ? 'open' : ''}`} data-testid="regia-feed">
        <button type="button" className="feed-head" onClick={() => setPrefs({ feedOpen: !feedOpen })} aria-expanded={feedOpen} data-testid="regia-feed-toggle">
          <span>{t('dialogs.regia.feedTitle')}</span><span className="count">{feed.length}</span><span className="sp" /><IconChevronDown size={13} className="feed-chev" />
        </button>
        {feedOpen && (
          feed.length === 0 ? <p className="feed-empty">{t('dialogs.regia.feedEmpty')}</p> : (
            <div className="feed-body">
              {away.length > 0 && <div className="feed-group">{t('dialogs.regia.feedAway')}</div>}
              {away.length > 0 && <ul className="feed-list">{away.slice(0, 4).map(e => <FeedRow key={e.id} e={e} now={now} />)}</ul>}
              {away.length > 0 && fresh.length > 0 && <div className="feed-group">{t('dialogs.regia.feedNow')}</div>}
              <ul className="feed-list">{fresh.map(e => <FeedRow key={e.id} e={e} now={now} />)}</ul>
            </div>
          )
        )}
      </div>
      <ChatInput ref={input} chat={chat} regia testid="regia-input" />
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} regia />
    </section>
  );
});

