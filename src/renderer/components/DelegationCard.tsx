// The delegation tree in the Grindhouse (ADR 0083; the owner's chosen design, variant A "thread cards", 2026-10-19):
// every delegated chat is a thread card under its parent, on a curved thread line tinted by its state (TreeRails): the
// task first, the role's character with its role, skills, model and time, its live steps ✓ ✱ ✗, a state pill, and what
// it needs (a permission to answer here, its error, the limit it hit, a nudge when it ended a turn without its result);
// a finished one shows its result and the delegation's criteria met or not. A click on the card expands it in place
// into the whole chat (conversation and input, writable like any strip; the card's head and steps stay as its summary),
// a click on the head folds it again; the state is prefs.chatExpanded, kept across restarts like every strip's.
// "Vai alla chat" opens it in focus mode. KidsBar is the parent's summary at the foot of its strip ("4 figli · 2 in
// corso · 1 ti aspetta", the children's characters, one bar segment each, Comprimi / Espandi: prefs.treeCollapsed).
// Mounted by AgentStrips.tsx; the sidebar tree (SidebarTree.tsx) brings a card on screen with focusChat.
import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { useApp, loadItems, answer, send, stop } from '../store/store';
import { setChatExpanded, setFocusMode, setTreeCollapsed, ui } from '../store/ui';
import { sameList } from '../store/state';
import { childState, kidCounts, type ChildState, type TreeNode } from '../lib/chat-tree';
import { runSteps, type RunStep, type StepMark } from '../lib/run-steps';
import { requestHost } from '../lib/child-requests';
import { focusChat, reqKey } from '../actions';
import { useNow } from '../lib/clock';
import { formatCost, modelWithEffort } from '../lib/format';
import { selectedHere } from '../lib/strip-click';
import { t } from '../i18n';
import { openQueue } from '../lib/later';
import { AgentAvatar } from './AgentAvatar';
import { ChatTile, useFlash } from './ChatTile';
import { IconChevronDown, IconChevronRight } from './Icons';
import '../styles/tree.css';

const EMPTY: readonly ChatItem[] = [];
const refusedIn = (items: readonly ChatItem[] | undefined): boolean => (items ?? []).some(i => i.kind === 'system' && i.code === 'aboveParent');
const lastRefusal = (items: readonly ChatItem[] | undefined): string => {
  const r = [...(items ?? [])].reverse().find(i => i.kind === 'system' && i.code === 'aboveParent');
  return r && r.kind === 'system' ? r.text : '';
};
const hhmm = (at: number) => new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
/** "8 s", "4 min", "2 h": how long the delegated work has run (until its result) */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}
/** the pill tone of a child's state (app.css pills) */
const TONE: Record<ChildState, string> = { start: 'run', run: 'run', wait: 'wait', queued: 'off', err: 'err', stall: 'wait', refused: 'err', done: 'done', partial: 'wait', blocked: 'err', noreport: 'err', closed: 'off' };
/** the thread line's and the bar segment's tint */
export const LINE: Record<ChildState, string> = { start: 'run', run: 'run', wait: 'wait', queued: 'off', err: 'err', stall: 'wait', refused: 'err', done: 'done', partial: 'done', blocked: 'err', noreport: 'err', closed: 'off' };

export function ChildPill({ state, testid }: { state: ChildState; testid?: string }) {
  return <span className={`pill pill-${TONE[state]}`} data-testid={testid} data-child-state={state}>{(state === 'run' || state === 'start' || state === 'wait') && <span className="pill-dot" aria-hidden="true" />}{t(`tree.state.${state}`)}</span>;
}

function useChild(chatId: string) {
  const items = useApp(s => s.items[chatId] ?? EMPTY);
  const refused = useApp(s => refusedIn(s.items[chatId]));
  const refusal = useApp(s => lastRefusal(s.items[chatId]));
  const loaded = useApp(s => !!s.items[chatId]);
  const reqs = useApp(s => s.pending.filter(p => p.chatId === chatId), sameList);
  const parentTitle = useApp(s => { const p = s.chats[chatId]?.parentId; return p ? s.chats[p]?.title ?? '' : ''; });
  const parent = useApp(s => { const p = s.chats[chatId]?.parentId; const c = p ? s.chats[p] : undefined; return c ? c.agent?.name || c.title : ''; });
  useEffect(() => { if (!loaded) void loadItems(chatId); }, [chatId, loaded]);
  return { items, refused, refusal, reqs, parent, parentTitle };
}

