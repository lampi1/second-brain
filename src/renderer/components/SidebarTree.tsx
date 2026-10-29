// The open agents as a tree under the Grindhouse entry of the sidebar (ADR 0083; the owner's chosen design,
// sidebar-*.png, 2026-10-19): each chat as a two-line row (no Orchestrator row on top: every chat is started by it, the
// owner 2026-10-22: "non serve mettere l'orchestrator") (task name
// and state dot; the role's character and role, and on the right its children "N figli", "Ti aspetta" in amber, or its
// state), delegated chats indented on guide lines under the chat that launched them. A chevron on each parent folds
// its children (the same prefs.treeCollapsed as the Grindhouse's KidsBar, so both views agree and the fold survives a
// restart); a folded parent shows one line with its children's characters and "3 figli · 2 in corso". The chat in view
// is highlighted, finished ones are muted. A click on a row brings that chat's strip or card on screen, expanded and
// briefly highlighted (focusChat); the ✕ on hover closes the chat like its strip's ✕ (6 s Annulla; owner, 2026-10-21). Hidden while no agent is open. Mounted by Sidebar.tsx.
import { memo, type CSSProperties } from 'react';
import type { ChatSummary } from '@shared/contract';
import { childState, kidCounts, visibleTree, type ChildState, type TreeNode } from '../lib/chat-tree';
import { sameTree, sidebarTree } from '../lib/chat-derived';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { setTreeCollapsed, ui } from '../store/ui';
import { focusChat } from '../actions';
import { closeChat } from '../store/store';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { IconChevronDown, IconChevronRight, IconX } from './Icons';
import '../styles/tree.css';

const MAX_ROWS = 40;
/** the dot's tint by state */
const DOT: Record<ChildState, string> = { start: 'run', run: 'run', wait: 'wait', queued: 'off', err: 'err', stall: 'stall', refused: 'err', done: 'done', partial: 'done', blocked: 'err', noreport: 'err', closed: 'off' };
const ENDED = new Set<ChildState>(['done', 'partial', 'blocked', 'noreport', 'closed']);

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
  // one tree per chats object for every subscriber (lib/chat-derived.ts); each row reads only its own chats
  const tree = useApp(s => sidebarTree(s.order, s.chats), sameTree);
  const collapsed = ui.use(s => s.prefs.treeCollapsed);
  const focused = ui.use(s => s.focusMode ?? (s.focused?.startsWith('chat:') ? s.focused.slice(5) : null));
  if (!tree.length) return null;
  const rows = visibleTree(tree, collapsed).slice(0, MAX_ROWS);
  return (
    <div className="side-tree" aria-label={t('tree.sidebar')} role="group" data-testid="nav-tree">
      {rows.length > 0 && <ul className="tn-list">
        {rows.map(n => <Row key={n.id} node={n} folded={collapsed[n.id] === true} on={focused === n.id} />)}
      </ul>}
    </div>
  );
}

const Row = memo(function Row({ node, folded, on }: { node: TreeNode; folded: boolean; on: boolean }) {
  const chat = useApp(s => s.chats[node.id]);
  const kids = useApp(s => node.children.map(id => s.chats[id]).filter((c): c is ChatSummary => !!c), sameList);
  if (!chat) return null;
  const state = rowState(chat);
  const right = state === 'wait' ? <span className="tn-w">{t('tree.state.wait')}</span>
    : kids.length ? <span className="tn-x">{t('tree.kids', { n: kids.length })}</span>
    : node.depth > 0 || state !== 'done' ? <span className="tn-x">{t(`tree.state.${state}`)}</span> : null;
  const running = kidCounts(kids.map(k => childState(k))).run;
  const level = node.depth;
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
    <button type="button" className="tn-close" onClick={e => { if (e.detail <= 1) closeChat(node.id); }} aria-label={t('tree.close', { title: chat.title })} data-tip={t('tree.close', { title: chat.title })} data-testid={`nav-tree-close-${node.id}`}><IconX size={11} /></button>
    {folded && kids.length > 0 && <span className="tn-kids" data-testid={`nav-tree-kids-${node.id}`}>
      <span className="kids-stack" aria-hidden="true">{kids.slice(0, 4).map(k => <AgentAvatar key={k.id} avatar={k.agent?.avatar} name={k.agent?.name ?? ''} size={16} />)}</span>
      <b>{t('tree.kids', { n: kids.length })}</b>{running > 0 && <> · {t('tree.kidsRun', { n: running })}</>}
    </span>}
  </li>;
});
