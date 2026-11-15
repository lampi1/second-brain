// Each role's vice, played at rest (ADR 0311; the owner, 2026-11-14: «ognuno avesse un vizio», then «non mostrarle più
// spesso delle altre ... saranno quelle che si vedono nelle card»): lib/agent-sprites.ts plays it once in a long still
// loop for the state `idle`, which the agent cards show on their front. Drawn with lib/sprite-kit.ts on lib/sprite-rig.ts.
import { shade, type Shape } from './character-art';
import { GOLD, INK, J, WHITE, ink, sh, type Ease, type Look, type Node, type Pose, type Track } from './sprite-rig';
import { COAL, D2R, HIP_L, HIP_R, KNIGHT, L1, L2, SHY, STAR, handOf, k, loop, notes, pop, puff, reach, rr, shOf } from './sprite-kit';
import type { SpriteId } from './agent-sprites';

const { P, S, C, E } = sh;
// ── each role's vice, while it rests (ADR 0311; the owner, 2026-11-14: «ognuno avesse un vizio»): a short gag with a
// prop, never a screen: the wizard's pipe, the Strategist's bullet chess, the Scout's flask, the smith's beer, the
// Sentinel's energy drink (no brand), the Herald's red wine. The hands are two layers, as cut-out animation does it:
// the palm behind the prop, the fingers over it (`grip`); what is drunk goes down sip by sip ──────────────────────────
type AB = { a: number; b: number };
const rot = ([x, y]: [number, number], deg: number): [number, number] => { const r = deg * D2R; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; };
/** The right arm that puts the point `p` of what the hand holds (in the held thing's own frame), turned by `tilt`, on
 *  (x, y) of the picture; `lean`: the figure's own lean, undone first. */
const reachL = (sx: number, x: number, y: number): AB => { const r = reach(sx, 64 - x, y); return { a: -r.a, b: -r.b }; };
const hold = (sx: number, p: [number, number], tilt: number, x: number, y: number, lean = 0): AB => {
  const [ox, oy] = rot(p, tilt), wx = x - ox, wy = y - oy, [lx, ly] = rot([wx - 32, wy - 64.2], -lean);
  return reach(sx, 32 + lx, 64.2 + ly);
};
/** An arm's three tracks through poses: the shoulder, the elbow, and the held thing at its own angle in the picture
 *  (`tilt`, 0 = upright; `lean` undone). */
const armPath = (T: number, keys: [number, AB, number, Ease?][], lean = 0) => ({
  go: loop(T, keys.map(([at, o, , e]) => k(at, { a: o.a, ...(e ? { e } : {}) }))),
  goB: loop(T, keys.map(([at, o, , e]) => k(at, { a: o.b, ...(e ? { e } : {}) }))),
  goH: loop(T, keys.map(([at, o, tilt, e]) => k(at, { a: Math.round(tilt - lean - o.a - o.b), ...(e ? { e } : {}) }))),
});
/** Both elbows of a right hand on (x, y) (the figure's own frame), as [a, b] pairs. */
const elbows = (sx: number, x: number, y: number): AB[] => {
  const dx = x - (32 + sx), dy = y - SHY, D = Math.max(0.3, Math.min(Math.hypot(dx, dy), L1 + L2 - 0.05)), phi = Math.atan2(-dx, dy);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const be = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));
  return [{ a: (phi + al) / D2R, b: -(Math.PI - be) / D2R }, { a: (phi - al) / D2R, b: (Math.PI - be) / D2R }];
};
const near = (v: number, ref: number) => v + 360 * Math.round((ref - v) / 360);
const EASED: Record<Ease, (t: number) => number> = {
  io: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), lin: t => t, hold: () => 0,
  back: t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};
/** An arm's tracks through poses like armPath, but the hand glides between them in a straight line with the eased
 *  timing, every step solved again with the elbow on the side of its two key poses, out to the side (with arms this short a hand
 *  reaches the mouth only with the elbow raised, as one drinks): no arm swinging round a joint, no held thing spinning. `left`: the
 *  poses are the left arm's. */