/** The curved thread lines of a delegated card: the ancestors' lines that run on, then its own elbow, tinted by state. */
export function TreeRails({ node, state }: { node: TreeNode; state: ChildState }) {
  if (!node.depth) return null;
  return <span className="tree-rails" aria-hidden="true">
    {node.rails.map((on, k) => on ? <i key={k} className="tree-rail" style={{ '--level': k } as CSSProperties} /> : null)}
    {!node.last && <i className="tree-rail" style={{ '--level': node.depth - 1 } as CSSProperties} />}
    <i className={`tree-elbow line-${LINE[state]}${node.last ? ' is-last' : ''}`} style={{ '--level': node.depth - 1 } as CSSProperties} />
  </span>;
}

function Who({ chat }: { chat: ChatSummary }) {
  const now = useNow(5_000);
  const role = chat.agent?.name ?? chat.delegation?.role ?? '';
  const skills = chat.run?.tags?.skills ?? [];
  const from = chat.delegation?.at ?? chat.run?.startedAt ?? now, until = chat.delegation?.result?.at ?? chat.closedAt ?? now;
  const model = modelWithEffort(chat);
  return <div className="dc-who">
    <AgentAvatar avatar={chat.agent?.avatar} name={role} size={20} />
    <span className="dc-role">{role}</span>
    {skills.slice(0, 2).map(s => <span key={s} className="dc-chip">{s}</span>)}
    {model && <><span className="dc-sep">·</span><span className="dc-model">{model}</span></>}
    <span className="dc-time">{chat.queued ? '—' : span(until - from)}</span>
  </div>;
}

function Steps({ chat, items, state }: { chat: ChatSummary; items: readonly ChatItem[]; state: ChildState }) {
  const live = state === 'run' || state === 'start';
  const { steps, earlier } = runSteps(items, { live, doneWhen: chat.delegation?.doneWhen, ...(chat.delegation?.result ? { result: chat.delegation.result } : {}) });
  const shown = steps.length ? steps : [{ mark: live ? 'cur' : 'todo', text: t('tree.noSteps') } as RunStep];
  const MARK: Record<StepMark, string> = { done: '✓', cur: '✱', todo: '○', bad: '✗' };
  return <>
    <ul className="dc-steps" aria-label={t('tree.steps')} data-testid={`delegation-steps-${chat.id}`}>
      {shown.map((s, k) => <li key={k} className={`dc-step is-${s.mark}`}>
        <span className="mk" aria-hidden="true">{MARK[s.mark]}</span>
        <span className="dc-step-text" title={s.code ? `${s.text} ${s.code}` : s.text}>{s.text}{s.code && <> <code>{s.code}</code></>}</span>
        <span className="at">{s.mark === 'cur' ? t('tree.now') : s.at ? hhmm(s.at) : ''}</span>
      </li>)}
    </ul>
    {earlier > 0 && <div className="dc-more">{t('tree.more', { n: earlier })}</div>}
  </>;
}

/** What a waiting child asks, answerable from its card: a permission (allow once / deny); a question is answered in
 *  the parent's open chat or in the child's own (the button expands the card). */
function Ask({ req, chatId }: { req: PendingRequest; chatId: string }) {
  const perm = req.type === 'permission';
  return <div className="dc-ask" data-testid={`delegation-ask-${chatId}`} data-waits-keys={reqKey(req)}>
    <div className="dc-k">{req.type === 'command' ? req.title : t(perm ? 'tree.ask.permission' : 'tree.ask.question')}</div>
    <div className="dc-ask-q">{req.questions?.[0]?.question ?? req.title}</div>
    {req.detail && req.detail !== req.title && <div className="dc-ask-why">{req.detail}</div>}
    <div className="dc-act">
      {perm && <>
        <button type="button" className="btn btn-s dc-btn-amber" data-testid={`delegation-allow-${chatId}`} onClick={() => void answer(req, { kind: 'permission', allow: true })}>{t('tree.allowOnce')}</button>
        <button type="button" className="btn btn-s btn-ghost" data-testid={`delegation-deny-${chatId}`} onClick={() => void answer(req, { kind: 'permission', allow: false, message: 'Negato dall’utente.' })}>{t('tree.deny')}</button>
      </>}
      <button type="button" className="btn btn-s dc-btn-quiet" data-testid={`delegation-answer-${chatId}`} onClick={() => openQueue(reqKey(req))}>{t(perm ? 'tree.goTo' : 'tree.answerHere')}</button>
    </div>
  </div>;
}

function Result({ chat }: { chat: ChatSummary }) {
  const r = chat.delegation?.result;
  if (!r) return null;
  return <div className="dc-res" data-testid={`delegation-res-${chat.id}`}>
    <div className="dc-k">{t('tree.result')}</div>
    <p className="dc-res-out">{r.summary}</p>
    {!!r.doneWhen?.length && <ul className="dc-crit">{r.doneWhen.map(x => <li key={x.criterion}><span className={x.met ? 'ok' : 'no'} aria-hidden="true">{x.met ? '✓' : '✗'}</span><span>{x.criterion}</span></li>)}</ul>}
  </div>;
}

