// An Orchestrator: one of the user's always-on coordinating chats, shown in the floating overlay (OrchestratorOverlay.tsx, one tab
// per Orchestrator; ADR 0021), violet, with its own name. Its input has
// the default focus; its own open questions show as a "decisione" card (a work chat's never show here: the Orchestrator is
// for the state and for moving between chats, the user 2026-10-13), one card at a time, the oldest, the others named
// on a "Poi:" line (the widget is a popup and at most one request popup is on screen; none while the questions window
// or the layer's card is the one); Esc or "Rispondi dopo" postpones that request in this session (lib/later.ts): the card goes
// unanswered, a "Da rispondere" line stays; its own messages' shell blocks have
// "Esegui" too (the run and "Manda l'esito alla chat" belong to the Orchestrator). Completed results appear as compact
// source-chat links in the transcript. Its ⋯ menu is the chat menu (ChatMenu) plus "Ricomincia da
// capo", "Cambia motore" (both open the Nuovo Orchestrator confirm) and "Pulisci"; the eraser on its head is "Pulisci" in
// one click, without the confirm (clearOrchestratorNow, the quick /clear). With no Orchestrator yet it offers to create
// one. Under its head, a line with the chats it started today by state and the cost apart, its own and theirs (#153,
// lib/orchestrator-tally.ts); on its head the one «Manutenzione» for every page (#150, MaintenanceButton compact); the morning block's line while strips are open (no plan panel: the strips carry each estimate, #124) (MorningBlock.tsx, ADR 0102). When it drives a browser, it wears that pair's accent like any chat (lib/pairs.ts). Used by OrchestratorOverlay.tsx.
import { RecapButton } from './WorkCockpit';
import { memo, useEffect, useRef, useState } from 'react';
import { chatCost, formatCost, modelWithEffort } from '../lib/format';
import { orchestratorTally, type OrchestratorTally } from '../lib/orchestrator-tally';
import { engineName } from '../lib/engines';
import { isBusy, sameList } from '../store/state';
import { ensureOrchestrator, stop, useApp } from '../store/store';
import { openModal, setFocused, ui } from '../store/ui';
import { t } from '../i18n';
import { requestPostponed } from '../lib/later';
import { pairHover, usePair } from '../lib/pairs';
import { awaitingCard, clearOrchestratorNow, go, reqKey } from '../actions';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { ModelChip } from './ModelChip';
import { ORCHESTRATOR_ROLE_ID } from '@shared/roles';
import { AgentIdentity } from './AgentIdentity';
import { HelpTip } from './HelpTip';
import {AgentAvatar}from'./AgentAvatar';
import { ChildStrips } from './ChildStrips';
import { MorningLine } from './MorningBlock';
import { MaintenanceButton } from './brain-model/MaintenanceButton';
import { pendingOf, useFlash } from './ChatTile';
import { InWindowLine } from './QuestionsWindow';
import { HarnessMark, IconEraser, IconList, IconMore, IconStop } from './Icons';
import { IconButton, StatePill } from './ui';
import { Select } from './Select';
import { requestFocus } from '../store/ui';

function OrchestratorSetup() {
  const info = useApp(s => s.info), settings = useApp(s => s.settings);
  const engines = (info?.engines ?? []).filter(e => e.trusted && settings?.engineOn[e.id] === true && settings.engines[e.id] !== false);
  const [engine, setEngine] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const pick = engines.find(e => e.id === engine);
    if (busy || !info?.brainRoot || !pick) return;
    setBusy(true);
    try { const chat = await ensureOrchestrator(pick.id); if (chat) requestFocus(chat.id); }
    finally { setBusy(false); }
  };
  return <div className="orchestrator-setup">
    <span className="orchestrator-column-mark" aria-hidden="true">✦</span>
    <h2>{t('home.orchestratorStart')}</h2>
    <p>{t('home.orchestratorIntro')}</p>
    <label htmlFor="orchestrator-engine">{t('home.chooseEngine')}</label>
    <Select id="orchestrator-engine" value={engine} onChange={e => setEngine(e.target.value)} disabled={busy}>
      <option value="">{t('home.chooseEngine')}</option>{engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
    </Select>
    <button type="button" className="btn btn-primary btn-m" disabled={!engine || busy || !info?.brainRoot} onClick={() => void create()} data-testid="orchestrator-create">{t('dialogs.orchestrator.createButton')}</button>
    {!info?.brainRoot && <button type="button" className="btn btn-ghost btn-m" onClick={() => go({ page: 'agenti' })}>{t('home.manageAgents')}</button>}
  </div>;
}

