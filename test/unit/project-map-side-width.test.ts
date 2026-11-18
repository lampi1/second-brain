// Unit tests of the project map's side panel width (issue #443; src/renderer/components/project-map/side-width.ts):
// a width stays inside its limits and leaves the drawing its floor, and the remembered width is read back, whatever
// the storage holds.
import { describe, expect, it } from 'vitest';
import { SIDE, clampSide, readSide, writeSide } from '../../src/renderer/components/project-map/side-width';

const store = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

describe('project map side panel width', () => {
  it('starts wider than before and stays inside its limits', () => {
    expect(SIDE.def).toBeGreaterThan(320);
    expect(clampSide(100)).toBe(SIDE.min); expect(clampSide(5000)).toBe(SIDE.max); expect(clampSide(512.4)).toBe(512);
    expect(clampSide(NaN)).toBe(SIDE.def);
  });
  it('leaves the drawing its floor at any width; a room too small gives the minimum', () => {
    expect(clampSide(700, 900)).toBe(900 - SIDE.canvasMin);
    expect(clampSide(300, 900)).toBe(300);
    expect(clampSide(700, 500)).toBe(SIDE.min);
    expect(clampSide(700, 5000)).toBe(700);
    for (const room of [400, 640, 900, 1400, 2600]) for (const w of [0, SIDE.min, 400, SIDE.max, 9999]) {
      const got = clampSide(w, room);
      expect(got).toBeGreaterThanOrEqual(SIDE.min); expect(got).toBeLessThanOrEqual(SIDE.max);
      if (room >= SIDE.min + SIDE.canvasMin) expect(room - got).toBeGreaterThanOrEqual(SIDE.canvasMin);
    }
  });
  it('remembers the chosen width; anything else stored reads as the default', () => {
    const s = store();
    expect(readSide(s)).toBe(SIDE.def);
    writeSide(s, 533); expect(s.m.get(SIDE.key)).toBe('533'); expect(readSide(s)).toBe(533);
    writeSide(s, 99999); expect(readSide(s)).toBe(SIDE.max);
    for (const bad of ['', 'wide', 'NaN', 'Infinity']) expect(readSide(store({ [SIDE.key]: bad }))).toBe(SIDE.def);
    expect(readSide(store({ [SIDE.key]: '12' }))).toBe(SIDE.min);
    expect(readSide(undefined)).toBe(SIDE.def);
    expect(readSide({ getItem: () => { throw new Error('off'); }, setItem: () => {} })).toBe(SIDE.def);
    expect(() => writeSide({ getItem: () => null, setItem: () => { throw new Error('full'); } }, 400)).not.toThrow();
  });
});
