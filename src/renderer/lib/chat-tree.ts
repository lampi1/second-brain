// The delegation tree of the open chats (ADR 0083): roots in the Orchestrator's order (lib/agent-order.ts), each chat's
// delegated children (ChatSummary.parentId) right after it in start order, depth first; closed chats are left out. A
// child whose parent is not on screen (closed) counts as a root. A collapsed parent (prefs.treeCollapsed) hides everything
// below it. Pure: used by AgentStrips.tsx (the Grindhouse) and Sidebar.tsx (the tree under Grindhouse); pinned by
// test/unit/chat-tree.test.ts.
import type { ChatSummary } from '@shared/contract';
import { agentOrder } from './agent-order';

export interface TreeNode {
  id: string;
  depth: number;
  parentId: string | null;
  /** direct children on screen */
  children: string[];
  /** of them, still owing their result (open, no agent_report yet) */
  working: number;
}
type Row = Pick<ChatSummary, 'cwd' | 'parentId' | 'closedAt' | 'delegation'>;

export function chatTree(order: readonly string[], chats: Readonly<Record<string, Row | undefined>>): TreeNode[] {
  const shown = order.filter(id => chats[id] && !chats[id]!.closedAt);
  const on = new Set(shown);
  const kids = new Map<string, string[]>();
  for (const id of shown) {
    const p = chats[id]!.parentId;
    if (p && on.has(p) && p !== id) kids.set(p, [...(kids.get(p) ?? []), id]);
  }
  const roots = agentOrder(shown.filter(id => { const p = chats[id]!.parentId; return !p || !on.has(p); }), chats);
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number, parentId: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    const children = kids.get(id) ?? [];
    out.push({ id, depth, parentId, children, working: children.filter(c => !chats[c]?.closedAt && !chats[c]?.delegation?.result).length });
    for (const c of children) visit(c, depth + 1, id);
  };
  for (const r of roots) visit(r, 0, null);
  // a cycle in broken data: what is left shows flat rather than vanishing
  for (const id of shown) if (!seen.has(id)) visit(id, 0, null);
  return out;
}

/** The nodes left on screen when the parents in `collapsed` are folded: their whole subtree is hidden. */
export function visibleTree(nodes: readonly TreeNode[], collapsed: Readonly<Record<string, boolean>>): TreeNode[] {
  const hidden = new Set<string>();
  for (const n of nodes) if (n.parentId && (hidden.has(n.parentId) || collapsed[n.parentId] === true)) hidden.add(n.id);
  return nodes.filter(n => !hidden.has(n.id));
}