function Foot({ chat, children }: { chat: ChatSummary; children?: ReactNode }) {
  const tk = chat.run?.tokens;
  const k = tk ? Math.round((tk.input + tk.output + tk.cacheRead + tk.cacheWrite) / 1000) : null;
  const cost = !k && !chat.costUsd ? t('tree.cleanContext') : [k ? t('tree.tokens', { k: String(k) }) : null, chat.costUsd ? formatCost(chat.costUsd) : null].filter(Boolean).join(' · ');
  return <div className="dc-foot">
    {children ?? <span className="dc-cost">{cost}</span>}
    <button type="button" className="dc-open" data-testid={`delegation-open-${chat.id}`} onClick={() => setFocusMode(chat.id)} aria-label={t('tree.focus', { title: chat.title })}>
      {t('tree.goTo')} <span aria-hidden="true">↗</span>
    </button>
  </div>;
}

/** A delegated chat's thread card; expanded, its whole chat under the card's summary. */
export function DelegationCard({ chatId }: { chatId: string }) {
  const chat = useApp(s => s.chats[chatId]);
  const c = useChild(chatId);
  const open = ui.use(s => s.prefs.chatExpanded[chatId] === true);
  // the question shows on the card only when no open chat holds it (lib/child-requests.ts requestHost: once on screen)
  const expandedAll = ui.use(s => s.prefs.chatExpanded), focusModeId = ui.use(s => s.focusMode), maxKey = ui.use(s => s.maximized);
  const treeCollapsed = ui.use(s => s.prefs.treeCollapsed);
  const hostsAsk = useApp(s => requestHost(chatId, s.chats, { expanded: expandedAll, focusMode: focusModeId, maximized: maxKey, treeCollapsed }) === chatId);
  const flash = useFlash(`chat:${chatId}`);
  const ref = useRef<HTMLElement>(null);
  const down = useRef('');
  useEffect(() => { if (flash) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [flash]);
  if (!chat) return null;
  const state = childState(chat, c.refused);
  const depthHit = chat.limitHit?.kind === 'depth' ? chat.limitHit : undefined;
  // a click on the card (not on one of its controls, nor inside the open chat) expands it; on its head, folds it
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = e.target as Element;
    if (el.closest('button, a, input, textarea, select, label, [role="menu"], [contenteditable="true"], .dc-chat')) return;
    if (selectedHere(window.getSelection(), e.currentTarget, down.current)) return;
    if (!open) setChatExpanded(chatId, true);
    else if (el.closest('.dc-summary')) setChatExpanded(chatId, false);
  };
  const actions = state === 'stall' ? <span className="dc-act">
      <button type="button" className="btn btn-s btn-ghost" data-testid={`delegation-nudge-${chatId}`} onClick={() => void send(chatId, t('tree.nudgeText'))}>{t('tree.nudge')}</button>
      <button type="button" className="btn btn-s dc-btn-quiet" onClick={() => void stop(chatId)}>{t('tree.stop')}</button>
    </span>
    : state === 'err' ? <span className="dc-act"><button type="button" className="btn btn-s btn-ghost" data-testid={`delegation-retry-${chatId}`} onClick={() => void send(chatId, t('tree.retryText'))}>{t('tree.retry')}</button></span>
    : state === 'refused' ? <span className="dc-cost">{t('tree.refusedBy')}</span>
    : state === 'done' || state === 'partial' || state === 'blocked' ? <span className="dc-cost">{t('tree.sentTo', { parent: c.parent })}</span>
    : undefined;
  return <article ref={ref} className={`delegation-card s-${state}${open ? ' is-open' : ''}${flash ? ' flash' : ''}${chat.closedAt ? ' is-ended' : ''}`} data-testid={`delegation-card-${chatId}`}
    data-state={chat.state} data-child-state={state} data-open={open || undefined}
    onClick={onClick} onPointerDown={() => { down.current = window.getSelection()?.toString() ?? ''; }}>
    {chat.parentId && <button type="button" className="dc-parent" data-testid={`delegation-parent-${chatId}`} onClick={() => focusChat(chat.parentId!)}>{t('tree.parentLink', { parent: `${c.parent} · ${c.parentTitle}` })}</button>}
    <div className="dc-summary" title={t(open ? 'tree.foldCard' : 'tree.openCard')}>
      <div className="dc-head">
        <h4 className="dc-title" title={chat.delegation?.goal ?? chat.title}>{chat.title}</h4>
        <ChildPill state={state} testid={`delegation-state-${chatId}`} />
      </div>
      <Who chat={chat} />
      {state !== 'queued' && <Steps chat={chat} items={c.items} state={state} />}
    </div>
    {!open && hostsAsk && c.reqs[0] && <Ask req={c.reqs[0]} chatId={chatId} />}
    {state === 'queued' && <div className="dc-note">{t('tree.queuedNote')}</div>}
    {state === 'err' && <div className="dc-err"><span className="dc-k">{t('tree.error')}</span>{chat.lastError || t('tree.errorNone')}</div>}
    {state === 'refused' && <div className="dc-err" data-testid={`delegation-refused-${chatId}`}><span className="dc-k">{t('tree.error')}</span>{c.refusal}</div>}
    {state === 'stall' && <div className="dc-note"><b>{t('tree.stallNote')}</b> {t('tree.stallNoteB')}</div>}
    {depthHit && <div className="dc-note" data-testid={`delegation-depth-${chatId}`}><b>{t('tree.limit.depth', { limit: depthHit.limit })}.</b> {t('tree.depthNote')}</div>}
    {chat.delegation?.originalGoal && <div className="dc-note" data-testid={`delegation-goal-${chatId}`} title={t('tree.goalWas', { goal: chat.delegation.originalGoal })}><b>{t('tree.goalChanged')}</b> {chat.delegation.goal}</div>}
    <Result chat={chat} />
    {open && <div className="dc-chat" data-testid={`delegation-chat-${chatId}`}><ChatTile chatId={chatId} embedded /></div>}
    <Foot chat={chat}>{actions}</Foot>
  </article>;
}

