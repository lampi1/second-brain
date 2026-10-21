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
  /** the last of its parent's children (its thread line ends at its elbow) */
  last: boolean;
  /** per level above its own (1 .. depth-1): whether that ancestor's thread line runs on past this row */
  rails: boolean[];
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
  const visit = (id: string, depth: number, parentId: string | null, last: boolean, rails: boolean[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    const children = (kids.get(id) ?? []).filter(c => !seen.has(c));
    out.push({ id, depth, parentId, children, working: children.filter(c => !chats[c]?.closedAt && !chats[c]?.delegation?.result).length, last, rails });
    const below = depth >= 1 ? [...rails, !last] : [];
    children.forEach((c, i) => visit(c, depth + 1, id, i === children.length - 1, below));
  };
  for (const r of roots) visit(r, 0, null, true, []);
  // a cycle in broken data: what is left shows flat rather than vanishing
  for (const id of shown) if (!seen.has(id)) visit(id, 0, null, true, []);
  return out;
}

/** The nodes left on screen when the parents in `collapsed` are folded: their whole subtree is hidden. */
export function visibleTree(nodes: readonly TreeNode[], collapsed: Readonly<Record<string, boolean>>): TreeNode[] {
  const hidden = new Set<string>();
  for (const n of nodes) if (n.parentId && (hidden.has(n.parentId) || collapsed[n.parentId] === true)) hidden.add(n.id);
  return nodes.filter(n => !hidden.has(n.id));
}

export type ChildState = 'start' | 'run' | 'wait' | 'queued' | 'err' | 'stall' | 'refused' | 'done' | 'partial' | 'blocked' | 'noreport' | 'closed';
type StateRow = Pick<ChatSummary, 'state' | 'pending' | 'queued' | 'closedAt' | 'delegation'>;
/** Where a delegated chat stands, for its card (DelegationCard.tsx, the states of the tree design): its result once it
 *  reported; otherwise asking the user, queued, failed, starting, working; a turn that ended without agent_report is
 *  "fermo" (it owes its result), or "permesso negato" when the app refused it a permission above its parent's. */
export function childState(c: StateRow, refused = false): ChildState {
  const r = c.delegation?.result;
  // the app closed it: it ended without agent_report (#152)
  if (r?.noReport) return 'noreport';
  if (r) return r.outcome === 'done' ? 'done' : r.outcome;
  if (c.closedAt || c.state === 'closed') return 'closed';
  if (c.state === 'waiting' || c.pending > 0) return 'wait';
  if (c.queued && c.state !== 'running' && c.state !== 'error') return 'queued';
  if (c.state === 'error') return 'err';
  if (c.state === 'starting') return 'start';
  if (c.state === 'running') return 'run';
  return refused ? 'refused' : 'stall';
}
/** Still on the delegated work (a full thread card); the others fold into a compact row. */
export const activeState = (s: ChildState): boolean => s !== 'done' && s !== 'partial' && s !== 'blocked' && s !== 'noreport' && s !== 'closed';
/** A parent's children counted by state, one source for every counter (KidsBar, the sidebar tree, #152): working,
 *  waiting for the user, stopped (a turn ended without a result or a report, an error, a refused permission), finished. */
export function kidCounts(states: readonly ChildState[]): { run: number; wait: number; stuck: number; done: number } {
  const n = (...of: ChildState[]) => states.filter(s => of.includes(s)).length;
  return { run: n('run', 'start', 'queued'), wait: n('wait'), stuck: n('stall', 'err', 'refused', 'noreport'), done: n('done', 'partial') };
}
