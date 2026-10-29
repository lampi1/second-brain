// Values derived from all the chats, computed once per `s.chats` (and `s.order` / `s.tabs`) object and shared by every
// component that selects them (lib/memo.ts has the why: each store notify re-runs every selector, about once a frame
// while a chat streams, and these walk every chat the renderer knows, archived ones included). With the cheap
// equalities below, a notify that changed nothing they read costs a reference compare instead of a tree walk and a
// JSON.stringify per component. Same results as the pure functions they wrap. Used by AgentStrips.tsx, SidebarTree.tsx,
// DelegationCard.tsx (KidsBar), ChatItems.tsx, OrchestratorTile.tsx, TopBar.tsx, UsageBar.tsx; pinned by
// test/unit/chat-derived.test.ts.
import type { BrowserTab, ChatSummary } from '@shared/contract';
import { memoLast, memoPerKey } from './memo';
import { routineChatIds } from './routine-chats';
import { chatTree, type TreeNode } from './chat-tree';
import { workspaceTiles, type TileRef } from './grid';
import { originOf, type ChatOriginLine } from './chat-origin';
import { titlesKey } from './chatrefs';
import { orchestratorTally, type OrchestratorTally } from './orchestrator-tally';
import { isBusy } from '../store/state';

type Chats = Readonly<Record<string, ChatSummary>>;

/** Object.values(chats), one array per chats object. */
export const chatList = memoLast((chats: Chats): ChatSummary[] => Object.values(chats));

/** The routine workers (lib/routine-chats.ts): they live on the Routine page, never in the Grindhouse or the sidebar. */
export const routineIds = memoLast((chats: Chats): Set<string> => routineChatIds(chats));
export const routineIdList = memoLast((chats: Chats): string[] => [...routineIds(chats)]);

/** The Grindhouse's delegation tree (AgentStrips.tsx): every open chat but the routine workers. */
export const stripTree = memoLast((order: readonly string[], chats: Chats): TreeNode[] => {
  const routines = routineIds(chats);
  return chatTree(order.filter(id => !routines.has(id)), chats);
});
/** The Grindhouse's tiles in tree order, browsers under their chats (lib/grid.ts). */
export const stripTiles = memoLast((order: readonly string[], chats: Chats, tabs: readonly BrowserTab[]): TileRef[] =>
  workspaceTiles(stripTree(order, chats).map(n => n.id), chats, tabs, routineIds(chats)));
/** The sidebar's tree (SidebarTree.tsx): no Orchestrator, no Flash, no routine worker. */
export const sidebarTree = memoLast((order: readonly string[], chats: Chats): TreeNode[] => {
  const routines = routineIds(chats);
  return chatTree(order.filter(id => !routines.has(id) && !chats[id]?.isOrchestrator && !chats[id]?.quick), chats);
});
/** browser tab id → the chat that drives it */
export const tabOwners = memoLast((tabs: readonly BrowserTab[]): Readonly<Record<string, string>> =>
  Object.fromEntries(tabs.filter(t => t.ownerChatId).map(t => [t.id, t.ownerChatId!])));

/** Who started a root chat (lib/chat-origin.ts), per chat. */
export const originFor = memoPerKey((chats: Chats, chatId: string): ChatOriginLine | null => originOf(chats[chatId], chatList(chats)));

/** The work chats' titles key (lib/chatrefs.ts titlesKey), for an Orchestrator's «Apri» chips. */
export const titlesKeyOf = memoLast((chats: Chats): string => titlesKey(chats as Record<string, ChatSummary>));

const dayOf = (now: number): number => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const tallyMemo = memoLast((chats: Chats, day: number): OrchestratorTally => orchestratorTally(chatList(chats).filter(c => !!c), day));
/** The Orchestrator's tally of today's chats (lib/orchestrator-tally.ts); a new day counts again. */
export const tallyOf = (chats: Chats, now = Date.now()): OrchestratorTally => tallyMemo(chats, dayOf(now));

/** The first chat in the CPU queue (ADR 0036), archived ones aside. */
export const firstQueuedOf = memoLast((chats: Chats): string | null =>
  chatList(chats).filter(c => c.queued && !c.closedAt).sort((a, b) => a.queued!.position - b.queued!.position)[0]?.id ?? null);
/** Chats at work now (state.ts runningCount). */
export const runningOf = memoLast((chats: Chats): number => chatList(chats).filter(isBusy).length);
/** Chats waiting in the CPU queue, archived ones aside (state.ts queuedCount). */
export const queuedOf = memoLast((chats: Chats): number => chatList(chats).filter(c => c.queued && !c.closedAt).length);

/** A parent's open delegated children, in delegation order (DelegationCard.tsx KidsBar). */
export const openKidsOf = memoPerKey((chats: Chats, parentId: string): ChatSummary[] =>
  chatList(chats).filter(c => !!c && c.parentId === parentId && !c.closedAt).sort((a, b) => (a.delegation?.at ?? 0) - (b.delegation?.at ?? 0)));

// ---------- cheap equalities (in place of JSON.stringify in hot selectors)

const sameArr = <T>(a: readonly T[], b: readonly T[]): boolean => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

export function sameTree(a: readonly TreeNode[], b: readonly TreeNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return x === y || (x.id === y.id && x.depth === y.depth && x.parentId === y.parentId && x.working === y.working && x.last === y.last
      && sameArr(x.children, y.children) && sameArr(x.rails, y.rails));
  });
}

export function sameOrigin(a: ChatOriginLine | null, b: ChatOriginLine | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.at !== b.at) return false;
  return a.kind !== 'app' || b.kind !== 'app' || a.review === b.review;
}

export function sameTally(a: OrchestratorTally, b: OrchestratorTally): boolean {
  return a === b || (a.started === b.started && a.startedUsd === b.startedUsd && a.counts.run === b.counts.run && a.counts.wait === b.counts.wait
    && a.counts.stuck === b.counts.stuck && a.counts.done === b.counts.done);
}
