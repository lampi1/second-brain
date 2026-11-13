// fitDesktop: an agent tab's view inside a tile of any size keeps the DESKTOP aspect, fits, and is centered.
import { describe, expect, it } from 'vitest';
import { DESKTOP, fitDesktop } from '../../src/main/browser/desktop';

describe('fitDesktop', () => {
  it('scales a desktop page down into a small tile, centered', () => {
    expect(fitDesktop({ x: 0, y: 60, width: 790, height: 900 })).toEqual({ bounds: { x: 0, y: 288, width: 790, height: 444 }, scale: 790 / 1920 });
    const tall = fitDesktop({ x: 100, y: 0, width: 960, height: 300 });
    expect(tall.bounds).toEqual({ x: 313, y: 0, width: 533, height: 300 });
    expect(tall.scale).toBeCloseTo(533 / 1920);
  });

  it('is 1:1 in a tile of exactly the desktop size and scales up in a bigger one', () => {
    expect(fitDesktop({ x: 0, y: 0, ...DESKTOP })).toEqual({ bounds: { x: 0, y: 0, ...DESKTOP }, scale: 1 });
    expect(fitDesktop({ x: 0, y: 0, width: 3840, height: 2160 }).scale).toBe(2);
  });

  it('never returns an empty view', () => {
    const r = fitDesktop({ x: 0, y: 0, width: 1, height: 1 });
    expect(r.bounds.width).toBeGreaterThanOrEqual(1);
    expect(r.bounds.height).toBeGreaterThanOrEqual(1);
  });
});
