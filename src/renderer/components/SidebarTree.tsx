// The open agents as a tree under the Grindhouse entry of the sidebar (ADR 0083): one compact row per chat (character,
// task name, state dot), delegated chats indented under the chat that launched them, a chevron on each parent that
// folds its children (the same prefs.treeCollapsed as the Grindhouse, so both views agree and the fold survives a
// restart). A click on a row brings that chat on screen (focusChat). Hidden while no agent is open. Mounted by
// Sidebar.tsx.
import type { CSSProperties } from 'react';
import { chatTree, visibleTree } from '../lib/chat-tree';
import { stateInfo } from '../lib/format';
import { useApp } from '../store/store';
import { setTreeCollapsed, ui } from '../store/ui';
import { focusChat } from '../actions';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { IconChevronDown, IconChevronRight } from './Icons';
import '../styles/tree.css';

const MAX_ROWS = 40;

export function SidebarTree() {
  const tree = useApp(s => chatTree(s.order.filter(id => !s.chats[id]?.isOrchestrator), s.chats), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const collapsed = ui.use(s => s.prefs.treeCollapsed);
  const chats = useApp(s => s.chats);
  if (!tree.length) return null;
  const rows = visibleTree(tree, collapsed).slice(0, MAX_ROWS);
  return (
    <ul className="nav-tree" aria-label={t('tree.sidebar')} data-testid="nav-tree">
      {rows.map(n => {
        const c = chats[n.id];
        if (!c) return null;
        const folded = collapsed[n.id] === true, tone = stateInfo(c).tone;
        return <li key={n.id} className={`nav-tree-row depth-${Math.min(n.depth, 4)}`} style={{ '--depth': n.depth } as CSSProperties} data-testid={`nav-tree-${n.id}`} data-depth={n.depth}>
          {n.children.length > 0
            ? <button type="button" className="nav-tree-fold" aria-expanded={!folded} aria-label={t(folded ? 'tree.unfold' : 'tree.fold', { title: c.title })} data-testid={`nav-tree-fold-${n.id}`} onClick={() => setTreeCollapsed(n.id, !folded)}>
              {folded ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
            </button>
            : <span className="nav-tree-fold is-leaf" aria-hidden="true" />}
          <button type="button" className="nav-tree-chat" onClick={() => focusChat(n.id)} aria-label={t('tree.open', { title: c.title })} data-tip={c.agent?.name ? `${c.title}|${c.agent.name}` : c.title}>
            <AgentAvatar avatar={c.agent?.avatar} name={c.agent?.name || c.title} size={16} />
            <span className="nav-tree-title">{c.title}</span>
            <span className={`nav-tree-dot tone-${tone}`} aria-hidden="true" />
          </button>
        </li>;
      })}
    </ul>
  );
}