/** chatId = the Orchestrator shown (the overlay's tab); null = none yet */
/** The chats it started today by state and the cost apart, its own and theirs (#153): always visible under its head. */
function TallyLine({ chat }: { chat: Parameters<typeof chatCost>[0] }) {
  const tally = useApp(s => orchestratorTally(Object.values(s.chats).filter((c): c is NonNullable<typeof c> => !!c)), (a: OrchestratorTally, b: OrchestratorTally) => JSON.stringify(a) === JSON.stringify(b));
  const { started, counts: c, startedUsd } = tally;
  const parts = started ? [c.done && t('dialogs.orchestrator.tallyDone', { n: c.done }), c.run && t('dialogs.orchestrator.tallyRun', { n: c.run }),
    c.wait && t('dialogs.orchestrator.tallyWait', { n: c.wait }), c.stuck && t('dialogs.orchestrator.tallyStuck', { n: c.stuck })].filter((x): x is string => !!x) : [];
  return <div className="orch-tally" data-testid="orchestrator-tally">
    {started > 0 && <span data-testid="orchestrator-tally-chats">{t('dialogs.orchestrator.tallyStarted', { n: started })}{parts.length ? `: ${parts.join(' · ')}` : ''}</span>}
    <span data-testid="orchestrator-tally-cost">{t('dialogs.orchestrator.tallyOwn', { cost: chatCost(chat) })}{started > 0 ? ` · ${t('dialogs.orchestrator.tallyChats', { cost: formatCost(startedUsd) })}` : ''}</span>
  </div>;
}

