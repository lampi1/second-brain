// The role characters (src/renderer/lib/character-art.ts, src/shared/characters.ts): one per role and Pulse, each with
// its own badge colour and silhouette, trusted shapes only (no links, images or external references) that stay inside
// the 64 × 64 badge, and a small variant without the prop.
import { describe, expect, it } from 'vitest';
import { ROLE_IDS } from '../../src/shared/roles';
import { CHARACTER_IDS, CHARACTER_LOOKS, characterOf } from '../../src/shared/characters';
import { CHARACTERS, characterShapes, characterSvg, shapeSvg, type Shape } from '../../src/renderer/lib/character-art';

/** Every point a shape touches: path coordinates (absolute commands only) and the extents of circles and ellipses. */
function points(s: Shape): [number, number][] {
  if ('c' in s && Array.isArray(s.c)) { const [x, y, r] = s.c; return [[x - r, y - r], [x + r, y + r]]; }
  if ('r' in s) { const [x, y, r] = s.r, k = r + s.w / 2; return [[x - k, y - k], [x + k, y + k]]; }
  if ('e' in s) { const [x, y, rx, ry] = s.e; return [[x - rx, y - ry], [x + rx, y + ry]]; }
  const d = 'p' in s ? s.p : 's' in s ? s.s : '', out: [number, number][] = [];
  let x = 0, y = 0;
  for (const [, cmd = '', args = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === 'Z') continue;
    if (cmd === 'H') { for (const v of n) out.push([x = v, y]); continue; }
    if (cmd === 'V') { for (const v of n) out.push([x, y = v]); continue; }
    if (!'MLCQ'.includes(cmd)) throw Error(`relative or unsupported path command ${cmd} in ${d}`);
    for (let i = 0; i + 1 < n.length; i += 2) out.push([x = n[i]!, y = n[i + 1]!]);
  }
  return out;
}
const silhouette = (id: keyof typeof CHARACTERS) => JSON.stringify([CHARACTERS[id].back ?? [], CHARACTERS[id].head]);
const box = (id: keyof typeof CHARACTERS) => {
  const ps = [...(CHARACTERS[id].back ?? []), ...CHARACTERS[id].head].flatMap(points);
  return [Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))];
};

describe('role characters', () => {
  it('draws every role and Pulse, each described for its label', () => {
    for (const id of ROLE_IDS) expect(CHARACTER_IDS).toContain(id);
    expect(Object.keys(CHARACTERS).sort()).toEqual([...CHARACTER_IDS].sort());
    for (const id of CHARACTER_IDS) expect(CHARACTER_LOOKS[id].length).toBeGreaterThan(10);
    expect(characterOf('not-a-role')).toBe('scout');
    expect([characterOf('judge'), characterOf('scribe'), characterOf('router')]).toEqual(['sentinel', 'artisan', 'orchestrator']); // retired roles (ADR 0100)
  });

  it('gives each character its own badge colour, silhouette and prop', () => {
    const ids = [...CHARACTER_IDS];
    expect(new Set(ids.map(id => CHARACTERS[id].bg[0])).size).toBe(ids.length);
    expect(new Set(ids.map(silhouette)).size).toBe(ids.length);
    expect(new Set(ids.map(id => JSON.stringify(CHARACTERS[id].prop))).size).toBe(ids.length);
    // the outlines differ in shape, not only in colour: no two silhouettes share the same bounding box
    for (const a of ids) for (const b of ids) if (a < b) {
      const [p, q] = [box(a), box(b)];
      expect(Math.max(...p.map((v, i) => Math.abs(v - q[i]!))), `${a} vs ${b}`).toBeGreaterThan(1);
    }
  });

  it('holds only trusted shapes: no links, images or external references', () => {
    for (const id of CHARACTER_IDS) {
      const json = JSON.stringify(CHARACTERS[id]);
      expect(json).not.toMatch(/href|<image|url\(|javascript:|<script/i);
      for (const s of [...characterShapes(id, false), ...characterShapes(id, true)]) {
        expect(shapeSvg(s)).not.toMatch(/href|<image|url\(/i);
        for (const c of Object.values(s).filter((v): v is string => typeof v === 'string' && v.startsWith('#'))) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
      // the only references are the badge's own gradient and clip
      expect(characterSvg(id, 40, 'x').match(/url\([^)]*\)/g)).toEqual(['url(#cx)', 'url(#gx)']);
      expect(characterSvg(id, 40, 'x')).not.toMatch(/href|<image/i);
    }
  });

  it('keeps every point inside the 64 × 64 view box', () => {
    for (const id of CHARACTER_IDS) for (const s of characterShapes(id, false)) for (const [x, y] of points(s)) {
      expect(x, `${id} ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(0);
      expect(x, `${id} ${JSON.stringify(s)}`).toBeLessThanOrEqual(64);
      expect(y, `${id} ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(0);
      expect(y, `${id} ${JSON.stringify(s)}`).toBeLessThanOrEqual(64);
    }
  });

  it('draws the small variant closer and without the prop or face details', () => {
    for (const id of CHARACTER_IDS) {
      const full = characterShapes(id, false), small = characterShapes(id, true);
      expect(small.length).toBeLessThan(full.length);
      for (const p of CHARACTERS[id].prop) expect(small).not.toContainEqual(p);
      expect(characterSvg(id, 16, 'x')).toContain('viewBox="10 8 44 44"');
      expect(characterSvg(id, 96, 'x')).toContain('viewBox="0 0 64 64"');
    }
  });
});
