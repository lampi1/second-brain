// The open agents as a tree under the Grindhouse entry of the sidebar (ADR 0083; the owner's chosen design,
// sidebar-*.png, 2026-10-19): the Orchestrator on top ("N chat avviate"), then each chat as a two-line row (task name
// and state dot; the role's character and role, and on the right its children "N figli", "Ti aspetta" in amber, or its
// state), delegated chats indented on guide lines under the chat that launched them. A chevron on each parent folds
// its children (the same prefs.treeCollapsed as the Grindhouse's KidsBar, so both views agree and the fold survives a
// restart); a folded parent shows one line with its children's characters and "3 figli · 2 in corso". The chat in view
// is highlighted, finished ones are muted. A click on a row brings that chat's strip or card on screen, expanded and
// briefly highlighted (focusChat). Hidden while no agent is open. Mounted by Sidebar.tsx.
import type { CSSProperties } from 'react';
import type { ChatSummary } from '@shared/contract';
import { chatTree, childState, visibleTree, type ChildState, type TreeNode } from '../lib/chat-tree';
import { useApp } from '../store/store';
import { setTreeCollapsed, ui } from '../store/ui';
import { focusChat } from '../actions';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { IconChevronDown, IconChevronRight } from './Icons';
import '../styles/tree.css';

const MAX_ROWS = 40;
/** the dot's tint by state */
const DOT: Record<ChildState, string> = { start: 'run', run: 'run', wait: 'wait', queued: 'off', err: 'err', stall: 'stall', refused: 'err', done: 'done', partial: 'done', blocked: 'err', closed: 'off' };
const ENDED = new Set<ChildState>(['done', 'partial', 'blocked', 'closed']);
const sameTree = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A root chat's state reads like a child's: waiting, at work, failed, idle (its turn ended: done for now). */
function rowState(c: ChatSummary): ChildState {
  if (c.delegation) return childState(c);
  if (c.closedAt || c.state === 'closed') return 'closed';
  if (c.state === 'waiting' || c.pending > 0) return 'wait';
  if (c.state === 'error') return 'err';
  if (c.state === 'starting') return 'start';
  if (c.state === 'running') return 'run';
  return c.queued ? 'queued' : 'done';
}

export function SidebarTree() {
  const tree = useApp(s => chatTree(s.order.filter(id => !s.chats[id]?.isOrchestrator && !s.chats[id]?.quick), s.chats), sameTree);
  const orch = useApp(s => Object.values(s.chats).find(c => c?.isOrchestrator && !c.closedAt)?.id ?? null);
  const started = useApp(s => tree.filter(n => n.depth === 0 && s.chats[n.id]?.run?.startedBy === 'orchestrator').length);
  const collapsed = ui.use(s => s.prefs.treeCollapsed);
  const focused = ui.use(s => s.focusMode ?? (s.focused?.startsWith('chat:') ? s.focused.slice(5) : null));
  const chats = useApp(s => s.chats);
  if (!tree.length) return null;
  const orchFolded = !!orch && collapsed[orch] === true;
  const rows = orchFolded ? [] : visibleTree(tree, collapsed).slice(0, MAX_ROWS);
  const offset = orch ? 1 : 0;
  return (
    <div className="side-tree" aria-label={t('tree.sidebar')} role="group" data-testid="nav-tree">
      {orch && <div className="tn tn-orch" data-testid="nav-tree-orchestrator">
        <button type="button" className="tn-chev" aria-expanded={!orchFolded} aria-label={t(orchFolded ? 'tree.unfold' : 'tree.fold', { title: 'Orchestrator' })} data-testid="nav-tree-fold-orchestrator" onClick={() => setTreeCollapsed(orch, !orchFolded)}>
          {orchFolded ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
        </button>
        <button type="button" className="tn-main" onClick={() => focusChat(orch)}>
          <span className="tn-task tn-orch-name">Orchestrator</span>
          <span className="tn-who"><AgentAvatar avatar={chats[orch]?.agent?.avatar} name="Orchestrator" size={16} />{t('tree.orchestratorStarted', { n: started })}</span>
        </button>
      </div>}
      {rows.length > 0 && <ul className="tn-list">
        {rows.map(n => <Row key={n.id} node={n} chat={chats[n.id]} chats={chats} folded={collapsed[n.id] === true} on={focused === n.id} offset={offset} />)}
      </ul>}
    </div>
  );
}

function Row({ node, chat, chats, folded, on, offset }: { node: TreeNode; chat: ChatSummary | undefined; chats: Readonly<Record<string, ChatSummary | undefined>>; folded: boolean; on: boolean; offset: number }) {
  if (!chat) return null;
  const state = rowState(chat);
  const kids = node.children.map(id => chats[id]).filter((c): c is ChatSummary => !!c);
  const right = state === 'wait' ? <span className="tn-w">{t('tree.state.wait')}</span>
    : kids.length ? <span className="tn-x">{t('tree.kids', { n: kids.length })}</span>
    : node.depth > 0 || state !== 'done' ? <span className="tn-x">{t(`tree.state.${state}`)}</span> : null;
  const running = kids.filter(k => !ENDED.has(childState(k))).length;
  const level = node.depth + offset;
  return <li className={`tn${on ? ' on' : ''}${ENDED.has(state) ? ' ended' : ''}`} style={{ '--d': level } as CSSProperties} data-testid={`nav-tree-${node.id}`} data-depth={node.depth}>
    {Array.from({ length: level }, (_, k) => <i key={k} className="tn-guide" style={{ '--g': k } as CSSProperties} aria-hidden="true" />)}
    {kids.length > 0
      ? <button type="button" className="tn-chev" aria-expanded={!folded} aria-label={t(folded ? 'tree.unfold' : 'tree.fold', { title: chat.title })} data-testid={`nav-tree-fold-${node.id}`} onClick={() => setTreeCollapsed(node.id, !folded)}>
        {folded ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
      </button>
      : <span className="tn-chev is-leaf" aria-hidden="true" />}
    <button type="button" className="tn-main" onClick={() => focusChat(node.id)} aria-label={t('tree.focus', { title: chat.title })} aria-current={on || undefined}>
      <span className="tn-task">{chat.title}</span>
      <span className={`tn-dot dot-${DOT[state]}`} aria-hidden="true" />
      <span className="tn-who"><AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name || chat.title} size={16} /><span className="tn-role">{chat.agent?.name ?? ''}</span>{right}</span>
    </button>
    {folded && kids.length > 0 && <span className="tn-kids" data-testid={`nav-tree-kids-${node.id}`}>
      <span className="kids-stack" aria-hidden="true">{kids.slice(0, 4).map(k => <AgentAvatar key={k.id} avatar={k.agent?.avatar} name={k.agent?.name ?? ''} size={16} />)}</span>
      <b>{t('tree.kids', { n: kids.length })}</b>{running > 0 && <> · {t('tree.kidsRun', { n: running })}</>}
    </span>}
  </li>;
}