/** The parent's summary of its children, at the foot of its strip: counts by state, their characters, one segment each,
 *  and the fold (kept across restarts); the limit it hit, when it did. */
export function KidsBar({ chatId }: { chatId: string }) {
  const kids = useApp(s => Object.values(s.chats).filter((c): c is ChatSummary => !!c && c.parentId === chatId && !c.closedAt)
    .sort((a, b) => (a.delegation?.at ?? 0) - (b.delegation?.at ?? 0)), (a, b) => JSON.stringify(a.map(k => [k.id, k.state, k.pending, k.queued, k.delegation?.result?.outcome, k.agent?.avatar])) === JSON.stringify(b.map(k => [k.id, k.state, k.pending, k.queued, k.delegation?.result?.outcome, k.agent?.avatar])));
  const folded = ui.use(s => s.prefs.treeCollapsed[chatId] === true);
  const title = useApp(s => s.chats[chatId]?.title ?? '');
  const limit = useApp(s => s.chats[chatId]?.limitHit);
  if (!kids.length) return null;
  const states = kids.map(k => childState(k));
  const { run, wait, stuck, done } = kidCounts(states);
  return <div className="kids-bar" data-testid={`tree-kids-${chatId}`}>
    <button type="button" className="kids-toggle" aria-expanded={!folded} data-testid={`tree-toggle-${chatId}`} aria-label={t(folded ? 'tree.unfold' : 'tree.fold', { title })} onClick={() => setTreeCollapsed(chatId, !folded)}>
      <span className="kids-chev" aria-hidden="true">{folded ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}</span>
      <span className="kids-parent" title={title}>{title}</span><b>{t('tree.kids', { n: kids.length })}</b><span className="kids-sep">·</span>
      {run > 0 && <span className="kid-sum"><span className="kid-dot run" />{t('tree.kidsRun', { n: run })}</span>}
      {wait > 0 && <span className="kid-sum"><span className="kid-dot wait" />{t('tree.kidsWait', { n: wait })}</span>}
      {stuck > 0 && <span className="kid-sum" data-testid={`tree-kids-stuck-${chatId}`}><span className="kid-dot err" />{t('tree.kidsStuck', { n: stuck })}</span>}
      {done > 0 && <span className="kid-sum"><span className="kid-dot done" />{t('tree.kidsDone', { n: done })}</span>}
      <span className="kids-stack" aria-hidden="true">{kids.slice(0, 5).map(k => <AgentAvatar key={k.id} avatar={k.agent?.avatar} name={k.agent?.name ?? ''} size={18} />)}</span>
      <span className="kids-segs" aria-hidden="true">{states.map((s, i) => <i key={i} className={`seg-${LINE[s]}`} />)}</span>
      <span className="kids-fold">{t(folded ? 'tree.expand' : 'tree.collapse')}</span>
    </button>
    {limit && <span className="pill pill-wait tree-limit" data-testid={`tree-limit-${chatId}`}>{t(`tree.limit.${limit.kind}`, { limit: limit.limit })}</span>}
  </div>;
}
