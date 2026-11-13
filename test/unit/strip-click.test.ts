// A strip click is held back only by a selection the same gesture made inside the strip (lib/strip-click.ts, #78).
import { describe, expect, it } from 'vitest';
import { selectedHere, type SelectionLike } from '../../src/renderer/lib/strip-click';

const inside = { id: 'inside' }, outside = { id: 'outside' };
const tile = { contains: (node: never) => node === (inside as never) };
const sel = (text: string, node: unknown = inside): SelectionLike => ({ isCollapsed: !text, rangeCount: text ? 1 : 0, toString: () => text, getRangeAt: () => ({ commonAncestorContainer: node }) });

describe('selectedHere', () => {
  it('lets a plain click through', () => {
    expect(selectedHere(null, tile, '')).toBe(false);
    expect(selectedHere(sel(''), tile, '')).toBe(false);
  });
  it('lets the click through when text was selected elsewhere before it (the regression)', () => {
    expect(selectedHere(sel('an Orchestrator answer', outside), tile, 'an Orchestrator answer')).toBe(false);
    expect(selectedHere(sel('an Orchestrator answer', outside), tile, '')).toBe(false); // outside the strip
  });
  it('lets the click through when the selection inside the strip predates the gesture', () => {
    expect(selectedHere(sel('old words'), tile, 'old words')).toBe(false);
  });
  it('holds back the click that ends a drag-select inside the strip', () => {
    expect(selectedHere(sel('new words'), tile, '')).toBe(true);
    expect(selectedHere(sel('new words'), tile, 'old words')).toBe(true);
  });
});