const armGlide = (T: number, sx: number, keys: [number, AB, number, Ease?][], lean = 0, left = false) => {
  const m = left ? -1 : 1, handAt = (o: AB): [number, number] => { const [x, y] = handOf(sx, m * o.a, m * o.b); return [left ? 64 - x : x, y]; };
  // each key keeps its own pose (elbow out, from hold/reach); between two keys every step takes the elbow nearest to
  // the blend of the two, so the arm never folds the other way on the way (the elbow flipping up by the cheek)
  const solve = (x: number, y: number, ref: AB): AB => {
    const cand = elbows(sx, left ? 64 - x : x, y).map(r => ({ a: near(m * r.a, ref.a), b: near(m * r.b, ref.b) }));
    return cand.sort((p, q) => Math.abs(p.a - ref.a) + Math.abs(p.b - ref.b) - Math.abs(q.a - ref.a) - Math.abs(q.b - ref.b))[0]!;
  };
  const out: [number, AB, number, Ease?][] = [];
  let prev: AB | null = null;
  keys.forEach(([at, o, tilt, e], i) => {
    const here: AB = prev ? { a: near(o.a, prev.a), b: near(o.b, prev.b) } : o, next = keys[i + 1];
    prev = here;
    if (!next || e === 'hold') { out.push([at, here, tilt, e]); return; }
    const to: AB = { a: near(next[1].a, here.a), b: near(next[1].b, here.b) };
    const h0 = handAt(o), h1 = handAt(next[1]), n = Math.min(6, Math.floor(Math.hypot(h1[0] - h0[0], h1[1] - h0[1]) / 1.4));
    out.push([at, here, tilt, n > 1 ? 'lin' : e]);
    for (let j = 1; j < n; j++) {
      const u = EASED[e ?? 'io'](j / n), f = j / n;
      const step = solve(h0[0] + (h1[0] - h0[0]) * u, h0[1] + (h1[1] - h0[1]) * u, { a: here.a + (to.a - here.a) * f, b: here.b + (to.b - here.b) * f });
      out.push([at + ((next[0] - at) * j) / n, step, tilt + (next[2] - tilt) * u, 'lin']);
    }
  });
  let h = 0;
  const held = out.map(([, o, tilt], i) => (h = i ? near(tilt - lean - o.a - o.b, h) : tilt - lean - o.a - o.b));
  const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    go: loop(T, out.map(([at, o, , e]) => k(r2(at), { a: r1(o.a), ...(e ? { e } : {}) }))),
    goB: loop(T, out.map(([at, o, , e]) => k(r2(at), { a: r1(o.b), ...(e ? { e } : {}) }))),
    goH: loop(T, out.map(([at, , , e], i) => k(r2(at), { a: Math.round(held[i]!), ...(e ? { e } : {}) }))),
  };
};
/** Shown from `on` to `off` (% of the loop), hidden otherwise (or the other way round). */
const shown = (T: number, ranges: [number, number][], invert = false): Track => {
  const v = (x: boolean) => ((x !== invert) ? 1 : 0);
  return loop(T, [k(0, { o: v(ranges.some(([a]) => a === 0)), e: 'hold' }), ...ranges.flatMap(([a, b]) => [k(a, { o: v(true), e: 'hold' }), k(b, { o: v(false), e: 'hold' })]), k(100, { o: v(ranges.some(([a]) => a === 0)) })]);
};
/** Where the mouth is, in the picture (the head's box is drawn at 0.56 around its chin). */
const MOUTH: [number, number] = [33.4, 30.6];
/** Eyes shut with pleasure from `from` to `to` (lids of the skin over the eyes, in the head's box). */
const savour = (T: number, skin: string, from: number, to: number): Node => J(0, 0, 0, [E(27.3, 31.9, 2.4, 2.2, skin), E(36.7, 31.9, 2.4, 2.2, skin),
  S('M25.3 32Q27.3 33.6 29.3 32M34.7 32Q36.7 33.6 38.7 32', INK, 1.3)], loop(T, [k(0, { o: 0, e: 'hold' }), k(from, { o: 0 }), k(from + 3, { o: 1 }), k(to, { o: 1 }), k(Math.min(100, to + 3), { o: 0 }), k(100, { o: 0 })]), 1, 0);
/** Rosy cheeks from `from` to `to`. */
const cheeks = (T: number, from: number, to: number): Node => J(0, 0, 0, [E(25.4, 37.4, 2.6, 1.6, '#e8606a'), E(38.6, 37.4, 2.6, 1.6, '#e8606a')],
  loop(T, [k(0, { o: 0, e: 'hold' }), k(from, { o: 0 }), k(from + 8, { o: 0.5 }), k(to, { o: 0.5 }), k(Math.min(100, to + 4), { o: 0 }), k(100, { o: 0 })]), 1, 0);
/** A liquid in a vessel, its bottom at (x, y), `w` wide and `h` tall when full; it goes down to `levels` (0-1) at the
 *  given moments, and is full again at the loop's start. */
const liquid = (T: number, x: number, y: number, w: number, h: number, c: string, steps: [number, number][], r = 0.8): Node =>
  J(x, y, 0, [rr(-w / 2, -h, w, h, r, c)], loop(T, [k(0), ...steps.flatMap(([at, lv]) => [k(at, { sy: lv, e: 'out' })]), k(97, { sy: steps[steps.length - 1]![1], e: 'hold' }), k(100)]));
/** Three fingers across what the hand holds, `w` wide from `x`, from `y` down, in the held frame; a thumb on the other side. */
const fingers = (skin: string, x: number, y: number, w: number, h: number, thumb?: [number, number]): Node[] => [
  ...[0, 1, 2].map(i => rr(x, y + i * h, w, h * 1.08, h * 0.5, skin)),
  S(`M${x + 0.4} ${y + h}H${x + w - 0.3}M${x + 0.4} ${y + h * 2}H${x + w - 0.3}`, shade(skin, 0.28), 0.4),
  ...(thumb ? [S(`M${thumb[0]} ${thumb[1]}l0.2 ${h * 1.6}`, skin, h * 0.95)] : []),
];

