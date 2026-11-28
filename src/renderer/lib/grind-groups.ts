// The Grindhouse as strips grouped by Strategist (ADR 0366, issue #491; it replaces the benches of ADR 0311): every root
// chat of the delegation tree (lib/chat-tree.ts) is a unit, its lead strip on top and every chat under it as an indented
// strip, the ones that need someone first; the units fall into three sections in this order: «Ti aspetta» (a chat of
// the unit waits for the user or failed), «Al lavoro» (something in it really runs a turn: starting, running, queued
// for the machine's load or with its question held by an agent), «Finite oggi» (the rest: ended, idle, stalled or
// restored closed after a restart; only the units that stopped today, local time). Inside a section the units keep the
// Orchestrator's order. A unit leaves «Al lavoro» only after a stop longer than the hold
// of lib/steady.ts (holdStatuses), so a gap between two turns never moves it. Pure: used by AgentStrips.tsx; pinned by
// test/unit/grind-groups.test.ts.
import { heldBy } from '@shared/question-ladder';
import type { ChildState, TreeNode } from './chat-tree';
import { stateInfo } from './format';
import { HOLD_MS } from './steady';

/** wait = the user is needed (a question, an error) · work = a turn really runs · done = ended, idle or stopped */
export type GrindStatus = 'wait' | 'work' | 'done';
export const SECTION_ORDER: readonly GrindStatus[] = ['wait', 'work', 'done'];
const RANK: Record<GrindStatus, number> = { wait: 0, work: 1, done: 2 };

/** One chat under the lead with the chats it delegated in turn, in the order they show (the last of a list ends its
 *  tree line at its elbow). */
export interface GrindKid { id: string; kids: GrindKid[] }
export interface GrindUnit { lead: string; kids: GrindKid[]; status: GrindStatus }
export interface GrindSection { id: GrindStatus; units: GrindUnit[] }

type RootRow = Parameters<typeof stateInfo>[0] & { questions?: Parameters<typeof heldBy>[0]['questions']; background?: number };
/** A root chat's status (lib/format.ts stateInfo): waiting or failed → wait; running (or its sub-agents are), starting,
 *  queued for the machine's load, or its question held by an agent → work; anything else → done: ended, idle, and a
 *  chat restored as «closed» after a restart (manager-persistence.ts) with no turn running. */
export function rootStatus(c: RootRow): GrindStatus {
  const { tone } = stateInfo(c);
  if (tone === 'wait' || tone === 'err') return 'wait';
  if (tone === 'run') return 'work';
  if (c.closedAt) return 'done';
  const state = c.state === 'running' && c.turnClosing ? 'idle' : c.state;
  if (state === 'starting' || (c.queued && state !== 'running' && state !== 'error') || heldBy({ ...c, state })) return 'work';
  return 'done';
}

const KID_WORK = new Set<ChildState>(['start', 'run', 'queued', 'heldParent', 'heldOrchestrator']);
/** A delegated chat's status from its delegation state (lib/chat-tree.ts childState): a question or an error → wait;
 *  starting, running, queued or held by an agent → work; a result, an archive, «fermo» (a turn ended owing its report)
 *  or a refused permission → done, with its own word on the strip. */
export function kidStatus(s: ChildState): GrindStatus {
  if (s === 'wait' || s === 'err') return 'wait';
  return KID_WORK.has(s) ? 'work' : 'done';
}

/** The ids of a list of kids, depth first. */
export const ids = (kids: readonly GrindKid[]): string[] => kids.flatMap(k => [k.id, ...ids(k.kids)]);

/** How many chats a list of kids holds, theirs included. */
export const kidCount = (kids: readonly GrindKid[]): number => kids.reduce((n, k) => n + 1 + kidCount(k.kids), 0);

/** The sections of the Grindhouse, empty ones left out. `nodes` is the tree in its order (roots in the Orchestrator's
 *  order, each subtree right after its root); a node whose root is not in `nodes` is a root of its own. `endedAt` (with
 *  `since`) gives when a chat last stopped: a finished unit whose chats all stopped before `since` is left out (the
 *  sidebar still lists it). */
export function grindSections(nodes: readonly TreeNode[], statusOf: (id: string) => GrindStatus, endedAt?: (id: string) => number, since?: number): GrindSection[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const units: GrindUnit[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id) || (n.parentId && byId.has(n.parentId))) continue;
    seen.add(n.id);
    let worst = statusOf(n.id);
    // siblings by status (the ones that need someone first, then at work, then ended), each with its own subtree
    const walk = (parent: TreeNode): GrindKid[] => {
      const children = parent.children.map(id => byId.get(id)).filter((c): c is TreeNode => !!c && !seen.has(c.id))
        .map((c, i) => ({ c, i, s: statusOf(c.id) })).sort((a, b) => RANK[a.s] - RANK[b.s] || a.i - b.i);
      for (const { c } of children) seen.add(c.id);
      return children.map(({ c, s }) => {
        if (RANK[s] < RANK[worst]) worst = s;
        return { id: c.id, kids: walk(c) };
      });
    };
    const kids = walk(n);
    if (worst === 'done' && endedAt && since !== undefined && Math.max(endedAt(n.id), ...ids(kids).map(endedAt)) < since) continue;
    units.push({ lead: n.id, kids, status: worst });
  }
  return SECTION_ORDER.map(id => ({ id, units: units.filter(u => u.status === id) })).filter(s => s.units.length > 0);
}

/** What the screen shows for each chat when its status changes: entering «work» or «wait» shows at once; leaving
 *  «work» waits `ms` (a gap between two turns) and shows only if it lasts. `memory` keeps, per chat, when it left work
 *  (mutated); the result has the statuses to show and when to look again (null = nothing held). */
export function holdStatuses(current: Readonly<Record<string, GrindStatus>>, memory: Map<string, { shown: GrindStatus; leftAt: number | null }>, now: number, ms = HOLD_MS): { shown: Record<string, GrindStatus>; wakeAt: number | null } {
  const shown: Record<string, GrindStatus> = {};
  let wakeAt: number | null = null;
  for (const [id, s] of Object.entries(current)) {
    const m = memory.get(id);
    if (!m || s !== 'done' || m.shown !== 'work') {
      memory.set(id, { shown: s, leftAt: null });
      shown[id] = s;
      continue;
    }
    // it was at work and now reads as ended: held until the stop lasts `ms`
    const leftAt = m.leftAt ?? now;
    if (now - leftAt >= ms) { memory.set(id, { shown: s, leftAt: null }); shown[id] = s; continue; }
    memory.set(id, { shown: 'work', leftAt });
    shown[id] = 'work';
    wakeAt = Math.min(wakeAt ?? Infinity, leftAt + ms);
  }
  for (const id of [...memory.keys()]) if (!(id in current)) memory.delete(id);
  return { shown, wakeAt };
}

/** The chats in the order the page shows them, for Ctrl+2…9 (actions.ts focusTile): each lead, then its kids, except
 *  the kids of a finished unit still folded (`unfolded` = the leads of «Finite oggi» whose helpers are shown). */
export function visualOrder(sections: readonly GrindSection[], unfolded: ReadonlySet<string>): string[] {
  return sections.flatMap(sec => sec.units.flatMap(u => [u.lead, ...(sec.id !== 'done' || unfolded.has(u.lead) ? ids(u.kids) : [])]));
}
