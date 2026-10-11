// Mosaico geometry, pure: which tiles are on screen (chats in creation order, each browser right after the chat that
// drives it, finished chats folded away), how many columns/rows fit the area, and where each tile goes (the last row
// stretches so there are no holes). Used by Mosaico.tsx; pinned by test/unit/grid.test.ts.
import type { BrowserTab, ChatSummary } from '@shared/contract';

export type TileRef = { kind: 'chat'; id: string } | { kind: 'browser'; id: string };
export const tileKey = (t: TileRef) => `${t.kind}:${t.id}`;

/** A finished chat leaves the mosaic this long after its last update (auto-tidy), unless pinned or focused. */
export const FOLD_AFTER_MS = 10 * 60_000;

export function isFinished(c: ChatSummary): boolean {
  return !c.isRegia && (c.state === 'idle' || c.state === 'closed') && c.pending === 0;
}

export function isFolded(c: ChatSummary, now: number, keep: ReadonlySet<string>): boolean {
  return isFinished(c) && now - c.updatedAt > FOLD_AFTER_MS && !keep.has(c.id);
}

/** Tiles of the mosaic (Regia excluded: it has its own fixed column) and the folded chats. */
export function mosaicTiles(order: readonly string[], chats: Readonly<Record<string, ChatSummary>>, tabs: readonly BrowserTab[], now: number, keep: ReadonlySet<string>): { tiles: TileRef[]; folded: ChatSummary[] } {
  const tiles: TileRef[] = [];
  const folded: ChatSummary[] = [];
  const placed = new Set<string>();
  const regiaIds = new Set(order.filter(id => chats[id]?.isRegia));
  // the Regia's own tabs come first, so they sit right next to the Regia column
  for (const t of tabs) if (t.ownerChatId && regiaIds.has(t.ownerChatId)) { tiles.push({ kind: 'browser', id: t.id }); placed.add(t.id); }
  for (const id of order) {
    const c = chats[id];
    if (!c || c.isRegia) continue;
    if (isFolded(c, now, keep)) { folded.push(c); continue; }
    tiles.push({ kind: 'chat', id });
    for (const t of tabs) if (t.ownerChatId === id && !placed.has(t.id)) { tiles.push({ kind: 'browser', id: t.id }); placed.add(t.id); }
  }
  for (const t of tabs) if (!placed.has(t.id)) tiles.push({ kind: 'browser', id: t.id }); // the user's own or orphaned tabs
  folded.sort((a, b) => b.updatedAt - a.updatedAt);
  return { tiles, folded };
}

/** Columns × rows for n tiles in a w × h area: tiles close to the target aspect, few empty cells. */
export function gridFor(n: number, w: number, h: number, targetAspect = 1.05): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= Math.min(n, 5); cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (w / cols) / (h / rows);
    const empty = cols * rows - n;
    const tooNarrow = w / cols < 260 ? 2 : 0;
    const tooShort = h / rows < 200 ? 2 : 0;
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