export const VICE: Record<Exclude<SpriteId, 'plain'>, (look: Look) => Pose> = {
  // a long churchwarden pipe: the bowl glows on a slow pull, the pipe comes down (a wisp from the bowl), a fat smoke
  // ring blown up and away, then a small quick one right through it and a pleased little nod
  orchestrator: look => {
    const T = 6.6, sx = shOf(look), skin = look.skin;
    // the pipe in the held frame: the fist round the stem at 0 0, the bowl just past it, the mouthpiece far up-left
    const TIP: [number, number] = [-9.4, -7.4];
    const atMouth = hold(sx, TIP, 0, MOUTH[0] + 0.4, MOUTH[1] + 0.3), down = hold(sx, [0, 0], -8, 43.4, 44.6);
    const pipe: Node[] = [
      S(`M3.2 0.9Q1.6 0.4 0 0Q-4.8 -3.2 ${TIP[0]} ${TIP[1]}`, '#8a5a32', 1.15), S(`M-7.9 -6.2L${TIP[0]} ${TIP[1]}`, COAL, 1.2),
      P('M2.3 -2.8H6.3L5.9 1.4Q5.5 3 4.3 3Q3.1 3 2.7 1.4Z', '#7a4a26'), P('M2.3 -2.8H6.3L6.2 -2H2.4Z', '#4a2c16'), S('M3 -1.6V1.4', '#a8743f', 0.5, 0.8),
      J(4.3, -2.8, 0, [E(0, 0, 1.6, 0.5, '#ffb347')], loop(T, [k(0, { o: 0.35 }), k(8, { o: 0.35 }), k(18, { o: 1, sx: 1.2 }), k(28, { o: 0.45 }), k(100, { o: 0.35 })]), 1, 0.35),
      J(4.3, -4, 0, [ink([C(0, 0, 0.7, WHITE, 0.55)])], puff(T, [38, 50, 62, 74], 14, 1.6, -6, 2.2)),
    ];
    const ring_ = (r: number, w: number): Shape => ({ r: [0, 0, r], c: WHITE, w });
    const ring = (start: number, end: number, dx: number, dy: number, s: number, w: number, r: number): Node => J(MOUTH[0] + 1.2, MOUTH[1] - 0.6, 0, [ink([ring_(r, w)])],
      loop(T, [k(0, { o: 0, sx: 0.25, sy: 0.25, e: 'hold' }), k(start, { o: 0, sx: 0.25, sy: 0.18, e: 'out' }), k(start + 5, { o: 0.95, sx: 0.85, sy: 0.7 }), k(end, { o: 0, dx, dy, sx: s, sy: s * 0.8 }), k(100, { o: 0, dx, dy })]), 1, 0);
    return {
      blink: true, mouth: 'flat',
      head: { a: -2, go: loop(T, [k(0), k(8, { a: -6, e: 'io' }), k(24, { a: -6 }), k(34, { a: 3, e: 'out' }), k(46, { a: 1 }), k(64, { a: 4 }), k(72, { a: -4, e: 'back' }), k(80, { a: 2 }), k(90)]),
        over: [cheeks(T, 10, 24)] },
      go: loop(T, [k(0), k(10, { sy: 1.01, e: 'io' }), k(24, { sy: 1.025, dy: -0.3 }), k(36, { sy: 0.99, e: 'out' }), k(46)]),
      armR: { ...atMouth, held: pipe, grip: fingers(skin, -1.3, -1.7, 2.3, 1.15), ha: -(atMouth.a + atMouth.b),
        ...armPath(T, [[0, atMouth, 0], [24, atMouth, 0, 'io'], [32, down, -8, 'io'], [86, down, -8, 'io'], [96, atMouth, 0], [100, atMouth, 0]]) },
      armL: { a: -20, b: -84 },
      front: [ring(36, 82, 12, -15, 3.2, 1.6, 2.1), ring(56, 76, 22, -24, 1.2, 1.3, 1.4),
        J(MOUTH[0] + 11.2, MOUTH[1] - 13.4, 0, [P(STAR, GOLD)], pop(T, 64, 72))],
    };
  },
  // a game against himself at a little table he stands behind: he moves the white knight, then a black pawn for the
  // other side; he hates the position: both fists up and down on the board, the pieces fly and roll; a hand over his eyes
  strategist: look => {
    const T = 6.6, sx = shOf(look), skin = look.skin, SL = 46;
    const TB = 47.6, TF = 50.4;
    const A: [number, number] = [35.2, 49.3], B: [number, number] = [38.4, 48.4], P1: [number, number] = [28.6, 48.4], P2: [number, number] = [28.2, 49.5];
    const WH = '#f4f1ea', WH_R = '#9aa0ad', BK = '#34303d', BK_R = '#857f96';
    const outline = (d: string, c: string, rim: string): Node[] => [P(d, c), S(d, rim, 0.3)];
    const PAWN = 'M-1.3 0H1.3L0.9 -1.1L0.5 -2.1Q1.2 -2.7 0.9 -3.3Q0.5 -3.9 0 -3.9Q-0.5 -3.9 -0.9 -3.3Q-1.2 -2.7 -0.5 -2.1L-0.9 -1.1Z';
    const KING = 'M-1.5 0H1.5L1.1 -1.3L0.7 -3.6Q1.3 -4.2 0.8 -4.7H0.3V-5.3H0.8V-5.9H0.3V-6.4H-0.3V-5.9H-0.8V-5.3H-0.3V-4.7H-0.8Q-1.3 -4.2 -0.7 -3.6L-1.1 -1.3Z';
    const ROOK = 'M-1.4 0H1.4L1.1 -1L0.9 -3.1H1.3V-4.4H0.75V-3.9H0.25V-4.4H-0.25V-3.9H-0.75V-4.4H-1.3V-3.1H-0.9L-1.1 -1Z';
    const pawn = (c: string, rim: string) => outline(PAWN, c, rim);
    const knight = (): Node[] => [J(0, -4.2, 0, [P(KNIGHT, WH), S(KNIGHT, WH_R, 0.45), C(-1.1, 1.5, 0.35, INK)], undefined, 0.62)];
    // the board on the table, two rows of eight squares seen a little from above
    const sq: string[] = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) {
      if ((i + r) % 2) continue;
      const y0 = 47.9 + r, y1 = y0 + 1, xl = (y: number) => 22.6 - (y - 47.9) * 0.6, w = (y: number) => (41.4 - 22.6 + (y - 47.9) * 1.2) / 8;
      sq.push(`M${(xl(y0) + i * w(y0)).toFixed(2)} ${y0}H${(xl(y0) + (i + 1) * w(y0)).toFixed(2)}L${(xl(y1) + (i + 1) * w(y1)).toFixed(2)} ${y1}H${(xl(y1) + i * w(y1)).toFixed(2)}Z`);
    }
    const fall = (dx: number, up: number, a: number, land: number, off = false): Track => {
      const end = off ? { dx: dx * 1.4, dy: 17, a: a * 1.5, o: 0 } : { dx, dy: land, a };
      return loop(T, [k(0), k(SL, { e: 'out' }), k(SL + 3, { dx: dx * 0.5, dy: -up, a: a * 0.5, e: 'in' }),
        ...(off ? [k(SL + 11, end)] : [k(SL + 7, { ...end, e: 'out' }), k(SL + 8.5, { ...end, dy: land - 0.5, e: 'in' }), k(SL + 10, end)]),
        k(87, { ...end, o: off ? 0 : 1 }), k(91, { ...end, o: 0, e: 'hold' }), k(96, { o: 0 }), k(99, { o: 1 })]);
    };
    const at = ([x, y]: [number, number], g: Node[], track: Track, vis?: [number, number][]): Node => J(x, y, 0, [J(0, 0, 0, g, track)], vis ? shown(T, vis) : undefined);
    const table: Node[] = [
      J(0, 0, 0, [
        P(`M18 ${TB}H46L48 ${TF}H16Z`, '#6b4426'), S(`M18.3 ${TB + 0.3}H45.7`, '#8a5a32', 0.5),
        P('M22.6 47.9H41.4L42.6 49.9H21.4Z', '#eadcbf'), P(sq.join(''), '#7a5236'), S('M22.6 47.9H41.4L42.6 49.9H21.4Z', '#4e3019', 0.35),
      ], loop(T, [k(0), k(SL, { e: 'out' }), k(SL + 1.4, { dy: -0.7 }), k(SL + 4, {})])),
      rr(16, TF, 32, 2.2, 0.4, '#4e3019'), S('M18.6 52.6V64.4M45.4 52.6V64.4', '#4e3019', 2),
      // the pieces, back row first
      at([24.6, 48.4], pawn(BK, BK_R), fall(-4, 4, -100, -0.6)),
      at([32.4, 48.3], outline(KING, BK, BK_R), fall(-1.4, 6, 95, -0.7)),
      at(P1, pawn(BK, BK_R), fall(0, 0, 0, 0), [[0, 27], [96, 100]]),
      at(B, knight(), fall(5, 5, 110, -0.8, true), [[19.5, 96]]),
      at([31.4, 49.5], pawn(WH, WH_R), fall(-2.6, 3, -90, -0.6, true)),
      at(A, knight(), fall(0, 0, 0, 0), [[0, 13], [96, 100]]),
      at(P2, pawn(BK, BK_R), fall(-3, 4.6, -120, -0.5, true), [[33.5, 96]]),
      at([40.4, 49.6], outline(ROOK, WH, WH_R), fall(3, 5, 100, -0.6)),
    ];
    const KH = 4.2 + 1.2, PH = 3.9 + 1.2;
    const holdL = (p: [number, number], x: number, y: number): AB => { const r = hold(sx, [-p[0], p[1]], 0, 64 - x, y); return { a: -r.a, b: -r.b }; };
    const restR = reach(sx, 41.6, 47.4), grabA = hold(sx, [0, KH], 0, A[0], A[1]), carryK = hold(sx, [0, KH], 0, (A[0] + B[0]) / 2, B[1] - 2.6), placeB = hold(sx, [0, KH], 0, B[0], B[1]);
    const upR = reach(sx, 40.6, 25.6), slamR = reach(sx, 36.2, 46.6);
    const thinkL = reachL(sx, 30.4, 32.6), grabP = holdL([0, PH], P1[0], P1[1]), carryP = holdL([0, PH], P1[0] - 0.4, P1[1] - 2.4), placeP = holdL([0, PH], P2[0], P2[1]);
    const restL = reachL(sx, 22.6, 47.4), upL = reachL(sx, 23.4, 25.6), slamL = reachL(sx, 27.8, 46.6), eyesL = reachL(sx, 31.4, 26.2);
    const kGrip = [S('M-1.5 0.6Q-2.2 1.7 -1.7 2.7', skin, 1.1), S('M1.3 0.5Q2.4 1.6 2 2.7', skin, 1.1)];
    return {
      blink: true, mouth: 'flat',
      head: { a: 4, go: loop(T, [k(0), k(10, { a: 7 }), k(20, { a: 3 }), k(26, { a: -4 }), k(34, { a: 2 }), k(38, { a: -8, e: 'out' }), k(SL, { a: 10, e: 'in' }), k(52, { a: 7 }), k(64, { a: 9 }), k(88, { a: 9 }), k(96)]) },
      mid: table,
      armR: { ...restR, held: [J(0, KH, 0, knight(), shown(T, [[13, 19.5]]))], grip: [J(0, 0, 0, kGrip, shown(T, [[13, 19.5]]))], ha: -(restR.a + restR.b),
        ...armPath(T, [[0, restR, 0], [7, restR, 0, 'io'], [12, grabA, 0, 'out'], [13, grabA, 0, 'io'], [16.5, carryK, 0, 'io'], [19.5, placeB, 0, 'out'], [24, restR, 0, 'io'],
          [36, restR, 0, 'io'], [42, upR, 0, 'out'], [44.5, upR, 0, 'in'], [SL, slamR, 0, 'out'], [47.5, reach(sx, 36.4, 45.4), 0, 'in'], [49, slamR, 0, 'io'], [62, slamR, 0, 'io'], [70, restR, 0, 'io'], [100, restR, 0]]) },
      armL: { ...thinkL, held: [J(0, PH, 0, pawn(BK, BK_R), shown(T, [[27, 33.5]]))], grip: [J(0, 0, 0, kGrip, shown(T, [[27, 33.5]]))], ha: -(thinkL.a + thinkL.b),
        ...armPath(T, [[0, thinkL, 0], [20, thinkL, 0, 'io'], [26, grabP, 0, 'out'], [27, grabP, 0, 'io'], [30.5, carryP, 0, 'io'], [33.5, placeP, 0, 'out'], [37, restL, 0, 'io'],
          [42, upL, 0, 'out'], [44.5, upL, 0, 'in'], [SL, slamL, 0, 'out'], [47.5, reachL(sx, 28, 45.4), 0, 'in'], [49, slamL, 0, 'io'], [58, slamL, 0, 'io'], [64, eyesL, 0, 'out'], [88, eyesL, 0, 'io'], [96, thinkL, 0], [100, thinkL, 0]]) },
      front: [J(32, 45.6, 0, [ink([S('M-9.4 -1.6L-12.4 -3.6M9.4 -1.6L12.4 -3.6M-7.4 -3.8L-9 -6.8M7.4 -3.8L9 -6.8', WHITE, 0.8)])], puff(T, [SL], 9, 0, -1, 1.3), 1, 0)],
    };
  },
  // a look left, a look right, the metal flask out of the coat, a long swig with the eyes shut, the moustache wiped
  // with a happy sigh; then the hiccups, a hop each
  scout: look => {
    const T = 6.2, sx = shOf(look), skin = look.skin;
    // the flask in the held frame: the fist round its bottom at 0 0 (so the hand stays out by the cheek while the
    // flask reaches the mouth), the cap's top at CAP
    const CAP: [number, number] = [0, -8.2];
    // as the Herald drinks (the owner, 2026-11-14: «araldo è perfetto»): the hand stays right of the mouth, at its height or
    // under it, the elbow out to the side; the flask tips no further than past level, the head goes back for the rest
    const pocket = hold(sx, [0, 0], 0, 34.8, 44.2), show = hold(sx, [0, 0], -8, 40.8, 41.8), near = hold(sx, CAP, -44, MOUTH[0] + 2.2, MOUTH[1] - 0.4), sip = hold(sx, CAP, -82, MOUTH[0] + 0.3, MOUTH[1] + 0.4), deep = hold(sx, CAP, -96, MOUTH[0] + 0.2, MOUTH[1] + 0.2);
    const BODY = 'M-2.6 -3.6Q-2.6 -4.6 -1.2 -4.8H1.2Q2.6 -4.6 2.6 -3.6V1.6Q2.6 3 1.2 3H-1.2Q-2.6 3 -2.6 1.6Z';
    const flask: Node[] = [P(BODY, '#b8c0cc'), P('M1 -4.8Q2.6 -4.6 2.6 -3.6V1.6Q2.6 3 1 3Z', '#7d8696', 0.6),
      rr(-0.9, -5.8, 1.8, 1.2, 0.3, '#8d96a6'), rr(-1.25, -6.6, 2.5, 1, 0.4, '#5d6573'), S('M-0.9 -6.1H0.9', '#9aa3b2', 0.3),
      S('M-1.7 -3.8V1.9', '#f2f5fa', 0.6, 0.9), S('M-1.1 -4.2H1.1', '#f2f5fa', 0.35, 0.6), rr(-2.6, -1.6, 5.2, 1.7, 0.2, '#6b4a22'), S('M-2.4 -0.75H2.4', '#8a6232', 0.3),
      S(BODY, '#5d6573', 0.35)].map(n => J(0, -1.6, 0, [n]));
    const swigs = [70, 82];
    return {
      blink: true, mouth: 'smile',
      head: { go: loop(T, [k(0), k(5, { a: -9, e: 'io' }), k(11, { a: -9 }), k(15, { a: 9, e: 'io' }), k(21, { a: 9 }), k(25), k(33, { a: -10, e: 'out' }), k(42, { a: -14 }), k(50, { a: -10 }), k(54, { a: 2 }), k(60, { a: -2 }), k(64)]),
        over: [savour(T, skin, 34, 50), cheeks(T, 48, 94)] },
      lean: -1,
      go: loop(T, [k(0), k(33, { a: -1.5 }), k(50, { a: -1.5 }), k(54), ...swigs.flatMap(h => [k(h, { e: 'out' }), k(h + 2, { dy: -1.8, sy: 1.04, e: 'in' }), k(h + 5, { sy: 0.97 }), k(h + 8)])]),
      armR: { ...HIP_R, held: [J(0, 0, 0, flask, shown(T, [[19, 61]]))], grip: [J(0, 0, 0, fingers(skin, -1.9, -1.5, 3.4, 1.15, [2.7, -1.8]), shown(T, [[19, 61]]))],
        ...armGlide(T, sx, [[0, HIP_R, 0], [14, HIP_R, 0, 'io'], [19, pocket, 0, 'io'], [24, show, -8, 'out'], [29, show, -8, 'io'], [34, near, -44, 'io'], [38, sip, -82, 'io'], [47, deep, -96, 'io'], [51, near, -44, 'io'], [56, show, -8, 'io'], [61, pocket, 0, 'io'], [65, HIP_R, 0], [100, HIP_R, 0]]) },
      armL: HIP_L,
      front: [...swigs.map(h => J(MOUTH[0] + 3.4, MOUTH[1] - 2, 0, [ink([C(0, 0, 1, WHITE), C(1.8, -1.6, 0.7, WHITE)])], puff(T, [h + 1], 11, 4, -6, 1.7), 1, 0))],
    };
  },
  // a big stein of beer held by the handle: up, three long gulps with the eyes shut (the beer goes down each time),
  // down with a sigh; a foam moustache, then a burp that shakes him from the feet up
  artisan: look => {
    const T = 6.6, sx = shOf(look), skin = look.skin;
    // the stein in the held frame: the fist round the handle at 0 0, the glass to its left
    const SC = 0.85, RIM: [number, number] = [-9.4 * SC, -5 * SC];
    const rest = hold(sx, [0, 0], 0, 43.6, 43.2), lift = hold(sx, [0, 0], -14, 42.6, 37.6), drink = hold(sx, RIM, -40, MOUTH[0] + 0.5, MOUTH[1] + 0.5), drink2 = hold(sx, RIM, -48, MOUTH[0] + 0.4, MOUTH[1] + 0.3);
    const gulps = [24, 33, 42];
    const stein: Node[] = [
      S('M-1.8 -3.2Q1.6 -3.4 1.6 0Q1.6 3.4 -1.8 3.2', '#d7e6ee', 1.7),
      rr(-9.6, -5, 7.8, 10, 1.4, '#e9f4fb', 0.28),
      liquid(T, -5.7, 4.3, 6.6, 7.6, '#efa52f', [[gulps[0]! + 4, 0.7], [gulps[1]! + 4, 0.42], [gulps[2]! + 4, 0.16]]),
      J(-5.7, 4.3 - 7.6, 0, [P('M-3.4 0.6Q-3.6 -1 -2 -1.1Q-1.4 -2.2 0 -1.7Q1.4 -2.4 2.2 -1.2Q3.8 -1.2 3.4 0.6Z', '#fff4dc')],
        loop(T, [k(0), k(gulps[0]! + 4, { dy: 7.6 * 0.3, sx: 0.96, e: 'out' }), k(gulps[1]! + 4, { dy: 7.6 * 0.58, sx: 0.92, e: 'out' }), k(gulps[2]! + 4, { dy: 7.6 * 0.84, sx: 0.88, sy: 0.6, e: 'out' }), k(97, { dy: 7.6 * 0.84, sx: 0.88, sy: 0.6, e: 'hold' }), k(100)])),
      S('M-8.4 -3.6V3.6', WHITE, 0.7, 0.45), rr(-9.6, -5, 7.8, 10, 1.4, 'none'), S('M-9.6 -3.6V3.6Q-9.6 5 -8.2 5H-3.2Q-1.8 5 -1.8 3.6V-3.6', '#cfe0ea', 0.6, 0.9), rr(-9.9, 4.4, 8.4, 1.2, 0.5, '#d7e6ee'),
    ];
    return {
      blink: true, mouth: 'grin',
      head: { go: loop(T, [k(0), k(14, { a: -3 }), k(22, { a: -13, e: 'out' }), ...gulps.flatMap(g => [k(g + 1, { a: -13 }), k(g + 4, { a: -15 })]), k(48, { a: -13 }), k(56, { a: 2, e: 'io' }), k(64, { a: 2 }), k(67, { a: 8, e: 'out' }), k(71, { a: -5 }), k(76, { a: 3 }), k(84)]),
        over: [savour(T, skin, 22, 50), J(0, 0, 0, [P('M27 38.8Q29.4 37.2 32 38.4Q34.6 37.2 37 38.8Q34.6 40 32 39.4Q29.4 40 27 38.8Z', '#fff4dc')],
          loop(T, [k(0, { o: 0, e: 'hold' }), k(52, { o: 0, e: 'hold' }), k(53, { o: 1 }), k(92, { o: 1 }), k(97, { o: 0 }), k(100, { o: 0 })]), 1, 0)] },
      go: loop(T, [k(0), k(18, { a: -1.5 }), ...gulps.flatMap(g => [k(g, { a: -2.5 }), k(g + 2, { a: -2.5, sy: 0.985 }), k(g + 4, { a: -2.5 })]), k(52, { a: 0 }), k(64, { e: 'out' }), k(67, { sy: 1.05, sx: 0.97, e: 'back' }), k(72, { sy: 0.97, sx: 1.02 }), k(78)]),
      armR: { ...rest, held: [J(0, 0, 0, stein, undefined, SC)], grip: fingers(skin, -0.2, -2, 3.2, 1.35, [-0.4, -3.2]), ha: -(rest.a + rest.b),
        ...armPath(T, [[0, rest, 0], [12, rest, 0, 'io'], [17, lift, -14, 'io'], [22, drink, -40, 'out'], [48, drink2, -48, 'io'], [54, lift, -10, 'io'], [60, rest, 0, 'out'], [100, rest, 0]]) },
      armL: HIP_L,
      front: [J(MOUTH[0] + 3.6, MOUTH[1] + 0.4, 0, [ink([C(0, 0, 2.1, WHITE, 0.85), C(2.6, -1.6, 1.5, WHITE, 0.85), C(1.4, 1.6, 1.2, WHITE, 0.85)])], puff(T, [67], 20, 9, -6, 2.4), 1, 0)],
    };
  },
  // an energy drink (no brand): cracked open with a hiss, the helm's chin plate drops, a long drink, the plate back
  // up; the can crushed in the fist and flicked over the shoulder; then a double biceps, eyes blazing
  sentinel: look => {
    const T = 7, sx = shOf(look);
    // the tall can in the held frame: the gauntlet round its bottom at 0 0, the near edge of its top at LIP
    const LIP: [number, number] = [-1.2, -8.8];
    const rest = hold(sx, [0, 0], 0, 41.6, 45.2), lift = hold(sx, [0, 0], -30, 43.4, 38.4), drink = hold(sx, LIP, -84, MOUTH[0] + 0.3, MOUTH[1] + 1), chinS = hold(sx, LIP, -44, MOUTH[0] + 2.2, MOUTH[1] + 0.6), deep = hold(sx, LIP, -98, MOUTH[0] + 0.2, MOUTH[1] + 0.8);
    const crush = hold(sx, [0, 0], 0, 43, 41.2), flick = hold(sx, [0, 0], -40, 44.8, 30.4);
    const flexR: AB = { a: -120, b: -88 }, flexL: AB = { a: 120, b: 88 }, tightR: AB = { a: -124, b: -106 }, tightL: AB = { a: 124, b: 106 };
    const CAN = '#3ccf5a', RIM = '#c3cad6';
    const can: Node[] = [J(0, -3.6, 0, [J(0, 3.6, 0, [rr(-1.8, -8.2, 3.6, 9.4, 0.7, CAN), P('M0.8 -8.2H1.1Q1.8 -8.2 1.8 -7.5V0.5Q1.8 1.2 1.1 1.2H0.8Z', '#22963b'),
      rr(-1.8, -8.8, 3.6, 1, 0.4, RIM), rr(-1.8, 0.8, 3.6, 0.8, 0.35, RIM), S('M-0.4 -8.5L0.8 -8.8', '#8d96a6', 0.4),
      P('M0.5 -6.6L-1 -3.6H0.2L-0.5 -1.2L1.3 -4.3H0Z', '#12301b'), S('M-1.2 -7.4V0.4', WHITE, 0.5, 0.45)])],
      loop(T, [k(0), k(45.5, { e: 'back' }), k(48, { sy: 0.4, sx: 1.25, a: 8 }), k(96, { sy: 0.4, sx: 1.25, a: 8, e: 'hold' }), k(97)]))];
    const pulses = [63, 69, 75];
    return {
      blink: true, mouth: 'flat',
      head: { go: loop(T, [k(0), k(14, { a: -3 }), k(19, { a: -12, e: 'out' }), k(36, { a: -13 }), k(42, { a: 0, e: 'io' }), k(57), ...pulses.flatMap(p => [k(p, { a: -4, e: 'out' }), k(p + 3, { a: 1 })]), k(84), k(92)]),
        // the chin plate of the helm: it drops while he drinks (the dark behind it is the helm's own)
        over: [J(32, 41.6, 0, [P('M-5.6 -2.4H5.6L4.6 2.4H-4.6Z', '#4a5263'), S('M-4 -0.6H4M-3.6 0.8H3.6', '#262b37', 0.7)],
          loop(T, [k(0), k(15, { e: 'io' }), k(19, { dy: 3.6, sy: 0.7 }), k(38, { dy: 3.6, sy: 0.7, e: 'io' }), k(42)])),
          J(32, 32, 0, [E(-4.6, 0, 3.2, 1.2, '#ff3b30', 0.35), E(4.6, 0, 3.2, 1.2, '#ff3b30', 0.35)], loop(T, [k(0, { o: 0, e: 'hold' }), k(58, { o: 0 }), k(61, { o: 1, sx: 1.4, sy: 1.4 }), k(84, { o: 1, sx: 1.2, sy: 1.2 }), k(90, { o: 0 }), k(100, { o: 0 })]), 1, 0)] },
      go: loop(T, [k(0), k(19, { a: -2 }), k(36, { a: -2 }), k(42), k(57, { e: 'out' }), ...pulses.flatMap(p => [k(p, { sx: 1.04, sy: 0.99, e: 'out' }), k(p + 3.4, { sx: 1.01 })]), k(84), k(92)]),
      armR: { ...rest, held: [J(0, 0, 0, can, shown(T, [[52.6, 96]], true))], grip: [J(0, 0, 0, fingers(COAL, -2.1, -1.6, 3.4, 1.15, [2.2, -2.2]), shown(T, [[52.6, 96]], true))], ha: -(rest.a + rest.b),
        ...armGlide(T, sx, [[0, rest, 0], [6, rest, 0, 'io'], [8, hold(sx, [0, 0], 0, 41.4, 44.4), 0, 'io'], [10, rest, 0, 'io'], [13.5, lift, -30, 'io'], [17, chinS, -44, 'io'], [21, drink, -84, 'io'], [34, deep, -98, 'io'],
          [38, chinS, -44, 'io'], [41, lift, -20, 'io'], [45, crush, 0, 'io'], [49, crush, 0, 'io'], [51.5, hold(sx, [0, 0], -10, 45.6, 41), -10, 'in'], [53, flick, -40, 'out'], [57, flexR, 0, 'io'],
          ...pulses.flatMap((p): [number, AB, number, Ease?][] => [[p, tightR, 0, 'io'], [p + 3.4, flexR, 0, 'io']]), [84, flexR, 0, 'io'], [92, rest, 0, 'io'], [100, rest, 0]]) },
      armL: { ...HIP_L, ...armGlide(T, sx, [[0, HIP_L, 0], [52, HIP_L, 0, 'io'], [57, flexL, 0, 'io'], ...pulses.flatMap((p): [number, AB, number, Ease?][] => [[p, tightL, 0, 'io'], [p + 3.4, flexL, 0, 'io']]), [84, flexL, 0, 'io'], [92, HIP_L, 0, 'io'], [100, HIP_L, 0]], 0, true) },
      front: [
        // the hiss of the opening
        J(40.8, 37.6, 0, [ink([S('M0 0L-1 -2.4M1.2 0.2L1.6 -2.2M2.2 0.8L3.6 -0.8', WHITE, 0.7)])], puff(T, [8.4], 9, 0, -2, 1.3), 1, 0),
        // the crushed can, flicked over the shoulder
        J(44.8, 30.4, 0, [rr(-2.4, -1.4, 4.8, 2.8, 0.7, CAN), S('M-1.4 -1L-0.2 0.4L1.2 -0.8', '#12301b', 0.6), S('M-2.2 -1.4H2.2', RIM, 0.6)],
          loop(T, [k(0, { o: 0, e: 'hold' }), k(52.6, { o: 0, e: 'hold' }), k(53, { o: 1, e: 'out' }), k(58, { o: 1, dx: 7, dy: -13, a: 220 }), k(66, { o: 1, dx: 15, dy: 22, a: 460, e: 'in' }), k(67, { o: 0, dx: 15, dy: 22, a: 460, e: 'hold' }), k(100, { o: 0, dx: 15, dy: 22 })]), 1, 0),
        J(53, 18, 0, [P('M1.4 -6L-3.4 1H0L-1.4 6L3.4 -1H0Z', '#7cf06a')], pop(T, 60, 84)),
        ...pulses.map(p => J(32, 22, 0, [ink([S('M-13 0L-15.6 -1.4M13 0L15.6 -1.4M-12 4L-14.8 4.4M12 4L14.8 4.4', WHITE, 0.7)])], puff(T, [p], 6, 0, -0.6, 1.2), 1, 0)),
      ],
    };
  },
  // a glass of red held by the stem: swirled (the wine rolls round the bowl), sniffed with the eyes shut, a slow sip,
  // then a pat on the belly, rosy and a little tipsy, humming
  herald: look => {
    const T = 6.8, sx = shOf(look), skin = look.skin, G = 0.85;
    // the glass in the held frame: the fingers pinch the bottom of the stem at 0 0, the near edge of the rim at RIMG
    const RIMG: [number, number] = [-2.9 * G, -10 * G];
    const c: [number, number] = [43.4, 42.4];
    const swirl = [0, 1, 2, 3].map(i => hold(sx, [0, 0], 0, c[0] + Math.sin(i * Math.PI / 2) * 1.1, c[1] - Math.cos(i * Math.PI / 2) * 0.7));
    const nose = hold(sx, [-1.6 * G, -9 * G], -40, MOUTH[0] + 2.4, MOUTH[1] - 1.6), sip = hold(sx, RIMG, -76, MOUTH[0] + 0.2, MOUTH[1] + 0.5), sip2 = hold(sx, RIMG, -86, MOUTH[0] + 0.1, MOUTH[1] + 0.4);
    const glass: Node[] = [J(0, -1.4, 0, [S('M0 -2.4V1.6', '#dcecf8', 0.7), E(0, 1.9, 2, 0.5, '#dcecf8'),
      J(0, -2.6, 0, [liquid(T, 0, 0, 4.4, 2.6, '#7a1426', [[50, 0.45]], 1.4)], loop(T, [k(0, { a: -14 }), k(5, { a: 12 }), k(10, { a: -12 }), k(15, { a: 12 }), k(20, { a: -8 }), k(26, { a: 0, e: 'out' })])),
      P('M-2.9 -8.4H2.9C2.9 -4.4 1.7 -2.4 0 -2.4C-1.7 -2.4 -2.9 -4.4 -2.9 -8.4Z', '#e4f1fa', 0.32), S('M-2.9 -8.4C-2.9 -4.4 -1.7 -2.4 0 -2.4C1.7 -2.4 2.9 -4.4 2.9 -8.4', '#d2e5f1', 0.5, 0.9),
      S('M-2.9 -8.4H2.9', '#d2e5f1', 0.35, 0.7), S('M-2 -7.4Q-2.1 -5 -1 -3.6', WHITE, 0.5, 0.75)], undefined, G)];
    const belly = reachL(sx, 26.4, 44.6), pat = reachL(sx, 26.8, 43.2);
    return {
      blink: true, mouth: 'smile',
      head: { go: loop(T, [k(0), k(20, { a: 3 }), k(26, { a: 6, e: 'io' }), k(34, { a: 6 }), k(40, { a: -10, e: 'io' }), k(54, { a: -12 }), k(60, { a: 4, e: 'out' }), k(70, { a: -3 }), k(78, { a: 4 }), k(86, { a: -3 }), k(96)]),
        over: [savour(T, skin, 26, 56), cheeks(T, 54, 96)] },
      go: loop(T, [k(0), k(26, { a: 1 }), k(40, { a: -1.5 }), k(56), k(64, { a: 2.2, e: 'io' }), k(74, { a: -2.2, e: 'io' }), k(84, { a: 1.6, e: 'io' }), k(96)]),
      armR: { ...swirl[0]!, held: glass, grip: [S('M-1.15 -2V-0.2', skin, 1.1), S('M1.15 -2V-0.2', skin, 1.1)], ha: -(swirl[0]!.a + swirl[0]!.b),
        ...armGlide(T, sx, [[0, swirl[0]!, 0], [5, swirl[1]!, 0], [10, swirl[2]!, 0], [15, swirl[3]!, 0], [20, swirl[0]!, 0], [26, nose, -40, 'io'], [34, nose, -40, 'io'], [42, sip, -76, 'io'], [54, sip2, -86, 'io'], [62, swirl[0]!, 0, 'io'], [100, swirl[0]!, 0]]) },
      armL: { ...HIP_L, ...armGlide(T, sx, [[0, HIP_L, 0], [60, HIP_L, 0, 'io'], [64, belly, 0, 'io'], [66.5, pat, 0, 'out'], [69, belly, 0, 'in'], [71.5, pat, 0, 'out'], [74, belly, 0, 'in'], [80, HIP_L, 0, 'io'], [100, HIP_L, 0]], 0, true) },
      front: notes(52, 20, T, [68, 80]),
    };
  },
};

