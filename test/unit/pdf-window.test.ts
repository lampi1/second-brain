// The PDF viewer keeps a drawn canvas only for the pages near the viewport and a few around them, never more than
// PDF_DRAWN, so a long PDF scrolled end to end holds a bounded number of page bitmaps (PR 23 review, finding 1).
import { expect, it } from 'vitest';
import { pdfPagesToDraw, samePages, PDF_AROUND, PDF_DRAWN } from '../../src/renderer/brain/lib/pdf-window';

const list = (near: number[], total: number, around?: number, max?: number) => [...pdfPagesToDraw(near, total, around, max)];

it('draws the pages near the viewport and a few on each side, nothing when none is near', () => {
  expect(list([], 300)).toEqual([]);
  expect(list([10, 11], 300, 2, 8)).toEqual([8, 9, 10, 11, 12, 13]);
  expect(list([1], 1)).toEqual([1]);
});

it('gives the room cut off at the start or the end of the document to the other side', () => {
  expect(list([1, 2], 300, 2, 8)).toEqual([1, 2, 3, 4]);
  expect(list([1, 2], 300, 4, 8)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(list([299, 300], 300, 2, 8)).toEqual([297, 298, 299, 300]);
  expect(list([2, 3], 4, 2, 8)).toEqual([1, 2, 3, 4]);
});

it('never draws more than the cap: too many near pages keep the middle ones, around the viewport', () => {
  expect(list([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 300, 2, 8)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  expect(list([5, 6, 7], 300, 5, 4)).toEqual([4, 5, 6, 7]);
  expect(list([5], 300, 2, 0)).toEqual([]);
});

it('ignores page numbers outside the document', () => {
  expect(list([0, -1, 301, 1.5, Number.NaN], 300)).toEqual([]);
  expect(list([300, 301], 300, 1, 8)).toEqual([299, 300]);
});

it('scrolling a 300-page PDF end to end never holds more than PDF_DRAWN drawn pages, and frees each page it leaves', () => {
  const total = 300; let drawn = new Set<number>(), released = 0, most = 0;
  for (let top = 1; top <= total; top++) {
    // about three pages within the observer's margin at a time, as on a 150 % display
    const near = [top, top + 1, top + 2].filter(n => n <= total);
    const next = pdfPagesToDraw(near, total);
    for (const n of drawn) if (!next.has(n)) released++;
    for (const n of near) expect(next.has(n)).toBe(true);
    drawn = next; most = Math.max(most, drawn.size);
  }
  expect(most).toBeLessThanOrEqual(PDF_DRAWN);
  expect(most).toBe(3 + 2 * PDF_AROUND);
  // every page but the last few drawn was released on the way down
  expect(released).toBe(total - drawn.size);
});

it('tells when the drawn pages did not change, so the viewer keeps its state', () => {
  expect(samePages(new Set([1, 2]), new Set([2, 1]))).toBe(true);
  expect(samePages(new Set([1, 2]), new Set([1, 3]))).toBe(false);
  expect(samePages(new Set([1]), new Set([1, 2]))).toBe(false);
});
