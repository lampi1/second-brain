// Mosaico geometry, pure: which tiles are on screen (chats in creation order, each browser right after the chat that
// drives it; a finished chat stays until it closes by itself, lib/autoclose.ts), the two zones (chats left, browsers right), how many columns/rows fit the area, and where each tile goes (the last row
// stretches so there are no holes). Used by Mosaico.tsx; pinned by test/unit/grid.test.ts.
import type { BrowserTab, ChatSummary } from '@shared/contract';

export type TileRef = { kind: 'chat'; id: string } | { kind: 'browser'; id: string };
export const tileKey = (t: TileRef) => `${t.kind}:${t.id}`;

/** Tiles of the mosaic (Regia excluded: it has its own fixed column). */
export function mosaicTiles(order: readonly string[], chats: Readonly<Record<string, ChatSummary>>, tabs: readonly BrowserTab[]): TileRef[] {
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

/** The Mosaico's two zones: chats (left) and browsers (right, in the same order as their chats). With `hide`
 *  ("Nascondi browser") only the tabs in `keep` (an open hand-off: the user must act there) stay in the zone. */
export function splitZones(tiles: readonly TileRef[], hide: boolean, keep: readonly string[] = []): { chats: TileRef[]; browsers: TileRef[] } {
  const chats = tiles.filter(t => t.kind === 'chat');
  const browsers = tiles.filter(t => t.kind === 'browser' && (!hide || keep.includes(t.id)));
  return { chats, browsers };
}

/** A chat tile shorter than this renders compact (only its last line): ChatTile.tsx. */
export const COMPACT_TILE_H = 250;

/** Columns × rows for n tiles in a w × h area: tiles close to the target aspect, few empty cells, none shorter than
 *  `minH` when it can be avoided (the chat zone passes COMPACT_TILE_H so chats keep their full view). */
export function gridFor(n: number, w: number, h: number, targetAspect = 1.05, minH = 200): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= Math.min(n, 5); cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (w / cols) / (h / rows);
    const empty = cols * rows - n;
    const tooNarrow = w / cols < 260 ? 2 : 0;
    const tooShort = (h - (rows - 1) * 8) / rows < minH ? 2 : 0;
    const score = Math.abs(Math.log(aspect / targetAspect)) + empty * 0.2 + tooNarrow + tooShort;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

export interface Cell { col: number; row: number; span: number }

/** Row-major cells; the last row's tiles share all columns (no holes). Columns/rows are 0-based. */
export function cellsFor(n: number, cols: number): Cell[] {
  const cells: Cell[] = [];
  const rows = Math.max(1, Math.ceil(n / cols));
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    if (row < rows - 1) { cells.push({ col: i % cols, row, span: 1 }); continue; }
    const k = n - (rows - 1) * cols; // tiles in the last row
    const j = i - (rows - 1) * cols;
    const base = Math.floor(cols / k);
    const extra = cols - base * k; // the last `extra` tiles get one more column
    const span = base + (j >= k - extra ? 1 : 0);
    const col = j * base + Math.max(0, j - (k - extra));
    cells.push({ col, row, span });
  }
  return cells;
}

/** Normalised fractions (sum 1) of length n; falls back to equal parts when the stored ones do not fit. */
export function fractions(stored: readonly number[] | undefined, n: number): number[] {
  if (stored && stored.length === n && stored.every(x => Number.isFinite(x) && x > 0)) {
    const sum = stored.reduce((a, b) => a + b, 0);
    return stored.map(x => x / sum);
  }
  return Array.from({ length: n }, () => 1 / n);
}

/** Drag a splitter between part i and i+1 by `delta` (as a fraction of the whole); each part stays ≥ min. */
export function dragSplit(fr: readonly number[], i: number, delta: number, min = 0.12): number[] {
  const out = [...fr];
  const a = out[i];
  const b = out[i + 1];
  if (a === undefined || b === undefined) return out;
  const d = Math.max(min - a, Math.min(b - min, delta));
  out[i] = a + d;
  out[i + 1] = b - d;
  return out;
}

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
