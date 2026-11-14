// The small kit the little people are drawn and moved with (ADR 0295, split out with ADR 0311): shorthands for shapes
// and tracks, a puff and a pop, notes, the hands' reach (two-bone IK, the elbow out) and the shared props' measures.
// Used by lib/agent-sprites.ts (the scenes) and lib/agent-vices.ts (the vices at rest).
import type { Shape } from './character-art';
import { J, WHITE, ink, quaver, sh, type Ease, type Key, type Look, type Node, type Track } from './sprite-rig';

export const COAL = '#191a22';
export const { P, S, C, E } = sh;
export const ring = (x: number, y: number, r: number, c: string, w: number): Shape => ({ r: [x, y, r], c, w });
/** A rounded rectangle as a path. */
export const rr = (x: number, y: number, w: number, h: number, r: number, f: string, o?: number): Shape =>
  P(`M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`, f, o);

export const k = (at: number, p: Omit<Key, 'at'> = {}): Key => ({ at, ...p });
export const loop = (t: number, keys: Key[], d = 0): Track => ({ t, keys, d });
export const once = (t: number, keys: Key[]): Track => ({ t, keys, n: 1 });
/** Hidden, then there at `at` (% of the loop) and away while it fades over `len` %: a spark, a note, a puff. Hidden
 *  from the loop's start to its first moment and after its last one too (at rest, without motion, it is in sight). */
export const puff = (t: number, at: number[], len: number, dx: number, dy: number, s = 1, a?: number): Track => {
  const keys = at.flatMap(h => [k(Math.max(0, h - 0.2), { o: 0, e: 'hold' }), k(h, { o: 1, e: 'out' }), k(Math.min(100, h + len), { o: 0, dx, dy, sx: s, sy: s, ...(a === undefined ? {} : { a }) }),
    ...(h + len + 0.2 < 100 ? [k(h + len + 0.2, { o: 0, e: 'hold' as Ease })] : [])]);
  return loop(t, [...(keys[0]!.at > 0 ? [k(0, { o: 0, e: 'hold' as Ease })] : []), ...keys, ...(keys[keys.length - 1]!.at < 100 ? [k(100, { o: 0 })] : [])]);
};
/** Grows from nothing past its size and settles, stays, fades: a thought, a sparkle. */
export const pop = (t: number, at: number, until: number): Track =>
  loop(t, [k(0, { sx: 0, sy: 0, o: 0, e: 'hold' }), k(at, { sx: 0.2, sy: 0.2, o: 0, e: 'back' }), k(at + 9, { o: 1 }), k(until, { o: 1 }), k(until + 6, { o: 0 }), k(100, { o: 0, sx: 0, sy: 0 })]);
export const notes = (x: number, y: number, t: number, at: [number, number]): Node[] => [
  J(x, y, -8, [ink(quaver(WHITE))], puff(t, [at[0]], 46, 10, -14, 1.15, 12)),
  J(x + 3, y + 9, 6, [ink(quaver(WHITE))], puff(t, [at[1]], 46, 12, -9, 1.15, -10)),
];
export const Z = 'M-2.6 -2.6H2.6L-2.6 2.6H2.6';
export const STAR = 'M0 -5L1.2 -1.2L5 0L1.2 1.2L0 5L-1.2 1.2L-5 0L-1.2 -1.2Z';

// ── reaching: where a hand goes, and the arm that takes it there ──────────────────────────────────────────────────
export const D2R = Math.PI / 180, L1 = 6.6, L2 = 5.9, SHY = 36.3;
/** The right hand's place for a shoulder and elbow angle (the rig's convention: 0 = hanging, clockwise positive). */
export const handOf = (sx: number, a: number, b: number): [number, number] =>
  [32 + sx - L1 * Math.sin(a * D2R) - L2 * Math.sin((a + b) * D2R), SHY + L1 * Math.cos(a * D2R) + L2 * Math.cos((a + b) * D2R)];
/** Two-bone IK for the right arm: the shoulder and elbow angles that put the hand on (x, y), the elbow out. */
export function reach(sx: number, x: number, y: number): { a: number; b: number } {
  const dx = x - (32 + sx), dy = y - SHY, D = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.05), phi = Math.atan2(-dx, dy);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const be = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));
  const opts = [{ a: phi + al, b: -(Math.PI - be) }, { a: phi - al, b: Math.PI - be }].map(o => ({ a: o.a / D2R, b: o.b / D2R }));
  // the elbow goes out, away from the body, as a real arm bends (inward reads as an arm bent backwards)
  // (out and a little down: up at the mouth the elbow points out to the side, down at a table it drops)
  const out = (o: { a: number }) => -Math.sin(o.a * D2R) + 0.8 * Math.cos(o.a * D2R);
  const best = out(opts[0]!) >= out(opts[1]!) ? opts[0]! : opts[1]!;
  return { a: Math.round(best.a * 10) / 10, b: Math.round(best.b * 10) / 10 };
}
export const shOf = (look: Look) => look.build?.sh ?? 7.2;
export const SAND = '#e3b35c', WOOD = '#8a5d38', WOOD_D = '#5e3d22', GLASS = '#dcecf8', BRASS = '#d4a843', BRASS_D = '#9c7a2c', PARCH = '#f1e7cf';
export const HIP_R = { a: -30, b: 62 }, HIP_L = { a: 30, b: -62 };
/** A chess knight 6.8 tall, its ear at 0 0 and its base on y 6.8, the muzzle to the left. */
export const KNIGHT = 'M-2.3 6.8H2.3V6L1.6 5.4C1.8 3.8 2.3 2.6 2.1 1.4C1.9 0.4 1 -0.1 0 0L-0.4 -0.6L-0.8 0.2C-1.6 0.6 -2.3 1.4 -2.5 2.2C-2.6 2.8 -2.2 3.1 -1.7 2.9L-0.7 2.6C-0.6 3.6 -1.2 4.4 -1.5 5.2L-1.6 5.4L-2.3 6Z';

