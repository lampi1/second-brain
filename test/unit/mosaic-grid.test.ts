// Layout invariants for the actual row-major model consumed by AgentsWorkspace; includes narrow and crowded canvases.
import { describe, expect, it } from 'vitest';
import { mosaicGrid, MOSAIC_GAP, MOSAIC_MIN_WIDTH, reorderPane } from '../../src/renderer/lib/mosaic-grid';
import { balancedLayout, paneKeys, reconcileLayout, restoreWorkspace } from '../../src/renderer/lib/agents-layout';

describe('mosaic grid', () => {
  for (const width of [0, 320, 479, 480, 971, 972, 1280, 1440, 1920, 2560]) {
    for (const count of [0, 1, 2, 3, 4, 7, 12, 32, 100]) {
      it(`allocates ${count} non-overlapping cells at ${width}px`, () => {
        const expanded = Array.from({ length: count }, (_, i) => i).filter(i => i % 3 === 1);
        const layout = mosaicGrid(count, width, expanded);
        expect(layout).toEqual(mosaicGrid(count, width, expanded));
        expect(layout.cells).toHaveLength(count);
        expect(new Set(layout.cells.map(c => `${c.column}:${c.row}`)).size).toBe(count);
        const cellWidth = (width - (layout.columns - 1) * MOSAIC_GAP) / layout.columns;
        if (width >= MOSAIC_MIN_WIDTH && count) expect(cellWidth).toBeGreaterThanOrEqual(MOSAIC_MIN_WIDTH);
        const rects = layout.cells.map(cell => ({
          x: (cell.column - 1) * (cellWidth + MOSAIC_GAP),
          y: layout.rows.slice(0, cell.row - 1).reduce((sum, height) => sum + height + MOSAIC_GAP, 0),
          w: cellWidth, h: layout.rows[cell.row - 1]!,
        }));
        if (width > 0) for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
          const r = rects[a]!, s = rects[b]!;
          expect(r.x + r.w <= s.x || s.x + s.w <= r.x || r.y + r.h <= s.y || s.y + s.h <= r.y).toBe(true);
        }
      });
    }
  }
  it('uses fewer, readable columns at desktop widths', () => {
    expect(mosaicGrid(12, 1920).columns).toBe(3);
    expect(mosaicGrid(12, 1800).columns).toBe(3); // 1920 window minus navigation and gutters
    expect(mosaicGrid(12, 1280).columns).toBe(2);
  });
  it('an expanded chat grows its entire row without changing cell ownership', () => {
    const compact = mosaicGrid(7, 1920), expanded = mosaicGrid(7, 1920, [1, 6]);
    expect(compact.rows).toEqual([320, 320, 320]);
    expect(expanded.rows).toEqual([480, 320, 480]);
    expect(expanded.cells).toEqual(compact.cells);
  });
  it('preserves hidden panes, saved order and legacy profiles', () => {
    const keys = ['chat:a', 'browser:a', 'chat:hidden', 'chat:b'];
    const next = reorderPane(keys, 'chat:b', 'chat:a', false);
    expect(next).toEqual(['chat:b', 'chat:a', 'browser:a', 'chat:hidden']);
    expect(paneKeys(restoreWorkspace({ version: 1, root: balancedLayout(next) }))).toEqual(next);
    expect(paneKeys(reconcileLayout(balancedLayout(next), [...keys, 'chat:new'])).slice(0, 4)).toEqual(next);
    expect(reorderPane(keys, 'chat:a', 'missing', true)).toEqual(keys);
    expect(reorderPane(keys, 'chat:a', 'chat:a', true)).toEqual(keys);
  });
});
