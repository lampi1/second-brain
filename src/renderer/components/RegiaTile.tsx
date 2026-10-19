// A Regia: one of the user's always-on coordinating chats, shown in the floating overlay (RegiaOverlay.tsx, one tab
// per Regia; ADR 0021), violet, with its own name. Its input has
// the default focus; its own open questions show as a "decisione" card (a work chat's never show here: the Regia is
// for the state and for moving between chats, the user 2026-10-13), one card at a time, the oldest, the others named
// on a "Poi:" line (the widget is a popup and at most one request popup is on screen; none while the questions window
// or the layer's card is the one); Esc or "Rispondi dopo" turns "Rispondi dopo" on (lib/later.ts): the card goes
// unanswered, a "Da rispondere" line stays; its own messages' shell blocks have
// "Esegui" too (the run and "Manda l'esito alla chat" belong to the Regia); above its input, "N novità in attesa"
// (HeldNews.tsx, #88: what the app holds back for it; it replaced the "Novità" feed, which stays in the bell). Its ⋯ menu is the chat menu (ChatMenu) plus "Ricomincia da
// capo", "Cambia motore" (both open the Nuova Regia confirm) and "Pulisci". With no Regia yet it offers to create
// one. When it drives a browser, it wears that pair's accent like any chat (lib/pairs.ts). Used by RegiaOverlay.tsx.
import { memo, useEffect, useRef, useState } from 'react';
import { chatCost, prettyModel } from '../lib/format';
import { engineName } from '../lib/engines';
import { isBusy, sameList } from '../store/state';
import { ensureOrchestrator, stop, useApp } from '../store/store';
import { openModal, setFocused, ui } from '../store/ui';
import { t } from '../i18n';
import { answerLater } from '../lib/later';
import { pairHover, usePair } from '../lib/pairs';
import { awaitingCard, openLink, reqKey } from '../actions';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { AgentIdentity } from './AgentIdentity';
import {AgentAvatar}from'./AgentAvatar';
import { ChildStrips } from './ChildStrips';
import { pendingOf, useFlash } from './ChatTile';
import { RequestPanel } from './RequestPanel';
import { InWindowLine } from './QuestionsWindow';
import { questionsModalOn } from '../lib/questions';
import { HarnessMark, IconList, IconMore, IconStop } from './Icons';
import { HeldNews } from './HeldNews';
import { IconButton, StatePill } from './ui';
import { Select } from './Select';
import { requestFocus, setRegiaTab } from '../store/ui';

function RegiaSetup() {
  const info = useApp(s => s.info), settings = useApp(s => s.settings);
  const engines = (info?.engines ?? []).filter(e => e.trusted && settings?.engineOn[e.id] === true && settings.engines[e.id] !== false);
  const [engine, setEngine] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const pick = engines.find(e => e.id === engine);
    if (busy || !info?.brainRoot || !pick) return;
    setBusy(true);
    try { const chat = await ensureOrchestrator(pick.id); if (chat) { setRegiaTab(chat.id); requestFocus(chat.id); } }
    finally { setBusy(false); }
  };
  return <div className="regia-setup">
    <span className="regia-column-mark" aria-hidden="true">✦</span>
    <h2>{t('home.regiaStart')}</h2>
    <p>{t('home.regiaIntro')}</p>
    <label htmlFor="regia-engine">{t('home.chooseEngine')}</label>
    <Select id="regia-engine" value={engine} onChange={e => setEngine(e.target.value)} disabled={busy}>
      <option value="">{t('home.chooseEngine')}</option>{engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
    </Select>
    <button type="button" className="btn btn-primary btn-m" disabled={!engine || busy || !info?.brainRoot} onClick={() => void create()} data-testid="regia-create">{t('dialogs.regia.createButton')}</button>
    {!info?.brainRoot && <button type="button" className="btn btn-ghost btn-m" onClick={() => openModal('newChat')}>{t('home.manageAgents')}</button>}
  </div>;
}

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
  const isFocused = ui.use(s => s.focused === 'regia');
  const focusReq = ui.use(s => (id && s.focusReq?.chatId === id ? s.focusReq.n : 0));
  const flash = useFlash('regia');
  const pair = usePair(id);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
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

  if (!chat) {
    return (
      <section className="tile regia-tile empty" role="region" aria-label={t('dialogs.regia.name')} data-testid="tile-regia">
        <header className="tile-head"><div className="th-row"><HarnessMark harness="claude" regia /><h3 className="th-title regia-name">{t('dialogs.regia.name')}</h3></div></header>
        <div className="empty-state">
          {ready ? (
            <>
              <RegiaSetup />
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
          <AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name||chat.title} size={24}/>
          {renaming ? <TitleInput chat={chat} onDone={() => setRenaming(false)} /> : <h3 className="th-title regia-name" onDoubleClick={() => setRenaming(true)}>{chat.agent?.name||chat.title}</h3>}
          <StatePill chat={chat} testid="regia-state" />
          <span className="sp" />
          <IconButton label={t('dialogs.regia.statusLabel')} shortcut={t('dialogs.regia.statusShortcut')} onClick={() => openModal('stato')} testid="regia-stato"><IconList size={14} /></IconButton>
          {busy && <IconButton label={t('dialogs.regia.stopLabel')} shortcut={t('dialogs.regia.stopShortcut')} tone="danger" onClick={() => void stop(chat.id)} testid="regia-stop"><IconStop size={14} /></IconButton>}
          <IconButton ref={menuBtn} label={t('dialogs.regia.menuLabel')} onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid="regia-menu"><IconMore /></IconButton>
        </div>
        <div className="chat-topic-row"><span className="chat-topic">{chat.title}</span><AgentIdentity chat={chat}/></div>
        <div className="th-sub sr-only" data-testid="regia-sub">
          <span className="th-engine" data-tip={t('dialogs.regia.engineTip', { name: engineName(chat.harness) })} aria-label={t('dialogs.regia.engineTip', { name: engineName(chat.harness) })} role="img" data-engine={chat.harness} data-testid="regia-engine"><HarnessMark harness={chat.harness} size={14} /></span>
          <span className="th-sub-text">{[!['Regia', 'Orchestrator'].includes(chat.title.trim()) ? chat.title : '', prettyModel(chat.model, chat.harness), chatCost(chat)].filter(Boolean).join(' · ')}</span>
        </div>
      </header>
      {/* the Orchestrator's own sub-agents (its background Agent tools): visible here, it sits outside the strips */}
      <ChildStrips chatId={chat.id} />
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
      {/* in the place of the old "Novità" feed (#88): what the app holds back for this Orchestrator */}
      <HeldNews regiaId={chat.id} onOpenChat={c => openLink(`sb://home/chat-${c}`)} />
      <ChatInput ref={input} chat={chat} regia testid="regia-input" />
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} regia />
    </section>
  );
});

