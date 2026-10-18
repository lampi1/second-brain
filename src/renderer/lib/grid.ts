// Workspace tiles, pure: which tiles are on screen (chats in the given order, each browser right after the chat that
// drives it; a finished chat stays until it closes by itself, lib/autoclose.ts) and the chat-browser pair colors.
// Used by AgentStrips.tsx and lib/pairs.ts; pinned by test/unit/ui-lib.test.ts.
import type { BrowserTab, ChatSummary } from '@shared/contract';

export type TileRef = { kind: 'chat'; id: string } | { kind: 'browser'; id: string };
export const tileKey = (t: TileRef) => `${t.kind}:${t.id}`;

/** Tiles of the workspace (the Orchestrator excluded: it has its own fixed column). */
export function workspaceTiles(order: readonly string[], chats: Readonly<Record<string, ChatSummary>>, tabs: readonly BrowserTab[]): TileRef[] {
  const tiles: TileRef[] = [];
  const placed = new Set<string>();
  const regiaIds = new Set(order.filter(id => chats[id]?.isRegia));
  // the Regia's own tabs come first, so they sit right next to the Regia column
  for (const t of tabs) if (t.ownerChatId && regiaIds.has(t.ownerChatId)) { tiles.push({ kind: 'browser', id: t.id }); placed.add(t.id); }
  for (const id of order) {
    const c = chats[id];
    if (!c || c.isRegia || c.closedAt || c.space === 'app') continue; // closed chats: the palette (Ctrl+K); app chats: their section
    tiles.push({ kind: 'chat', id });
    for (const t of tabs) if (t.ownerChatId === id && !placed.has(t.id)) { tiles.push({ kind: 'browser', id: t.id }); placed.add(t.id); }
  }
  // the user's own or orphaned tabs; never those of a chat of "Migliora l'app" (off the work grid like its chat)
  for (const t of tabs) if (!placed.has(t.id) && !(t.ownerChatId && chats[t.ownerChatId]?.space === 'app')) tiles.push({ kind: 'browser', id: t.id });
  return tiles;
}

/** A chat tile shorter than this renders compact (only its last line): ChatTile.tsx. */
export const COMPACT_TILE_H = 250;

// ---- chat ↔ browser pairs (colors: lib/pairs.ts)

export const PAIR_COLORS = 8;

/** Color slots of the chats that drive (or drove) a browser. Sticky: a chat keeps its slot while it lives, so no other
 *  pair changes color when one closes its tab; a new pair takes the lowest free slot (past 8: one no pair on screen uses, then the least used).
 *  Returns `prev` itself when nothing changed. */
export function pairSlots(prev: ReadonlyMap<string, number>, order: readonly string[], tabs: readonly Pick<BrowserTab, 'ownerChatId'>[]): ReadonlyMap<string, number> {
  const owners = new Set(tabs.map(t => t.ownerChatId).filter((x): x is string => !!x));
  const alive = new Set(order);
  const next = new Map([...prev].filter(([id]) => alive.has(id) || owners.has(id)));
  const fresh = [...order.filter(id => owners.has(id)), ...[...owners].filter(id => !alive.has(id))].filter(id => !next.has(id));
  for (const id of fresh) {
    // a slot on screen now (its chat owns tabs) weighs more than any number of dormant ones
    const cost = new Array<number>(PAIR_COLORS).fill(0);
    for (const [other, v] of next) cost[v]! += owners.has(other) ? 1000 : 1;
    next.set(id, cost.indexOf(Math.min(...cost)));
  }
  return next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v) ? prev : next;
}

/** The color slot of a chat while it owns browser tabs, or null (no tabs: not paired). */
export function pairIndex(slots: ReadonlyMap<string, number>, tabs: readonly Pick<BrowserTab, 'ownerChatId'>[], chatId: string | null | undefined): number | null {
  if (!chatId || !tabs.some(t => t.ownerChatId === chatId)) return null;
  return slots.get(chatId) ?? null;
}
