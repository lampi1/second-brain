// One agent's window (ADR 0287): a chat as a one-line strip in the Grindhouse (AgentStrips.tsx), open in the column, or in
// full screen (FullScreen.tsx). The strip is one row (ADR 0292, the look the owner chose): a dot for its state, who it
// is, the title · current step, then on the right its work time and cost so far, each next to its estimate («22 min /
// ~19 min · 1,84 $ / ~0,60 $», amber once past it), and a pill only when words are needed («Ti aspetta» opens its
// question, an error, a queue); a long context shows its meter; three controls appear on hover (stop, full screen, the
// ⋯ menu with rename / model / permissions / hand-off / close; Ctrl+W closes too). A click anywhere on the strip opens
// it; open, a click on the head closes it. Open, the ⓘ shows one details row (version, model, cost, work time, folder,
// the estimate: RunEstimate.tsx, ADR 0087; context size) and the DevOps links (ChatLinkChips.tsx), then the body. A chat that
// drives browser tabs is ONE window with three views (Chat · Affiancati · Browser, prefs.agentView): its tabs sit
// beside the transcript behind a divider the user drags (prefs.agentSplit, per chat), several tabs are small tabs over
// the address bar, and the browser alone keeps the input under it. A tab waiting for the user (a login hand-off) is
// always shown. In full screen the head is the window's one bar: back (Esc), who it is, the view switch, how many
// questions wait elsewhere and the Orchestrator (Ctrl+R). The transcript, the inline question/permission line (the
// Orchestrator holds the panels, ADR 0269; lib/later.ts), an error bar with one action and the always-mounted input
// stay as they were; an open chat also shows the open requests of the chats it delegated (lib/child-requests.ts,
// ADR 0083) and a Strategist's plan (StrategyPanel.tsx, ADR 0108). Selectors read only this chat, so other chats
// streaming never re-render it.
import { t as auditText } from '../i18n';
import { memo, useEffect, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { chatCost, queueReason, folderName, minutes, permissionBadge, modelWithEffort, stateInfo, workTime } from '../lib/format';
import { useNow } from '../lib/clock';
import { COMPACT_TILE_H } from '../lib/grid';
import { isBusy, sameList } from '../store/state';
import { send, stop, useApp } from '../store/store';
import { DEFAULT_SPLIT, setAgentSplit, setAgentView, setFocused, setChatExpanded, ui, type AgentView } from '../store/ui';
import {t}from'../i18n';
import {schedule,suspendViews}from'../lib/viewports';
import { openQueue, requestPostponed } from '../lib/later';
import { admitNow, reqKey, toggleMaximize } from '../actions';
import { useHandoffTabs } from '../store/handoffs';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { BrowserTile } from './BrowserTile';
import { FullTools } from './FullTools';
import { selectedHere } from '../lib/strip-click';
import { StripEstimate } from './RunEstimate';
import { ChatLinkChips } from './ChatLinkChips';
import { AgentIdentity } from './AgentIdentity';
import { AgentAvatar } from './AgentAvatar';
import { RunChips, RunOutcomeControl } from './RunSurface';
import { AutoCloseNotice } from './AutoCloseNotice';
import { autoCloseState } from '../store/auto-close';
import { USER_WAITS, waitingLabel } from '../lib/waiting-label';
import { ChatLinks, ContextMeter, ContextNotice, isLong, useWarnTokens } from './ContextBar';
import { StripActivity } from './StripActivity';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { planQuestion } from '../lib/plan-ask';
import { StrategyPanel } from './StrategyPanel';
import { ChildStrips } from './ChildStrips';
import { TaskContext } from './TaskContext';
import { InWindowLine } from './QuestionsWindow';
import { RunHereCtx } from './CodeBlock';
import { childRequestsFor, requestHost, type ChildRequest } from '../lib/child-requests';
import { IconAlert, IconArrowLeft, IconChat, IconColumns, IconGlobe, IconInfo, IconMaximize, IconMore, IconStop } from './Icons';
import { IconButton, Kbd, StatePill, useSize } from './ui';
import { rolePurpose } from '../lib/role-text';

// the ✕ (of a chat or a browser tile) ignores the later clicks of a double click (detail > 1): the grid reflows and the
// next tile's ✕ lands under the pointer, so a double click would close two tiles. Not a time window: one swallowed a
// deliberate ✕ right after a close and Annulla (close-fast.spec)
export function closeFromX(e: { detail: number }, close: () => void): void {
  if (e.detail > 1) return;
  close();
}
const EMPTY_REQS: readonly PendingRequest[] = [];
const sameAsks = (a: ChildRequest[], b: ChildRequest[]) => a.length === b.length && a.every((x, i) => x.req === b[i]!.req && x.chat === b[i]!.chat);
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

const VIEWS: readonly AgentView[] = ['chat', 'split', 'browser'];

export const ChatTile = memo(function ChatTile({ chatId, index, focus, embedded }: { chatId: string; index?: number; focus?: boolean; embedded?: boolean }) {
  const chat = useApp(s => s.chats[chatId]);
  const reqs = useApp(s => pendingOf(s.pending, chatId), sameList);
  // its one status (#359): what main says it waits for, from real state, in place of the state
  const waitRow = autoCloseState.use(rows => rows.find(r => r.chatId === chatId));
  // each request shows once (lib/child-requests.ts requestHost): here only when this view is the one that holds it
  const expandedAll = ui.use(s => s.prefs.chatExpanded), focusModeId = ui.use(s => s.focusMode), maxKey = ui.use(s => s.maximized);
  const treeCollapsed = ui.use(s => s.prefs.treeCollapsed);
  const view = { expanded: expandedAll, focusMode: focusModeId, maximized: maxKey, treeCollapsed };
  const childReqs = useApp(s => childRequestsFor(chatId, s.chats, s.pending).filter(c => requestHost(c.req.chatId, s.chats, view) === chatId), sameAsks);
  const hostsOwn = useApp(s => !!s.chats[chatId]?.quick);
  const postponedOwn = ui.use(() => reqs.filter(r => requestPostponed(reqKey(r))), sameList);
  const postponedChildren = ui.use(() => childReqs.filter(c => requestPostponed(reqKey(c.req))), sameAsks);
  const activeOwn = reqs.filter(r => !postponedOwn.includes(r));
  const activeChildren = childReqs.filter(c => !requestPostponed(reqKey(c.req)));
  const key = `chat:${chatId}`;
  const isFocused = ui.use(s => s.focused === key);
  const closing = ui.use(s => s.closing.includes(chatId));
  const focusReq = ui.use(s => (s.focusReq?.chatId === chatId ? s.focusReq.n : 0));
  const flash = useFlash(key);
  const ref = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<ChatInputHandle>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [facts, setFacts] = useState(false); // the details row is asked for (ⓘ), the head stays one line
  const expandedChoice=ui.use(s=>s.prefs.chatExpanded[chatId]===true);
  const expanded=!!focus||!!embedded||expandedChoice;
  const expansionButton=useRef<HTMLButtonElement>(null);
  const downSelection=useRef('');
  const reveal=(compose=false)=>{setChatExpanded(chatId,true);if(compose)requestAnimationFrame(()=>input.current?.focus());};
  // the browser tabs this chat drives, in its own window (not while one is being closed: the undo toast runs)
  const hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  const tabs = useApp(s => s.tabs.filter(tab => tab.ownerChatId === chatId && !hiddenTabs.includes(tab.id)).map(tab => tab.id), sameList);
  const tabTitles = useApp(s => tabs.map(id => s.tabs.find(tab => tab.id === id)?.title || ''), sameList);
  const waitingTabs = useHandoffTabs();
  const handoffTab = tabs.find(id => waitingTabs.includes(id));
  const savedView = ui.use(s => s.prefs.agentView[chatId]);
  // the chat alone until asked (owner, 18/10); full screen has the room for both; a tab waiting for the user always shows
  const chosen: AgentView = savedView ?? (focus ? 'split' : 'chat');
  const shownView: AgentView = !tabs.length ? 'chat' : chosen === 'chat' && handoffTab ? 'split' : chosen;
  const share = ui.use(s => s.prefs.agentSplit[chatId] ?? DEFAULT_SPLIT);
  const [pickedTab, setPickedTab] = useState<string | null>(null);
  // a tab brought on screen from elsewhere (a link chip, the palette: actions.ts showTab flashes it) becomes the one shown
  const flashedTab = ui.use(s => (s.flash?.key.startsWith('browser:') && tabs.includes(s.flash.key.slice(8)) ? `${s.flash.key.slice(8)}#${s.flash.n}` : ''));
  useEffect(() => { if (flashedTab) setPickedTab(flashedTab.slice(0, flashedTab.lastIndexOf('#'))); }, [flashedTab]);
  const tabShown = handoffTab ?? (pickedTab && tabs.includes(pickedTab) ? pickedTab : tabs[tabs.length - 1]);
  useEffect(()=>{const release=suspendViews();schedule();const timer=setTimeout(()=>{release();schedule();},window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);return()=>{clearTimeout(timer);release();};},[expanded]);
  useEffect(() => { schedule(); }, [shownView, share, tabShown]);
  // the long-chat notice, hidden by the user until the context grows by another quarter of the threshold
  const warn = useWarnTokens();
  const lqCpu = useApp(s => s.settings?.loadQueueCpu ?? 95);
  const lqRam = useApp(s => s.settings?.loadQueueRam ?? 10);
  const size = useSize(ref);
  const estimates = useRunEstimates();
  const now = useNow(15_000); // the running work span grows on screen
  useEffect(() => {
    if (!focusReq) return;
    reveal(true);
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusReq]);
  if (!chat) return null;
  const compact = !expanded || !focus && !embedded && size.height > 0 && size.height < COMPACT_TILE_H;
  const busy = isBusy(chat);
  const st = stateInfo(chat);
  const queueLimits = { cpu: lqCpu, ram: lqRam };
  // no per-chat effort control here (#75): the agent's profile decides it; the effort in use is shown read only (#100)
  const sub = [modelWithEffort(chat), chatCost(chat)].filter(Boolean).join(' · ');
  const folder = folderName(chat.cwd);
  const perm = permissionBadge(chat.permissionMode);
  const work = workTime(chat, now);
  const strip = !focus && !embedded;
  // a click on the strip itself (not on one of its controls, nor inside a portalled menu) opens or closes it
  const onStripClick = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.target as Element;
    if (!strip || !e.currentTarget.contains(el) || el.closest('button, a, input, textarea, select, summary, label, [role="menu"], [role="separator"], [contenteditable="true"], .chat-topic, .sp-card, .aw-browser')) return;
    if (selectedHere(window.getSelection(), e.currentTarget, downSelection.current)) return; // selecting text is not a click
    if (!expanded) setChatExpanded(chatId, true);
    else if (el.closest('.tile-head')) setChatExpanded(chatId, false);
  };
  const first = reqs[0] ? reqKey(reqs[0]) : null;
  const waitText = waitingLabel(waitRow), userWait = !!waitRow?.waitingFor && USER_WAITS.has(waitRow.waitingFor);
  // a Strategist's open question: the strip points to the window, set aside too («Basta domande» stays reachable)
  const planAsk = planQuestion(chat, reqs, false);
  const ownReqs = activeOwn;
  // past its estimate a figure of the strip turns amber (ADR 0292); a long context shows its meter on the head
  const estimate = chat.run ? estimates?.runs[chat.run.runId]?.estimate ?? null : null;
  // the cost as chatCost reads it: the ledger's for an engine that reports none, nothing when it is unknown or zero
  const costNow = chat.costLedgerUsd ?? (chat.costKnown === false ? null : chat.costUsd || null);
  const overTime = !!estimate && estimate.timeMs !== null && work !== null && work > estimate.timeMs;
  const overCost = !!estimate && estimate.costUsd !== null && costNow !== null && costNow > estimate.costUsd * 1.5;
  const longContext = isLong(chat, warn);
  const name = chat.agent?.name || chat.title, topic = chat.agent?.name && chat.title && chat.title !== chat.agent.name ? chat.title : '';
  // one state: «Ti aspetta» (opens the question), else the dot in front and, when words are needed, a pill
  const stateText = waitText && st.tone !== 'err' && st.label !== t('ui.state.queued') ? waitText : st.label;
  // the plain states are the leading dot alone (its word stays for screen readers); anything else is said in words
  const plainState = !focus && stateText === st.label && (st.tone === 'run' || st.tone === 'done');
  const est = estimate ? estimateText(estimate) : null;
  const cost = chatCost(chat);
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget, box = body.current?.getBoundingClientRect();
    if (!box || e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    const release = suspendViews(); // native pages would swallow the pointer while it crosses them
    const move = (ev: PointerEvent) => setAgentSplit(chatId, (ev.clientX - box.left) / box.width);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); release(); schedule(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  const viewSwitch = tabs.length > 0 && expanded && <div className="aw-views" role="group" aria-label={t('aw.views')} data-testid={`chat-views-${chatId}`}>
    {VIEWS.map(v => <button key={v} type="button" className={`aw-view${shownView === v ? ' on' : ''}`} aria-pressed={shownView === v} data-on={shownView === v || undefined}
      onClick={() => setAgentView(chatId, v)} data-tip={t(`aw.view.${v}`)} aria-label={t(`aw.view.${v}`)} data-testid={v === 'split' ? `chat-browser-${chatId}` : `chat-view-${v}-${chatId}`}>
      {v === 'chat' ? <IconChat size={13} /> : v === 'split' ? <IconColumns size={13} /> : <IconGlobe size={13} />}<span>{t(`aw.view.${v}`)}</span>
    </button>)}
  </div>;
  return (
    <section ref={ref} className={`tile chat-tile ${expanded?'is-expanded':'is-strip'} tone-${st.tone} ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${compact ? 'compact' : ''} ${closing ? 'closing' : ''}${embedded ? ' is-embedded' : ''}${focus ? ' is-full' : ''}`} role="region"
      aria-label={auditText('auditExpression.ChatTile.text20', { v0: chat.title, v1: st.label })} data-testid={`tile-chat-${chatId}`} data-chat-id={chatId} data-sb-id={`chat-${chatId}`} data-chat-index={index} data-state={chat.state}
      onClick={onStripClick} onFocus={() => setFocused(key)} onPointerDown={() => { downSelection.current = window.getSelection()?.toString() ?? ''; setFocused(key); }}>
      {!embedded && <header className="tile-head">
        <div className="th-row">
          {focus && <button type="button" className="btn btn-ghost btn-s aw-back" onClick={() => toggleMaximize(key)} data-testid="focus-exit" aria-label={t('aw.fullExit')}><IconArrowLeft size={13} /><Kbd>Esc</Kbd></button>}
          {focus ? <AgentAvatar avatar={chat.agent?.avatar} name={name} size={24}/> : <span className={`strip-dot lead tone-${first ? 'wait' : st.tone}`} aria-hidden="true" />}
          {/* the name is the strip's own button (keyboard, screen readers); a click anywhere on the strip does the same */}
          <h3 className="th-title" title={(chat.agent?.purpose&&rolePurpose(chat.agent.id,chat.agent.purpose))||chat.title}>
            {strip ? <button ref={expansionButton} type="button" className="strip-name" aria-expanded={expanded} aria-controls={`chat-work-${chatId}`} data-tip={t(expanded?'product.collapse':'product.expand')} onClick={()=>setChatExpanded(chatId,!expanded)} data-testid={`chat-expand-${chatId}`}>{name}</button> : name}
          </h3>
          {/* the title and, closed, what it is doing now (the owner, 2026-11-12: the title next to the agent, as the sidebar) */}
          {renaming ? <TitleInput chat={chat} onDone={()=>setRenaming(false)}/> : <span className="strip-now">
            {topic && <span className={expanded ? 'chat-topic' : 'th-topic'} title={chat.title} onDoubleClick={expanded ? () => setRenaming(true) : undefined} data-testid={`chat-topic-${chatId}`}>{topic}</span>}
            {!expanded && <span className="chat-strip-line">{busy?<StripActivity chatId={chatId} testid={`typing-${chatId}`}/>:chat.work?.status==='waiting-mail'?t('product.workWaiting'):chat.plan?.phase==='proposed'?t('tree.plan.ready'):chat.lastText.slice(0,140)}</span>}
          </span>}
          {chat.resumedAt && (
            <span className="th-resumed" data-tip={auditText('audit.ChatTile.itsTurnWasInterruptedByThe')}
              data-testid={`chat-resumed-${chatId}`}>{auditText('audit.ChatTile.resumedAfterRestart')}</span>
          )}
          {/* time and cost so far, each against its estimate: always on the strip (the owner, 2026-11-13) */}
          {(work !== null || costNow !== null) && <span className="strip-meta" data-testid={`chat-meta-${chatId}`} data-tip={t((work !== null && est?.time) || (costNow !== null && est?.cost) ? 'aw.metaTipEst' : 'aw.metaTip')}>
            {work !== null && <span className={overTime ? 'over' : undefined}>{minutes(work)}{est?.time && <i> / {est.time}</i>}</span>}
            {costNow !== null && <span className={overCost ? 'over' : undefined}>{cost}{est?.cost && <i> / {est.cost}</i>}</span>}
            {(overTime || overCost) && <span className="sr-only" data-testid={`chat-over-${chatId}`}>{t('aw.overTip')}</span>}
          </span>}
          {(!expanded || !facts) && longContext && <ContextMeter chat={chat} warn={warn} />}
          {viewSwitch}
          {/* the state stays in the DOM as the strip's data-state hook; one thing is shown: the wait or the state */}
          <span hidden><StatePill chat={chat} testid={`chat-state-${chatId}`} /></span>
          {first ? <button type="button" className="strip-wait" onClick={() => openQueue(first)} aria-label={t('product.waitsYouOpen', { title: name })} data-testid={`chat-wait-${chatId}`} data-state={chat.state} {...(expanded ? {} : { 'data-waits-keys': reqs.map(reqKey).join(' ') })}>
            <span className="strip-wait-dot" aria-hidden="true" />{waitText && userWait ? waitText : t('product.waitsYou')}{reqs.length > 1 && <b>{reqs.length}</b>}
          </button> : <span className={`strip-state tone-${st.tone}${plainState ? ' sr-only' : ''}`} data-testid={`chat-status-${chatId}`} title={st.label}>{stateText}</span>}
          {focus && <FullTools chatId={chatId} />}
          <div className="chat-header-actions">
          {(busy || chat.state === 'waiting') && (
            <IconButton label={t('chat.tile.stop')} shortcut="Ctrl+." tone="danger" onClick={() => void stop(chatId)} testid={`chat-stop-${chatId}`}><IconStop size={14} /></IconButton>
          )}
          {/* a closed strip that drives a browser: one click opens it with the page beside the chat */}
          {tabs.length > 0 && !expanded && <IconButton label={t('aw.view.split')} aria-pressed={false} onClick={() => { setAgentView(chatId, 'split'); setChatExpanded(chatId, true); }} testid={`chat-browser-${chatId}`}><IconGlobe size={14} /></IconButton>}
          {(strip || focus) && <IconButton label={focus ? t('aw.fullExit') : t('aw.full')} shortcut="F11" onClick={() => toggleMaximize(key)} testid={`chat-max-${chatId}`}><IconMaximize size={14} /></IconButton>}
          {expanded && <IconButton label={t('aw.facts')} onClick={() => setFacts(v => !v)} aria-expanded={facts} testid={`chat-facts-${chatId}`}><IconInfo size={14} /></IconButton>}
          <IconButton ref={menuBtn} label={t('chat.tile.menu')} onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid={`chat-menu-${chatId}`}><IconMore /></IconButton>
          </div>
        </div>
        {expanded && facts && <div className="th-sub strip-facts" data-testid={`chat-sub-${chatId}`}>
          {chat.run && <RunChips run={chat.run} />}
          <span className="th-sub-text">{sub}{work !== null && <>{' · '}<span className="th-work" data-testid={`chat-work-${chatId}`} data-tip={auditText('audit.ChatTile.actualWorkTimeExcludingWaitsFor')}>{auditText('audit.ChatTile.work')}{' '}{minutes(work)}</span></>}{folder ? ` · ${folder}` : ''}</span>
          {chat.run && <StripEstimate chat={chat} busy={busy || chat.state === 'waiting'} workMs={work} />}
          {perm && <span className="th-badge">{perm}</span>}
          <ContextMeter chat={chat} warn={warn} />
          <AgentIdentity chat={chat}/>
        </div>}
        {!compact && facts && <ChatLinkChips chatId={chatId} />}
      </header>}
      <AutoCloseNotice chatId={chatId} hideUser={!!first} />
      {/* in full screen the subagents at work stay in sight, as under the strip in the Grindhouse */}
      {focus && <ChildStrips chatId={chatId} />}
      {chat.plan && !['asking', 'revising', 'proposed'].includes(chat.plan.phase) && <StrategyPanel chat={chat} question={planAsk} />}
      {embedded && viewSwitch}
      <div ref={body} className={`aw-body view-${shownView}`} data-view={shownView} {...(expanded && shownView !== 'chat' ? { 'data-testid': `strip-pair-${chatId}` } : {})}>
      <div className={`chat-work${expanded?' expanded':''}`} id={`chat-work-${chatId}`} inert={!expanded} aria-hidden={!expanded} style={expanded && shownView === 'split' ? { flexGrow: share } : undefined}><div className="chat-work-inner">
      {!compact && <ChatLinks chat={chat} />}
      {expanded && <TaskContext chat={chat} onContinue={() => reveal(true)} />}
      {!compact && chat.handoffBusy && <ContextNotice chat={chat} />}
      {/* no Esegui in a work chat: its commands wait in the Orchestrator (ADR 0269) */}
      <RunHereCtx.Provider value={false}><ChatTranscript key={chatId} chatId={chatId} busy={busy} expanded={expanded} /></RunHereCtx.Provider>
      {/* every chat keeps its input (the owner, 2026-11-10: «permettimi anche di scrivere ad ogni agente … voglio
          comunque avere la possibilità»); the Orchestrator stays the usual way to talk to delegated work */}
      <ChatInput ref={input} chat={chat} testid={`chat-input-${chatId}`} />
      {expanded && chat.run && <RunOutcomeControl key={`${chat.run.runId}:${chat.run.counters.reopened}`} run={chat.run} disabled={busy || reqs.length > 0 || chat.state === 'waiting' || !!chat.queued} />}
      </div></div>
      {expanded && shownView === 'split' && <div className="aw-divider" role="separator" aria-orientation="vertical" aria-label={t('aw.resizer')} tabIndex={0} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(share * 100)} data-testid={`chat-divider-${chatId}`}
        onPointerDown={drag} onDoubleClick={() => setAgentSplit(chatId, DEFAULT_SPLIT)}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAgentSplit(chatId, share + (e.key === 'ArrowLeft' ? -0.04 : 0.04)); } else if (e.key === 'Home') { e.preventDefault(); setAgentSplit(chatId, DEFAULT_SPLIT); } }} />}
      {expanded && shownView !== 'chat' && tabShown && <div className="aw-browser" style={shownView === 'split' ? { flexGrow: 1 - share } : undefined}>
        {tabs.length > 1 && <div className="aw-tabs" role="tablist" aria-label={t('aw.tabs')}>
          {tabs.map((id, i) => <button key={id} type="button" role="tab" aria-selected={id === tabShown} className={`aw-tab${id === tabShown ? ' on' : ''}`} onClick={() => setPickedTab(id)} data-testid={`chat-tab-${id}`} title={tabTitles[i]}>{tabTitles[i] || t('aw.tab', { n: i + 1 })}</button>)}
        </div>}
        <BrowserTile key={tabShown} tabId={tabShown} embedded />
      </div>}
      </div>
      {expanded && hostsOwn && postponedOwn.length > 0 && <InWindowLine reqs={postponedOwn} queued testid={`chat-queued-${chatId}`} />}
      {expanded && hostsOwn && ownReqs.length > 0 && <InWindowLine reqs={ownReqs} testid={`chat-in-window-${chatId}`} />}
      {expanded && postponedChildren.length > 0 && <InWindowLine reqs={postponedChildren.map(c => c.req)} queued testid={`chat-child-queued-${chatId}`} />}
      {expanded && activeChildren.length > 0 && <InWindowLine reqs={activeChildren.map(c => c.req)} testid={`chat-child-in-window-${chatId}`} />}
      {chat.queued && !chat.closedAt && (
        <div className="queued-bar" data-testid={`chat-queued-${chatId}`}>
          <span className="queued-text" data-tip={auditText('auditExpression.ChatTile.text23', { v0: chat.queued.cpu, v1: chat.queued.freeRam, v3: chat.queued.starting ?? 0, v4: chat.queued.slots ?? '?', v2: chat.queued.kind === 'start' ? auditText('auditExpression.ChatTile.text24') : auditText('auditExpression.ChatTile.text25') })}>{auditText('audit.ChatTile.queued')}{' '}{queueReason(chat.queued, queueLimits)} · {chat.queued.position === 1 ? auditText('auditExpression.ChatTile.text26') : auditText('auditExpression.ChatTile.text27', { v0: chat.queued.position })}
          </span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => void admitNow(chatId)} data-testid={`chat-admit-${chatId}`}>{auditText('audit.ChatTile.startNow')}</button>
        </div>
      )}
      {chat.state === 'error' && (
        <div className="error-bar" role="alert">
          <IconAlert size={14} /><span>{chat.lastError || auditText('cmp.chatTile.stoppedWithError')}</span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => send(chatId, auditText('cmp.chatTile.retryMessage'))} data-testid={`chat-retry-${chatId}`}>{auditText('audit.ChatTile.retry')}</button>
        </div>
      )}
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => { if (strip) setChatExpanded(chatId, true); setRenaming(true); }} />
    </section>
  );
});