export const OrchestratorTile = memo(function OrchestratorTile({ chatId: id }: { chatId: string | null }) {
  const chat = useApp(s => (id ? s.chats[id] : undefined));
  const items = useApp(s => (id ? s.items[id] : undefined));
  const reqs = useApp(s => (id ? pendingOf(s.pending, id) : []), sameList);
  const postponed = ui.use(() => reqs.filter(r => requestPostponed(reqKey(r))), sameList);
  // its open requests are answered in the questions window: the column names them and opens it
  const open = reqs.filter(r => !postponed.includes(r)).sort((a, b) => a.at - b.at);
  const ready = useApp(s => s.ready);
  const isFocused = ui.use(s => s.focused === 'orchestrator');
  const focusReq = ui.use(s => (id && s.focusReq?.chatId === id ? s.focusReq.n : 0));
  const flash = useFlash('orchestrator');
  const pair = usePair(id);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // the Orchestrator's input has the default focus (once the chat exists)
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!chat || focusedOnce.current) return;
    focusedOnce.current = true;
    // not while Ctrl+J waits for a card: a key typed right after it would land in the input
    if ((!document.activeElement || document.activeElement === document.body) && !awaitingCard()) input.current?.focus();
  }, [chat]);
  useEffect(() => { if (focusReq) input.current?.focus(); }, [focusReq]);

  if (!chat) {
    return (
      <section className="tile orchestrator-tile empty" role="region" aria-label={t('dialogs.orchestrator.name')} data-testid="tile-orchestrator">
        <header className="tile-head"><div className="th-row"><HarnessMark harness="claude" orchestrator /><h3 className="th-title orchestrator-name">{t('dialogs.orchestrator.name')}</h3></div></header>
        <div className="empty-state">
          {ready ? (
            <>
              <OrchestratorSetup />
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
    <section className={`tile orchestrator-tile ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${pair.cls}`} style={pair.style} role="region" aria-label={t('dialogs.orchestrator.tileLabel', { title: chat.title })} data-testid="tile-orchestrator" data-chat-id={chat.id} data-sb-id="orchestrator"
      onFocus={() => setFocused('orchestrator')} onPointerDown={() => setFocused('orchestrator')} {...pairHover(chat.id)} data-pair={pair.index ?? undefined}>
      <header className="tile-head">
        <div className="th-row">
          <AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name||chat.title} size={24}/>
          {renaming ? <TitleInput chat={chat} onDone={() => setRenaming(false)} /> : <h3 className="th-title orchestrator-name" onDoubleClick={() => setRenaming(true)}>{chat.agent?.name||chat.title}</h3>}
          <StatePill chat={chat} testid="orchestrator-state" />
          <HelpTip title={t('explain.orch.title')} guide="orchestrator" testid="orchestrator-help"><p>{t('explain.orch.p1')}</p><p>{t('explain.orch.p2')}</p><p>{t('explain.orch.p3')}</p></HelpTip>
          <span className="sp" />
          <MaintenanceButton compact testId="orchestrator-maint" />
          <IconButton label={t('dialogs.orchestrator.statusLabel')} shortcut={t('dialogs.orchestrator.statusShortcut')} onClick={() => openModal('stato')} testid="orchestrator-stato"><IconList size={14} /></IconButton>
          {busy && <IconButton label={t('dialogs.orchestrator.stopLabel')} shortcut={t('dialogs.orchestrator.stopShortcut')} tone="danger" onClick={() => void stop(chat.id)} testid="orchestrator-stop"><IconStop size={14} /></IconButton>}
          <IconButton label={t('lampo.clear')} disabled={busy} onClick={() => void clearOrchestratorNow(chat.id)} testid="orchestrator-clear"><IconEraser size={14} /></IconButton>
          <IconButton ref={menuBtn} label={t('dialogs.orchestrator.menuLabel')} onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid="orchestrator-menu"><IconMore /></IconButton>
        </div>
        <div className="chat-topic-row"><ModelChip chat={chat} profileId={ORCHESTRATOR_ROLE_ID} testid="orchestrator-model" /><span className="chat-topic">{chat.title}</span><AgentIdentity chat={chat}/></div>
        <div className="work-recap-line"><RecapButton /></div>
        <TallyLine chat={chat} />
        <div className="th-sub sr-only" data-testid="orchestrator-sub">
          <span className="th-engine" data-tip={t('dialogs.orchestrator.engineTip', { name: engineName(chat.harness) })} aria-label={t('dialogs.orchestrator.engineTip', { name: engineName(chat.harness) })} role="img" data-engine={chat.harness} data-testid="orchestrator-engine"><HarnessMark harness={chat.harness} size={14} /></span>
          <span className="th-sub-text">{[!['Orchestrator', 'Orchestrator'].includes(chat.title.trim()) ? chat.title : '', modelWithEffort(chat), chatCost(chat)].filter(Boolean).join(' · ')}</span>
        </div>
      </header>
      {/* the Orchestrator's own sub-agents (its background Agent tools): visible here, it sits outside the strips */}
      <ChildStrips chatId={chat.id} />
      {/* "Mentre eri via" in one line while strips (or another page) take the Grindhouse's place (ADR 0102) */}
      <MorningLine />
      <ItemList chatId={chat.id} items={items ?? []} empty={t('dialogs.orchestrator.emptyPrompt')} footer={isBusy(chat) ? <Typing what={turnActivity(items)} testid="typing-orchestrator" items={items} /> : null} />
      {postponed.length > 0 && <InWindowLine reqs={postponed} queued testid="orchestrator-queued" />}
      {open.length > 0 && <InWindowLine reqs={open} testid="orchestrator-in-window" />}
      {/* in the place of the old "Novità" feed (#88): what the app holds back for this Orchestrator */}
      <ChatInput ref={input} chat={chat} orchestrator testid="orchestrator-input" voice="orchestrator" />
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} orchestrator />
    </section>
  );
});

