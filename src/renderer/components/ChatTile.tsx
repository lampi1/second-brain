// One chat as a tile: header (harness mark, title, state pill, ■ stop, ⋯ menu with model / effort / permissions /
// rename / focus / hand-off / "Riprendi" / close, ⤢ maximize, ✕ close: Ctrl+W too, with the usual undo), sub-line (model · cost · folder · context
// size), the DevOps link chips (ChatLinkChips.tsx), the "Riprendi" links and the long-chat notice (ContextBar.tsx), the transcript, the inline
// question/permission/command panel (with "Domande in finestra" on, one line: the questions window shows it; while
// "Rispondi dopo" is on, one "Da rispondere" line: the chat waits, lib/later.ts), an error bar with one action, and the always-visible input (the menu is ChatMenu). Small tiles render compact
// (last line; while the turn runs, its current step, plan position and silence: StripActivity.tsx, ADR 0102; the open request). Selectors read only this chat, so other chats streaming never re-render it.
// A chat that drives browser tabs shares their accent color and hover (lib/pairs.ts). Used by the agents' strips in the
// Grindhouse (AgentStrips.tsx) and the focus view. A strip (Brother, 18/10): a click anywhere on it expands it, a click on
// the head of an expanded one collapses it; the key facts (model, cost, work time, context, the task estimate from similar
// tasks with its "?" and, once ended, estimate → actual: RunEstimate.tsx, ADR 0087; the effort is the agent profile's, #75) stay on screen
// collapsed too, and a decision waiting is one "Ti aspetta" pill that opens it in the questions window (popups on or
// off); the inline panels show only on the expanded strip. A strip that drives browsers carries a small globe button: its
// browsers stay folded until it is pressed, then sit beside the chat (on a collapsed strip it expands it too; AgentStrips.tsx).
// An expanded chat also shows the open requests of the chats it delegated (lib/child-requests.ts), each tagged with the
// role and task that asks: answering goes to that child, which then goes on (ADR 0083). A Strategist's plan with the
// user (its questions, the plan to approve, the steps' checklist) sits under the head, collapsed too (StrategyPanel.tsx, ADR 0108).
import { t as auditText } from '../i18n';
import { memo, useEffect, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { chatCost, queueReason, folderName, minutes, permissionBadge, modelWithEffort, stateInfo, workTime } from '../lib/format';
import { useNow } from '../lib/clock';
import { COMPACT_TILE_H } from '../lib/grid';
import { isBusy, sameList } from '../store/state';
import { closeChat, send, stop, useApp } from '../store/store';
import { callQuestions, setBrowserOpen, setFocused, setFocusMode, setChatExpanded, ui } from '../store/ui';
import {t}from'../i18n';
import {schedule,suspendViews}from'../lib/viewports';
import { answerLater, openQueue } from '../lib/later';
import { admitNow, reqKey, toggleMaximize } from '../actions';
import { pairHover, usePair } from '../lib/pairs';
import { selectedHere } from '../lib/strip-click';
import { StripEstimate } from './RunEstimate';
import { ChatLinkChips } from './ChatLinkChips';
import { AgentIdentity } from './AgentIdentity';
import { AgentAvatar } from './AgentAvatar';
import { RunChips, RunOutcomeControl } from './RunSurface';
import { AutoCloseNotice } from './AutoCloseNotice';
import { ChatLinks, ContextMeter, ContextNotice, useWarnTokens } from './ContextBar';
import { HelpTip } from './HelpTip';
import { StripActivity } from './StripActivity';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { ChatMenu, TitleInput } from './ChatMenu';
import { RequestPanel } from './RequestPanel';
import { StrategyPanel, planQuestion } from './StrategyPanel';
import { InWindowLine } from './QuestionsWindow';
import { questionsModalOn } from '../lib/questions';
import { childRequestsFor, requestHost, type ChildRequest } from '../lib/child-requests';
import { IconAlert, IconChevronDown, IconGlobe, IconMaximize, IconMinimize, IconMore, IconStop, IconX } from './Icons';
import { IconButton, StatePill, useSize } from './ui';

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

export const ChatTile = memo(function ChatTile({ chatId, index, maximized, focus, embedded }: { chatId: string; index?: number; maximized?: boolean; focus?: boolean; embedded?: boolean }) {
  const chat = useApp(s => s.chats[chatId]);
  const reqs = useApp(s => pendingOf(s.pending, chatId), sameList);
  // each request shows once (lib/child-requests.ts requestHost): here only when this view is the one that holds it
  const expandedAll = ui.use(s => s.prefs.chatExpanded), focusModeId = ui.use(s => s.focusMode), maxKey = ui.use(s => s.maximized);
  const view = { expanded: expandedAll, focusMode: focusModeId, maximized: maxKey };
  const childReqs = useApp(s => childRequestsFor(chatId, s.chats, s.pending).filter(c => requestHost(c.req.chatId, s.chats, view) === chatId), sameAsks);
  const hostsOwn = useApp(s => requestHost(chatId, s.chats, view) === chatId || !!focus);
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
  const expandedChoice=ui.use(s=>s.prefs.chatExpanded[chatId]===true);
  const expanded=!!maximized||!!focus||!!embedded||expandedChoice;
  const expansionButton=useRef<HTMLButtonElement>(null);
  const downSelection=useRef('');
  const reveal=(compose=false)=>{setChatExpanded(chatId,true);if(compose)requestAnimationFrame(()=>input.current?.focus());};
  useEffect(()=>{const release=suspendViews();schedule();const timer=setTimeout(()=>{release();schedule();},window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);return()=>{clearTimeout(timer);release();};},[expanded]);
  // the long-chat notice, hidden by the user until the context grows by another quarter of the threshold
  const warn = useWarnTokens();
  const lqCpu = useApp(s => s.settings?.loadQueueCpu ?? 75);
  const lqRam = useApp(s => s.settings?.loadQueueRam ?? 15);
  const size = useSize(ref);
  const pair = usePair(chatId);
  const browsers = useApp(s => s.tabs.filter(tab => tab.ownerChatId === chatId).length);
  const browserShown = ui.use(s => s.prefs.browserOpen[chatId] === true && s.prefs.chatExpanded[chatId] === true);
  const now = useNow(15_000); // the running work span grows on screen
  useEffect(() => {
    if (!focusReq) return;
    reveal(true);
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusReq]);
  if (!chat) return null;
  const compact = !expanded || !maximized && !focus && !embedded && size.height > 0 && size.height < COMPACT_TILE_H;
  const smallPanel = !maximized && !focus && !embedded && size.height > 0 && size.height < 440;
  const busy = isBusy(chat);
  const st = stateInfo(chat);
  const queueLimits = { cpu: lqCpu, ram: lqRam };
  // no per-chat effort control here (#75): the agent's profile decides it; the effort in use is shown read only (#100)
  const sub = [modelWithEffort(chat), chatCost(chat)].filter(Boolean).join(' · ');
  const folder = folderName(chat.cwd);
  const perm = permissionBadge(chat.permissionMode);
  const work = workTime(chat, now);
  const strip = !focus && !maximized && !embedded;
  // a click on the strip itself (not on one of its controls, nor inside a portalled menu) expands or collapses it
  const onStripClick = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.target as Element;
    if (!strip || !e.currentTarget.contains(el) || el.closest('button, a, input, textarea, select, summary, label, [role="menu"], [contenteditable="true"], .chat-topic')) return;
    if (selectedHere(window.getSelection(), e.currentTarget, downSelection.current)) return; // selecting text is not a click
    if (!expanded) setChatExpanded(chatId, true);
    else if (el.closest('.tile-head')) setChatExpanded(chatId, false);
  };
  const first = reqs[0] ? reqKey(reqs[0]) : null;
  // a Strategist's open question shows in its plan card, on the strip itself (ADR 0108), not again below
  const planAsk = planQuestion(chat, reqs, inWindow, !!queued);
  const ownReqs = planAsk ? reqs.filter(r => r !== planAsk) : reqs;
  return (
    <section ref={ref} className={`tile chat-tile ${expanded?'is-expanded':'is-strip'} tone-${st.tone} ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${compact ? 'compact' : ''} ${closing ? 'closing' : ''} ${pair.cls}${embedded ? ' is-embedded' : ''}`} style={pair.style} role="region"
      aria-label={auditText('auditExpression.ChatTile.text20', { v0: chat.title, v1: st.label })} data-testid={`tile-chat-${chatId}`} data-chat-id={chatId} data-sb-id={`chat-${chatId}`} data-chat-index={index} data-state={chat.state}
      onClick={onStripClick} onFocus={() => setFocused(key)} onPointerDown={() => { downSelection.current = window.getSelection()?.toString() ?? ''; setFocused(key); }} {...pairHover(chatId)} data-pair={pair.index ?? undefined}>
      {!embedded && <header className="tile-head">
        <div className="th-row">
          <AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name||chat.title} size={24}/>
          <h3 className="th-title" title={chat.agent?.purpose||chat.title}>{chat.agent?.name||chat.title}</h3>
          {/* the pill takes the state's place; the state stays in the DOM (hidden) as the strip's data-state hook */}
          {first ? <span hidden><StatePill chat={chat} testid={`chat-state-${chatId}`} /></span> : <StatePill chat={chat} testid={`chat-state-${chatId}`} />}
          {first && <button type="button" className="strip-wait" onClick={() => (queued ? openQueue(first) : callQuestions(first))} aria-label={t('product.waitsYouOpen', { title: chat.agent?.name || chat.title })} data-testid={`chat-wait-${chatId}`} data-state={chat.state} {...(expanded ? {} : { 'data-waits-keys': reqs.map(reqKey).join(' ') })}>
            <span className="strip-wait-dot" aria-hidden="true" />{t('product.waitsYou')}{reqs.length > 1 && <b>{reqs.length}</b>}
          </button>}
          {chat.resumedAt && (
            <span className="th-resumed" data-tip={auditText('audit.ChatTile.itsTurnWasInterruptedByThe')}
              data-testid={`chat-resumed-${chatId}`}>{auditText('audit.ChatTile.resumedAfterRestart')}</span>
          )}
          <div className="chat-header-actions">
          {strip && browsers > 0 && <button type="button" className={`icon-btn chat-browser-toggle${browserShown ? ' on' : ''}`} aria-pressed={browserShown} aria-label={t(browserShown ? 'agentDetail.browserOn' : 'agentDetail.browserOff', { n: browsers })} data-tip={t(browserShown ? 'agentDetail.browserOn' : 'agentDetail.browserOff', { n: browsers })} onClick={() => setBrowserOpen(chatId, !browserShown)} data-testid={`chat-browser-${chatId}`}><IconGlobe size={13} />{browsers > 1 && <span className="chat-browser-n">{browsers}</span>}</button>}
          {strip&&<button ref={expansionButton} type="button" className="icon-btn chat-expand" aria-expanded={expanded} aria-controls={`chat-work-${chatId}`} aria-label={t(expanded?'product.collapse':'product.expand')} data-tip={t(expanded?'product.collapse':'product.expand')} onClick={()=>{setChatExpanded(chatId,!expanded);if(expanded)expansionButton.current?.focus();}} data-testid={`chat-expand-${chatId}`}><IconChevronDown size={14}/></button>}
          {(busy || chat.state === 'waiting') && (
            <IconButton label={t('chat.tile.stop')} shortcut="Ctrl+." tone="danger" onClick={() => void stop(chatId)} testid={`chat-stop-${chatId}`}><IconStop size={14} /></IconButton>
          )}
          <IconButton ref={menuBtn} label={t('chat.tile.menu')} onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu" testid={`chat-menu-${chatId}`}><IconMore /></IconButton>
          <IconButton label={t(maximized ? 'chat.tile.restore' : 'chat.tile.maximize')} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize(key)} testid={`chat-max-${chatId}`}>
            {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </IconButton>
          {!chat.isOrchestrator && <IconButton label={t('chat.tile.close')} shortcut="Ctrl+W" onClick={e => closeFromX(e, () => closeChat(chatId))} testid={`chat-x-${chatId}`}><IconX size={14} /></IconButton>}
          </div>
        </div>
        {expanded && <div className="chat-topic-row">{renaming?<TitleInput chat={chat} onDone={()=>setRenaming(false)}/>:chat.agent?.name&&chat.title!==chat.agent.name?<span className="chat-topic" title={chat.title} onDoubleClick={()=>setRenaming(true)}>{chat.title}</span>:null}<AgentIdentity chat={chat}/></div>}
        {renaming && !expanded && <TitleInput chat={chat} onDone={()=>setRenaming(false)}/>}
        <div className="th-sub strip-facts" data-testid={`chat-sub-${chatId}`}>
          {chat.run && <RunChips run={chat.run} />}
          <span className="th-sub-text">{sub}{work !== null && <>{' · '}<span className="th-work" data-testid={`chat-work-${chatId}`} data-tip={auditText('audit.ChatTile.actualWorkTimeExcludingWaitsFor')}>{auditText('audit.ChatTile.work')}{' '}{minutes(work)}</span></>}{folder ? ` · ${folder}` : ''}</span>
          {chat.run && <StripEstimate chat={chat} busy={busy || chat.state === 'waiting'} workMs={work} />}
          {perm && <span className="th-badge">{perm}</span>}
          <ContextMeter chat={chat} warn={warn} />
          <HelpTip title={t('explain.strip.title')} className="strip-help" guide="grindhouse" testid={`chat-help-${chatId}`}><p>{t('explain.strip.p1')}</p><p>{t('explain.strip.p2')}</p><p>{t('explain.strip.p3')}</p><p>{t('explain.strip.p4')}</p></HelpTip>
        </div>
        {!compact && <ChatLinkChips chatId={chatId} />}
      </header>}
      <AutoCloseNotice chatId={chatId} />
      {!expanded&&<div className="chat-strip-line">{busy?<StripActivity chatId={chatId} testid={`typing-${chatId}`}/>:chat.work?.status==='waiting-mail'?t('product.workWaiting'):chat.lastText.slice(0,140)}</div>}
      {chat.plan && <StrategyPanel chat={chat} question={planAsk} />}
      <div className={`chat-work${expanded?' expanded':''}`} id={`chat-work-${chatId}`} inert={!expanded} aria-hidden={!expanded}><div className="chat-work-inner">
      {!compact && <ChatLinks chat={chat} />}
      {!compact && chat.handoffBusy && <ContextNotice chat={chat} />}
      <ChatTranscript key={chatId} chatId={chatId} busy={busy} expanded={expanded} />
      <ChatInput ref={input} chat={chat} testid={`chat-input-${chatId}`} />
      {expanded && chat.run && <RunOutcomeControl key={`${chat.run.runId}:${chat.run.counters.reopened}`} run={chat.run} disabled={busy || reqs.length > 0 || chat.state === 'waiting' || !!chat.queued} />}
      </div></div>
      {expanded && hostsOwn && ownReqs.length > 0 && (queued ? <InWindowLine reqs={ownReqs} queued testid={`chat-queued-${chatId}`} /> : inWindow ? <InWindowLine reqs={ownReqs} testid={`chat-in-window-${chatId}`} /> : (
        <div className="tile-requests">
          {ownReqs.map(r => <RequestPanel key={r.id} req={r} variant={compact || smallPanel ? 'compact' : 'tile'} chatTitle={chat.title} harness={chat.harness} onLater={answerLater} />)}
        </div>
      ))}
      {expanded && childReqs.length > 0 && (queued ? <InWindowLine reqs={childReqs.map(c => c.req)} queued testid={`chat-child-queued-${chatId}`} /> : inWindow ? <InWindowLine reqs={childReqs.map(c => c.req)} testid={`chat-child-in-window-${chatId}`} /> : (
        <div className="tile-requests child-requests">
          {childReqs.map(({ req, chat: c }) => <div key={`${req.chatId}:${req.id}`} className="child-request pause-panel" data-testid={`child-request-${req.chatId}`}>
            <div className="pause-tag">
              <AgentAvatar avatar={c.agent?.avatar} name={c.agent?.name || c.title} size={28} />
              <span className="pause-who"><b>{t('tree.asks', { role: c.agent?.name || '', title: c.title })}</b> {t('tree.asksVerb')}</span>
              <span className="pause-from">{t('tree.childOfThis', { time: new Date(req.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) })}</span>
            </div>
            <RequestPanel req={req} variant={compact || smallPanel ? 'compact' : 'tile'} chatTitle={c.title} harness={c.harness} onLater={answerLater} />
            <div className="pause-foot">
              <button type="button" className="btn btn-s btn-ghost" data-testid={`child-request-open-${req.chatId}`} onClick={() => setFocusMode(c.id)}><span aria-hidden="true">↗</span> {t('tree.goToOf', { role: c.agent?.name || c.title })}</button>
            </div>
          </div>)}
        </div>
      ))}
      {chat.queued && !chat.closedAt && (
        <div className="queued-bar" data-testid={`chat-queued-${chatId}`}>
          <span className="queued-text" data-tip={auditText('auditExpression.ChatTile.text23', { v0: chat.queued.cpu, v1: chat.queued.freeRam, v2: chat.queued.kind === 'start' ? auditText('auditExpression.ChatTile.text24') : auditText('auditExpression.ChatTile.text25') })}>{auditText('audit.ChatTile.queued')}{' '}{queueReason(chat.queued, queueLimits)} · {chat.queued.position === 1 ? auditText('auditExpression.ChatTile.text26') : auditText('auditExpression.ChatTile.text27', { v0: chat.queued.position })}
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
      <ChatMenu chat={chat} anchor={menuBtn} open={menu} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} />
    </section>
  );
});
