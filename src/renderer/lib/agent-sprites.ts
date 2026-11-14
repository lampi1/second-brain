// The little people of the roles, scene by scene (ADR 0295): each role is its portrait's head (lib/character-art.ts)
// on a small body in the role's clothes, free on the strip (no tile), and does its own job while its chat
// works: the Orchestrator conducts, the Strategist lifts a chess knight at its table, the Scout walks with a magnifying
// glass, the Artisan hammers on an anvil, the Sentinel scans with binoculars beside its shield, the Herald blows its
// horn; a chat without a role types on a laptop. The other states are shared: thinking (a hand at the chin,
// a thought), waiting for the user (a wave, a hop, an amber «!»), done (two jumps with the arms up, then still under a
// green tick), error (the head down, a sigh, a drop of sweat, a red «!»), idle (asleep, nodding off). A click plays a
// reaction once over any of them (ADR 0297): a pat on the head, a whack of the stick. Every scene is a
// small piece of acting written as tracks of keys (lib/sprite-rig.ts): a move loads, strikes, overshoots and settles,
// the body squashes when it lands, the head follows a moment late. Drawn by components/AgentSprite.tsx.
import type { CharacterId } from '../../shared/characters';
import { CHARACTERS, type Shape } from './character-art';
import { AMBER, GOLD, GREEN, INK, J, RED, SKY, WHITE, bubble, ink, person, quaver, sh, sway, type Ease, type Key, type Look, type Node, type Pose, type Track } from './sprite-rig';

/** The roles with a little person (the keys of WORK below); any other chat is the plain one. */
export type SpriteId = keyof typeof WORK;
export type SpriteState = 'work' | 'think' | 'wait' | 'done' | 'err' | 'idle';
/** One scene: the tree to draw. */
export interface SpriteScene { nodes: Node[] }

const { P, S, C, E } = sh;
const ring = (x: number, y: number, r: number, c: string, w: number): Shape => ({ r: [x, y, r], c, w });
/** A rounded rectangle as a path. */
const rr = (x: number, y: number, w: number, h: number, r: number, f: string, o?: number): Shape =>
  P(`M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`, f, o);

const CLOTHES: Record<SpriteId, Pick<Look, 'top' | 'sleeve' | 'pants' | 'shoes' | 'wear'>> = {
  orchestrator: { top: '#24222f', pants: '#1a1822', shoes: '#0f0e14',
    wear: [P('M29.4 42.9H34.6L32 49.6Z', '#f7f7fb'), P('M29.8 43.4L32 44.8L29.8 46.2Z', RED), P('M34.2 43.4L32 44.8L34.2 46.2Z', RED)] },
  strategist: { top: '#2c2f3d', pants: '#20222c', shoes: '#111218',
    wear: [P('M28.6 42.9H35.4L34.4 46.6H29.6Z', '#e2c08a'), S('M32 47.4V54', '#3d4154', 1)] },
  scout: { top: '#e2c48a', pants: '#6f7b3f', shoes: '#5a3d1c',
    wear: [P('M28.4 42.9H35.6L32 48Z', '#e0533d'), S('M25.4 46.4L39 55.4', '#7d5b28', 1.5)] },
  artisan: { top: '#3d6fb0', pants: '#2f3a55', shoes: '#3a2416',
    wear: [P('M27.4 47H36.6L38 58H26Z', '#7b4a26'), S('M28 47L29.4 43.4M36 47L34.6 43.4', '#7b4a26', 1.6), rr(29.6, 50.6, 4.8, 3.4, 0.8, '#643b1d')] },
  sentinel: { top: '#a7b2c1', sleeve: '#2d3a4a', pants: '#2d3a4a', shoes: '#566170',
    wear: [S('M25.4 46.4C28 44.6 36 44.6 38.6 46.4', '#d9a72c', 1.5), S('M32 47V54', '#8a96a8', 1)] },
  herald: { top: '#2d4fa1', pants: '#26224a', shoes: '#16142c',
    wear: [C(28.4, 43.8, 1.9, WHITE), C(32, 44.4, 1.9, WHITE), C(35.6, 43.8, 1.9, WHITE), C(32, 49, 1, GOLD), C(32, 52.4, 1, GOLD)] },
  plain: { top: '#93a7cc', pants: '#2f3445', shoes: '#eceef4',
    wear: [S('M30.6 43V46.4M33.4 43V46.4', '#eceef4', 0.9), rr(28.4, 50.6, 7.2, 3.6, 1.2, '#7f93ba')] },
};
const lookOf = (id: SpriteId): Look => {
  if (id === 'plain') return { skin: '#f2c8a4', ...CLOTHES.plain,
    hair: [P('M20 30C19 21.4 24.6 16.8 32 16.8C39.4 16.8 45 21.4 44 30C43.2 27 42 25 40.4 23.6C35.4 25 28.4 24.6 24.4 22.6C22.4 24.6 21 27 20 30Z', '#5a3d2a')] };
  const ch = CHARACTERS[id];
  return { skin: ch.skin, ...(ch.back ? { hairBack: ch.back } : {}), hair: [...(ch.over ?? []), ...ch.head, ...(ch.wear ?? [])], ...CLOTHES[id] };
};

const k = (at: number, p: Omit<Key, 'at'> = {}): Key => ({ at, ...p });
const loop = (t: number, keys: Key[], d = 0): Track => ({ t, keys, d });
const once = (t: number, keys: Key[]): Track => ({ t, keys, n: 1 });
/** Hidden, then there at `at` (% of the loop) and away while it fades over `len` %: a spark, a note, a puff. Hidden
 *  from the loop's start to its first moment and after its last one too (at rest, without motion, it is in sight). */
const puff = (t: number, at: number[], len: number, dx: number, dy: number, s = 1, a?: number): Track => {
  const keys = at.flatMap(h => [k(Math.max(0, h - 0.2), { o: 0, e: 'hold' }), k(h, { o: 1, e: 'out' }), k(Math.min(100, h + len), { o: 0, dx, dy, sx: s, sy: s, ...(a === undefined ? {} : { a }) }),
    ...(h + len + 0.2 < 100 ? [k(h + len + 0.2, { o: 0, e: 'hold' as Ease })] : [])]);
  return loop(t, [...(keys[0]!.at > 0 ? [k(0, { o: 0, e: 'hold' as Ease })] : []), ...keys, ...(keys[keys.length - 1]!.at < 100 ? [k(100, { o: 0 })] : [])]);
};
/** Grows from nothing past its size and settles, stays, fades: a thought, a sparkle. */
const pop = (t: number, at: number, until: number): Track =>
  loop(t, [k(0, { sx: 0, sy: 0, o: 0, e: 'hold' }), k(at, { sx: 0.2, sy: 0.2, o: 0, e: 'back' }), k(at + 9, { o: 1 }), k(until, { o: 1 }), k(until + 6, { o: 0 }), k(100, { o: 0, sx: 0, sy: 0 })]);
const notes = (x: number, y: number, t: number, at: [number, number]): Node[] => [
  J(x, y, -8, [ink(quaver(WHITE))], puff(t, [at[0]], 46, 10, -14, 1.15, 12)),
  J(x + 3, y + 9, 6, [ink(quaver(WHITE))], puff(t, [at[1]], 46, 12, -9, 1.15, -10)),
];
const Z = 'M-2.6 -2.6H2.6L-2.6 2.6H2.6';
const STAR = 'M0 -5L1.2 -1.2L5 0L1.2 1.2L0 5L-1.2 1.2L-5 0L-1.2 -1.2Z';

// ── what each role does while its chat works ─────────────────────────────────────────────────────────────────────────
const WORK = {
  // four beats: down, in, out, up; the left hand follows a moment late, the baton trails the hand
  orchestrator: () => ({
    eyes: 'happy', mouth: 'smile',
    head: { a: -4, go: loop(2.4, [k(0), k(50, { a: 4 })], 0.12) },
    go: loop(2.4, [0, 25, 50, 75].flatMap(b => [k(b, { dy: 0.9, sy: 0.975, e: 'out' }), k(b + 12.5, { dy: -0.7, sy: 1.012, e: 'in' })])),
    armR: { a: -70, b: -22, go: loop(2.4, [k(0), k(25, { a: -104 }), k(50, { a: -92 }), k(75, { a: -128 })]), goB: loop(2.4, [k(0), k(25, { a: -64 }), k(50, { a: -4 }), k(75, { a: -26 })]),
      goH: loop(2.4, [k(0), k(12, { a: 16 }), k(37, { a: -14 }), k(62, { a: 12 }), k(87, { a: -16 })]), held: [S('M0 0V10.4', WHITE, 1.3), C(0, 10.4, 1.2, '#ffd166')] },
    armL: { a: 80, b: 24, go: loop(2.4, [k(0), k(25, { a: 100 }), k(50, { a: 84 }), k(75, { a: 122 })], 0.14), goB: loop(2.4, [k(0), k(25, { a: 50 }), k(50, { a: 14 }), k(75, { a: 32 })], 0.14) },
    front: notes(57, 27, 2.4, [4, 54]),
  }),
  // thinks, lifts the knight (a small dip first), holds it, puts it down: the pawns jump, a nod
  strategist: () => {
    const arm: [number, number, Ease?][] = [[0, -78], [30, -78, 'out'], [34, -74, 'out'], [46, -110], [58, -108, 'in'], [66, -76, 'out'], [69, -81], [73, -78]];
    return {
      blink: true, mouth: 'smile',
      head: { a: 3, go: loop(4, [k(0), k(20, { a: 7 }), k(40, { a: 2 }), k(48, { a: -2 }), k(60, { a: -2 }), k(71, { a: 8, e: 'out' }), k(78, { a: 3 })]) },
      go: loop(4, [k(0), k(34, { sy: 0.985 }), k(46, { dy: -0.6, sy: 1.01 }), k(58, { dy: -0.6 }), k(66, { sy: 0.98 }), k(72, {})]),
      // the knight stays upright: the hand turns it back by the arm's own angle (the elbow is at -12)
      armR: { a: -78, b: -12, go: loop(4, arm.map(([at, a, e]) => k(at, { a, ...(e ? { e } : {}) }))), ha: 90, goH: loop(4, arm.map(([at, a, e]) => k(at, { a: 12 - a, ...(e ? { e } : {}) }))),
        held: [J(0, -0.6, 0, [P('M-2.7 8.6H2.7V7.4L1.8 6.7C2 4.9 2.7 3.6 2.7 2C2.7 0.2 1.3 -1 -0.4 -1L-0.8 -1.7L-1.4 -0.6C-2.3 0 -3 1 -3.3 2.2C-3.3 2.8 -2.9 3.1 -2.3 2.9L-1 2.4C-0.8 3.6 -1.4 4.8 -1.8 5.7L-1.8 6.7L-2.7 7.4Z', WHITE), C(-1.1, 0.9, 0.5, '#2a4bc2')], undefined, 1.35)] },
      armL: { a: 28, b: -176 },
      back: [rr(43, 57.6, 30, 3, 1.4, '#f1e6cb'), S('M45.4 58.4H50M54.6 58.4H59.2M63.8 58.4H68.4', '#2a4bc2', 1.4, 0.55), S('M58 61V64.2', '#d6c8a4', 2.4), S('M52.6 64.6H63.4', '#d6c8a4', 2),
        J(0, 0, 0, [C(64.6, 49.6, 2.2, '#1d1a22'), P('M61.6 57.6L63.4 51.4H65.8L67.6 57.6Z', '#1d1a22')], loop(4, [k(66, { e: 'out' }), k(69, { dy: -1.4, e: 'in' }), k(72, {})])),
        J(0, 0, 0, [C(70.4, 52.6, 1.6, '#f7f3e6'), P('M68.4 57.6L69.6 53.8H71.2L72.4 57.6Z', '#f7f3e6')], loop(4, [k(67, { e: 'out' }), k(70.5, { dy: -1, e: 'in' }), k(74, {})]))],
    };
  },
  // four steps, a stop, the lens up to the eye, a look around, a sparkle: found something
  scout: () => {
    const step = (first: number): Key[] => [k(0, { a: first }), k(12, { a: -first }), k(24, { a: first }), k(36, { a: -first }), k(48, { a: first }), k(56, { a: 0 }), k(92, { a: 0, e: 'in' }), k(100, { a: first })];
    return {
      blink: true, mouth: 'grin',
      head: { go: loop(4.2, [k(0), k(52, {}), k(62, { a: 6 }), k(72, { a: 3 }), k(82, { a: 7 }), k(94, {})]) },
      go: loop(4.2, [k(0, { e: 'out' }), k(6, { dy: -1.2, e: 'in' }), k(12, { e: 'out' }), k(18, { dy: -1.2, e: 'in' }), k(24, { e: 'out' }), k(30, { dy: -1.2, e: 'in' }), k(36, { e: 'out' }), k(42, { dy: -1.2, e: 'in' }), k(48, {}),
        k(54, { sy: 0.97 }), k(62, { a: 5, sy: 0.97 }), k(86, { a: 5, sy: 0.97 }), k(94, {})]),
      legL: { a: 26, go: loop(4.2, step(26)) }, legR: { a: -26, go: loop(4.2, step(-26)) },
      armL: { a: -22, b: -10, go: loop(4.2, [k(0), k(12, { a: 22 }), k(24, { a: -22 }), k(36, { a: 22 }), k(48, { a: -22 }), k(58, { a: 30 }), k(92, { a: 30 })]),
        goB: loop(4.2, [k(0), k(48, {}), k(58, { a: -70 }), k(92, { a: -70 })]) },
      armR: { a: -76, b: -14, go: loop(4.2, [k(0), k(12, { a: -84 }), k(24, { a: -76 }), k(36, { a: -84 }), k(48, { a: -76, e: 'back' }), k(60, { a: -100 }), k(70, { a: -96 }), k(80, { a: -101 }), k(88, { a: -100 }), k(96, {})]),
        goB: loop(4.2, [k(0), k(48, { e: 'back' }), k(60, { a: -110 }), k(88, { a: -110 }), k(96, {})]),
        held: [S('M0 0V4.4', '#6b4423', 2.2), C(0, 9.4, 4.5, SKY, 0.55), ring(0, 9.4, 4.9, '#f4f6fa', 1.9), S('M-2.4 7.4C-1.6 6.6 -0.8 6.2 0.2 6.2', WHITE, 1)] },
      front: [J(50, 26, 0, [ink([P('M0 -5L1.2 -1.2L5 0L1.2 1.2L0 5L-1.2 1.2L-5 0L-1.2 -1.2Z', WHITE)])], pop(4.2, 70, 86))],
    };
  },
  // three blows (a lift, a slam, a rebound; the body stretches and squashes, the anvil shakes, sparks fly), then a look and two nods
  artisan: () => {
    const hits = [12, 30, 48];
    return {
      blink: true, mouth: 'grin',
      head: { go: loop(3.6, [...hits.flatMap(h => [k(h, { e: 'out' }), k(h + 2, { a: 5 }), k(h + 7, {})]), k(60, {}), k(66, { a: 7 }), k(70, { a: 3 }), k(74, { a: 8 }), k(78, { a: 3 }), k(88, {})]) },
      go: loop(3.6, [...hits.flatMap(h => [k(h - 12, { e: 'out' }), k(h - 4, { dy: -1.3, sy: 1.03, e: 'in' }), k(h, { sy: 0.95, sx: 1.04, e: 'out' }), k(h + 4, {})]), k(58, {}), k(66, { a: 4 }), k(82, { a: 4 }), k(90, {})]),
      armR: { a: -84, go: loop(3.6, [...hits.flatMap(h => [k(h - 12, { e: 'out' }), k(h - 4, { a: -168, e: 'in' }), k(h, { a: -80, e: 'out' }), k(h + 3, { a: -93 }), k(h + 6, {})]), k(58, {}), k(66, { a: -112, e: 'back' }), k(82, { a: -112 }), k(92, {})]),
        held: [S('M0 -1.4V7.6', '#8a5a2e', 1.9), rr(-3.7, 5.2, 7.4, 4.8, 1.1, '#e3e7ee'), rr(-3.7, 8.2, 7.4, 1.8, 0.9, '#aab2bf')] },
      armL: { a: 24, b: -34 },
      back: [J(0, 0, 0, [P('M48.6 53H72C71 56.2 68 57.2 65.6 57.2V60.4H68.6V64.4H53V60.4H56V57.2C53 57.2 50 56 48.6 53Z', '#e3e7ee'), S('M51 54.2H70', '#aab2bf', 1.1), S('M53.4 63.4H68.2', '#aab2bf', 1.1)],
        loop(3.6, hits.flatMap(h => [k(h, { e: 'out' }), k(h + 1.2, { dy: 0.9 }), k(h + 4, {})])))],
      front: [J(59, 51.6, 0, [S('M0 0L2.6 -2.6', '#ffc531', 1.7)], puff(3.6, hits, 9, 7, -8)), J(60, 52, 0, [S('M0 0L3.2 -0.6', '#ffc531', 1.7)], puff(3.6, hits, 9, 10, -2)),
        J(57.4, 51.4, 0, [S('M0 0L0.6 -3.2', '#ffc531', 1.7)], puff(3.6, hits, 9, 1, -10)), J(61, 51, 0, [C(0, 0, 0.9, '#ffe9a3')], puff(3.6, hits, 12, 9, -6))],
    };
  },
  // looks left for a while, sweeps right (the head a moment after the body), a gleam on the shield
  sentinel: () => ({
    eyes: 'none', mouth: 'flat', lean: -4,
    go: loop(5, [k(0), k(30, {}), k(44, { a: 4 }), k(80, { a: 4 }), k(94, {})]),
    head: { a: -4, go: loop(5, [k(0), k(33, {}), k(49, { a: 6, e: 'back' }), k(58, { a: 3 }), k(68, { a: 6 }), k(83, { a: 5 }), k(98, {})]),
      over: [rr(22, 29.4, 9, 6.6, 2.6, '#1f2430'), rr(33, 29.4, 9, 6.6, 2.6, '#1f2430'), rr(30.4, 31.2, 3.2, 2.6, 0.8, '#39404f'),
        C(26.5, 32.7, 2, SKY, 0.95), C(37.5, 32.7, 2, SKY, 0.95), C(27.2, 32, 0.7, WHITE), C(38.2, 32, 0.7, WHITE)] },
    armL: { a: 140, b: 48 }, armR: { a: -140, b: -48 },
    back: [J(10, 11, 0, CHARACTERS.sentinel.prop), J(58, 56, 0, [S('M-3 4L3 -4', WHITE, 1.8)], loop(5, [k(0, { o: 0, dx: -5, e: 'hold' }), k(50, { o: 0, dx: -5 }), k(55, { o: 0.9, dx: 0 }), k(61, { o: 0, dx: 5 }), k(100, { o: 0, dx: 5 })]), 1, 0)],
  }),
  // a breath in (leaning back, the horn dips), the blast (forward, the horn up), a held note, notes in the air
  herald: () => ({
    mouth: 'o',
    go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: -5, sy: 1.05, e: 'back' }), k(22, { a: 4, sy: 0.97 }), k(26, { a: 3 }), k(34, { a: 3, dy: -0.6 }), k(42, { a: 3 }), k(50, { a: 3, dy: -0.6 }), k(58, { a: 3 }), k(66, { a: 3, dy: -0.6 }), k(74, { a: 3 }), k(88, {})]),
    head: { a: -2, go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: 5, e: 'back' }), k(23, { a: -7 }), k(74, { a: -6 }), k(90, {})]),
      over: [P('M34.6 38.6L50 36.4L60.4 30.2C62.8 33.4 63.6 37.6 63 41.8L50.6 40.4L34.8 40.8Z', GOLD), E(61.8, 36, 1.9, 5.9, '#d9a52e'),
        P('M43.4 40.6L52 40.4L51.6 48.4L47.6 46.4L43.6 48Z', '#e2483d'), S('M43.6 42.6L51.8 42.4', '#fff3d6', 1.2)] },
    armR: { a: -112, b: -22, go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: -104, e: 'back' }), k(23, { a: -121 }), k(74, { a: -120 }), k(90, {})]) },
    armL: { a: 38, b: -72 },
    front: notes(66, 29, 2.8, [24, 44]),
  }),
  // types with both hands while the lines of code write themselves on the screen, then a nod
  plain: () => {
    const line = (y: number, w: number, c: string, from: number, to: number): Node =>
      J(52.4, y, 0, [S(`M0 0H${w}`, c, 1.5)], loop(3.2, [k(0, { sx: 0, e: 'hold' }), k(from, { sx: 0, e: 'lin' }), k(to, { sx: 1 }), k(90, { sx: 1 }), k(95, { sx: 1, o: 0, e: 'hold' }), k(100, { sx: 0, o: 0 })]));
    return {
      blink: true, mouth: 'smile', lean: 2,
      head: { a: 3, go: loop(3.2, [k(0), k(40, { a: 6 }), k(80, { a: 3 }), k(88, { a: 8, e: 'out' }), k(95, { a: 3 })]) },
      armR: { a: -45, go: sway(-53, 0.11) }, armL: { a: -38, b: -14, go: sway(-30, 0.11, -0.11) },
      back: [S('M42.6 58.6H72', '#e2e5ee', 2.4), S('M58 59.8V64.2', '#b4bacb', 2.2), S('M53 64.6H63', '#b4bacb', 2),
        rr(48.2, 40.4, 20.6, 15, 2.6, '#eceef4'), rr(49.6, 41.8, 17.8, 12.2, 1.6, '#1f2430'), rr(43.4, 55.4, 26.6, 2, 1, '#c6cbd8'),
        line(45.4, 8, SKY, 2, 26), line(48.4, 11.6, WHITE, 28, 58), line(51.4, 5.6, '#7ee0a8', 60, 78)],
    };
  },
} satisfies Partial<Record<CharacterId | 'plain', () => Pose>>;

// ── the states every role shares ─────────────────────────────────────────────────────────────────────────────────────
const SHARED: Record<Exclude<SpriteState, 'work'>, () => Pose> = {
  // a hand at the chin, two taps, the foot too; the thought grows a bubble at a time
  think: () => ({
    eyes: 'up', mouth: 'flat', lean: -1.5, go: sway(1.5, 1.8),
    head: { a: 3, go: sway(7, 1.8, 0.15) },
    armR: { a: -28, b: 176, goB: loop(3.6, [k(40), k(44, { a: 166 }), k(48, {}), k(52, { a: 166 }), k(56, {})]) }, armL: { a: 30, b: -60 },
    legR: { go: loop(3.6, [k(60, { e: 'out' }), k(63, { a: -11, e: 'in' }), k(66, { e: 'out' }), k(69, { a: -11, e: 'in' }), k(72, {})]) },
    front: [J(47.6, 31, 0, [ink([C(0, 0, 1.7, WHITE)])], pop(3.6, 2, 84)), J(52.6, 25.6, 0, [ink([C(0, 0, 2.5, WHITE)])], pop(3.6, 10, 84)),
      J(63, 15.4, 0, [ink([E(0, 0, 9.6, 6.8, WHITE), C(-6, -3, 4.2, WHITE), C(3.4, -4.8, 5, WHITE)]), { g: [C(-3.8, 0.2, 1.2, INK), C(0, 0.2, 1.2, INK), C(3.8, 0.2, 1.2, INK)], cls: 'sp-paper' }], pop(3.6, 18, 84))],
  }),
  // three waves, then a hop on the spot: the «!» wobbles and jumps with it
  wait: () => ({
    blink: true, mouth: 'grin',
    head: { a: -3, go: loop(2.6, [k(0), k(30, { a: -6 }), k(60, {}), k(71, { a: 2 }), k(80, { a: -5 }), k(90, {})]) },
    go: loop(2.6, [k(0), k(58, { e: 'out' }), k(64, { sy: 0.92, sx: 1.05, e: 'out' }), k(72, { dy: -3.6, sy: 1.06, sx: 0.97, e: 'in' }), k(80, { sy: 0.9, sx: 1.07, e: 'out' }), k(86, { sy: 1.03 }), k(92, {})]),
    armR: { a: -125, b: -25, goB: loop(2.6, [k(0), k(9, { a: -64 }), k(18, {}), k(27, { a: -64 }), k(36, {}), k(45, { a: -64 }), k(54, {})]) },
    front: [bubble(AMBER, '!', loop(2.6, [k(0, { a: -7 }), k(9, { a: 7 }), k(18, { a: -6 }), k(27, { a: 5 }), k(36, { a: -3 }), k(45, {}), k(64, { e: 'out' }), k(72, { dy: -2.6, sx: 1.16, sy: 1.16, e: 'in' }), k(82, { sx: 0.96, sy: 0.96 }), k(90, {})]))],
  }),
  // a crouch, a jump with the arms thrown up, a landing that squashes, a smaller one, then still: tick and confetti at the top
  done: () => {
    const up = (m: 1 | -1): Track => once(2.4, [k(0, { a: 20 * m }), k(8, { a: -12 * m, e: 'back' }), k(22, { a: 128 * m }), k(36, { a: 94 * m }), k(46, { a: 104 * m }), k(62, { a: 126 * m }), k(74, { a: 96 * m }), k(90, {})]);
    const fold = (m: 1 | -1): Track => once(2.4, [k(0, { a: 0 }), k(8, { a: 0 }), k(22, { a: 30 * m }), k(36, { a: 52 * m }), k(62, { a: 30 * m }), k(90, {})]);
    const bit = (c: string, dx: number, dy: number, at: number): Node =>
      J(32, 30, 0, [rr(-1.3, -1.3, 2.6, 2.6, 0.7, c)], once(2.4, [k(0, { o: 0, e: 'hold' }), k(at, { o: 1, e: 'out' }), k(at + 16, { o: 1, dx: dx * 0.8, dy, a: 120, e: 'in' }), k(at + 40, { o: 0, dx, dy: dy + 16, a: 260 }), k(100, { o: 0 })]), 1, 0);
    return {
      eyes: 'happy', mouth: 'grin',
      go: once(2.4, [k(0, { e: 'out' }), k(8, { sy: 0.86, sx: 1.08, e: 'out' }), k(22, { dy: -9, sy: 1.1, sx: 0.95, e: 'in' }), k(36, { sy: 0.84, sx: 1.1, e: 'out' }), k(44, { sy: 1.04, sx: 0.98 }), k(52, { sy: 0.9, sx: 1.05, e: 'out' }),
        k(62, { dy: -5, sy: 1.06, e: 'in' }), k(74, { sy: 0.9, sx: 1.06, e: 'out' }), k(82, { sy: 1.02 }), k(90, {})]),
      head: { go: once(2.4, [k(0), k(22, { a: -5 }), k(38, { a: 5 }), k(62, { a: -4 }), k(76, { a: 4 }), k(90, {})]) },
      armL: { a: 100, b: 42, go: up(1), goB: fold(1) }, armR: { a: -100, b: -42, go: up(-1), goB: fold(-1) },
      front: [bubble(GREEN, 'ok', once(2.4, [k(0, { o: 0, sx: 0, sy: 0, e: 'hold' }), k(18, { o: 0, sx: 0.2, sy: 0.2, e: 'back' }), k(30, { o: 1 }), k(100, {})])),
        bit(GOLD, -18, -16, 20), bit(RED, 16, -18, 21), bit(SKY, -9, -22, 22), bit(GREEN, 22, -10, 20), bit('#c77dff', 7, -24, 23), bit(AMBER, -22, -8, 21)],
    };
  },
  // the head hangs and shakes, a sigh, a drop of sweat; the «!» rattles twice a round
  err: () => ({
    eyes: 'sad', mouth: 'frown',
    head: { a: 8, go: loop(3.4, [k(0), k(45, { a: 12 }), k(66, { a: 12 }), k(71, { a: 5 }), k(77, { a: 12 }), k(83, { a: 6 }), k(90, {})]) },
    go: loop(3.4, [k(0), k(36, { sy: 0.97 }), k(50, { sy: 1.025, dy: -0.4, e: 'out' }), k(64, { sy: 0.955, sx: 1.02 }), k(100, {})]),
    armL: { a: 3, go: sway(7, 0.85) }, armR: { a: -3, go: sway(-7, 0.85, 0.2) },
    front: [J(46.6, 23, 0, [P('M0 -2.6C1.7 -0.4 2.1 0.6 2.1 1.5A2.1 2.1 0 0 1 -2.1 1.5C-2.1 0.6 -1.7 -0.4 0 -2.6Z', SKY)], loop(3.4, [k(0, { o: 0, e: 'out' }), k(8, { o: 1, e: 'in' }), k(34, { o: 1, dy: 8 }), k(40, { o: 0, dy: 10 }), k(100, { o: 0 })])),
      J(39, 41, 0, [ink([E(0, 0, 2.6, 1.7, WHITE), C(2.2, -0.8, 1.6, WHITE)])], puff(3.4, [52], 22, 10, 2.5, 1.7), 1, 0),
      bubble(RED, '!', loop(3.4, [k(0), k(3, { a: -9 }), k(6, { a: 9 }), k(9, { a: -7 }), k(12, { a: 6 }), k(16, {}), k(50, {}), k(53, { a: -9 }), k(56, { a: 9 }), k(59, { a: -6 }), k(63, {})]))],
  }),
  // asleep: slow breath, the head sinks, jerks up, settles; three «z» in a row
  idle: () => ({
    eyes: 'closed', mouth: 'o',
    go: loop(5, [k(0), k(45, { sy: 1.035, sx: 0.99 })]),
    head: { a: 8, go: loop(5, [k(0), k(35, { a: 12, e: 'in' }), k(60, { a: 16, e: 'back' }), k(66, { a: 3 }), k(78, { a: 7 })]) },
    armL: { a: 5, go: sway(8, 2.5) }, armR: { a: -5, go: sway(-8, 2.5) },
    front: [J(50, 30, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(8, { o: 1 }), k(40, { o: 0, dx: 5, dy: -7 }), k(100, { o: 0 })]), 0.8),
      J(54.5, 23.5, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(20, { o: 0 }), k(28, { o: 1 }), k(62, { o: 0, dx: 6, dy: -8 }), k(100, { o: 0 })]), 1.05),
      J(60.5, 15.5, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(40, { o: 0 }), k(48, { o: 1 }), k(86, { o: 0, dx: 6, dy: -8 }), k(100, { o: 0 })]), 1.35)],
  }),
};

// ── what a working chat is doing, when its tool says so (ADR 0305) ────────────────────────────────────────────────────
/** The kinds of work with a scene of their own (the same moments as the lines, shared/agent-quips.ts): reading a file,
 *  running a command, running tests, searching, a web page, handing work to another agent. An edit, and anything the
 *  app cannot name, is the role's own work. The same acting for every role, in its own looks. */
export type SpriteActivity = 'read' | 'run' | 'test' | 'search' | 'web' | 'delegate';
const PAPER = '#eceef4', LINE = '#b4bacb', STEEL = '#59627a', DARK = '#1f2430';
/** A sheet with two lines of text, its top left corner at 0 0. */
const sheet = (w: number, h: number): Shape[] => [rr(0, 0, w, h, 1.2, PAPER), S(`M2 ${h * 0.36}H${w - 2}M2 ${h * 0.68}H${w - 4.4}`, LINE, 0.9)];
const ACT: Record<SpriteActivity, (look: Look) => Pose> = {
  // an open book in both hands: the head follows the lines, left to right, three times, then a page turns
  read: look => {
    const page = 'M0 -3.4C2.4 -4.6 5 -4.6 7.6 -3.6V3C5 2 2.4 2 0 3.2Z';
    return {
      blink: true, mouth: 'smile', lean: 1,
      go: loop(4.4, [k(0), k(50, { sy: 1.012 })]),
      head: { a: 5, go: loop(4.4, [k(0), k(16, { a: 10 }), k(20, { a: 5, e: 'out' }), k(36, { a: 10 }), k(40, { a: 5, e: 'out' }), k(56, { a: 10 }), k(66, { a: 4 }), k(74, { a: 8, e: 'out' }), k(84, { a: 5 })]) },
      armR: { a: -40, b: -60, goB: loop(4.4, [k(0), k(60, { e: 'in' }), k(68, { a: -72, e: 'out' }), k(78, {})]) }, armL: { a: -30, b: -80 },
      front: [J(40.2, 47.4, -4, [
        rr(-8.2, -3, 16.4, 6.8, 1, '#b5483a'),
        P('M0 -3.4C-2.4 -4.6 -5 -4.6 -7.6 -3.6V3C-5 2 -2.4 2 0 3.2Z', '#fdfaf0'), P(page, '#f4eedc'),
        S('M-6.2 -1.9H-1.6M-6.2 -0.5H-1.6M-6.2 0.9H-2.8', '#b9b2a0', 0.7), S('M1.6 -1.9H6.2M1.6 -0.5H6.2M1.6 0.9H5', '#b9b2a0', 0.7),
        // the page that turns: it folds onto the spine and opens on the other side
        J(0, 0, 0, [P(page, '#fdfaf0'), S('M1.6 -1.9H6.2M1.6 -0.5H6.2', '#cfc8b4', 0.7)], loop(4.4, [k(0), k(60, { e: 'in' }), k(67, { sx: 0.04, e: 'out' }), k(75, { sx: -1 }), k(76, { sx: -1, o: 0, e: 'hold' }), k(100, { o: 0 })])),
        S('M0 -3.4V3.2', '#d9d2bd', 0.7),
        C(-7.2, 2.4, 1.6, look.skin), C(7.2, 2.4, 1.6, look.skin),
      ])],
    };
  },
  // a finger up, then down on a big «enter» key, twice: the key sinks, the terminal on its pole prints a line each
  // time while its gear turns
  run: () => {
    const hits = [16, 52], T = 3.4;
    const line = (y: number, w: number, c: string, from: number, to: number): Node =>
      J(59.4, y, 0, [S(`M0 0H${w}`, c, 1.4)], loop(T, [k(0, { sx: 0, e: 'hold' }), k(from, { sx: 0, e: 'lin' }), k(to, { sx: 1 }), k(92, { sx: 1 }), k(96, { sx: 1, o: 0, e: 'hold' }), k(100, { sx: 0, o: 0 })]));
    return {
      blink: true, mouth: 'grin',
      head: { a: 3, go: loop(T, [...hits.flatMap(h => [k(h, { e: 'out' }), k(h + 3, { a: 7 }), k(h + 14, { a: 2 })]), k(84, { a: 6 }), k(94, {})]) },
      go: loop(T, hits.flatMap(h => [k(h - 14, { e: 'out' }), k(h - 5, { dy: -1.1, sy: 1.025, e: 'in' }), k(h, { sy: 0.96, sx: 1.03, e: 'out' }), k(h + 5, {})])),
      armR: { a: -70, b: -30, go: loop(T, hits.flatMap(h => [k(h - 14, { e: 'out' }), k(h - 5, { a: -138, e: 'in' }), k(h, { a: -68, e: 'out' }), k(h + 3, { a: -76 }), k(h + 7, {})])),
        goB: loop(T, hits.flatMap(h => [k(h - 14, { e: 'out' }), k(h - 5, { a: -18, e: 'in' }), k(h, { a: -32, e: 'out' }), k(h + 7, {})])) },
      armL: { a: 24, b: -40 },
      back: [
        rr(42.6, 53.6, 9.6, 10.8, 1.4, '#3a4152'), S('M44.6 57.4L47.4 54.8M47.6 57.4L50.4 54.8', AMBER, 1.1, 0.8),
        J(47.4, 53.6, 0, [rr(-5.4, -4.4, 10.8, 4.4, 1.4, PAPER), rr(-5.4, -1.5, 10.8, 1.5, 0.7, '#aab2bf'), S('M2 -3.6V-2.5H-2M-0.9 -3.5L-2 -2.5L-0.9 -1.6', INK, 0.9)],
          loop(T, hits.flatMap(h => [k(h - 1, { e: 'out' }), k(h, { dy: 1.5, sy: 0.66, e: 'out' }), k(h + 6, {})]))),
        S('M66 47.4V63.6', STEEL, 1.8), S('M60.6 64.4H71.4', STEEL, 2),
        rr(55.4, 28.4, 21.6, 19.4, 2.4, STEEL), rr(56.8, 29.8, 18.8, 16.6, 1.5, DARK),
        S('M59.4 33L61.4 34.6L59.4 36.2', GREEN, 1.2), J(63.4, 34.6, 0, [rr(0, -1.7, 2.4, 3.4, 0.4, GREEN)], loop(0.9, [k(0, { e: 'hold' }), k(50, { o: 0, e: 'hold' })])),
        line(39.4, 9, WHITE, hits[0]! + 2, hits[0]! + 16), line(42, 12.4, SKY, hits[1]! + 2, hits[1]! + 14), line(44.6, 6.4, '#7ee0a8', hits[1]! + 16, hits[1]! + 26),
        J(71.4, 33.6, 0, [ring(0, 0, 1.9, '#aab2bf', 1.2), S('M0 -2.3V-3.3M0 2.3V3.3M-2.3 0H-3.3M2.3 0H3.3M-1.6 -1.6L-2.4 -2.4M1.6 1.6L2.4 2.4M-1.6 1.6L-2.4 2.4M1.6 -1.6L2.4 -2.4', '#aab2bf', 1.1)],
          loop(2.6, [k(0, { e: 'lin' }), k(100, { a: 360 })])),
      ],
    };
  },
  // a test tube held up and swirled, bubbles rising from it; on the board beside it the checks tick one after the other
  test: () => {
    const T = 4.4;
    const row = (y: number, at: number): Node[] => [
      S(`M59.6 ${y}h3v3h-3Z`, STEEL, 0.9), S(`M64.6 ${y + 1.5}H72.6`, LINE, 1),
      J(61.1, y + 1.5, 0, [S('M-1.7 -0.2L-0.4 1.2L2.2 -1.9', GREEN, 1.5)], loop(T, [k(0, { o: 0, sx: 0.2, sy: 0.2, e: 'hold' }), k(at, { o: 0, sx: 0.2, sy: 0.2, e: 'back' }), k(at + 7, { o: 1 }), k(92, { o: 1 }), k(97, { o: 0 }), k(100, { o: 0, sx: 0.2, sy: 0.2 })])),
    ];
    const bubbleUp = (x: number, r: number, at: number[]): Node => J(x, 31.4, 0, [C(0, 0, r, '#bff3d6')], puff(T, at, 16, x > 48.4 ? 2 : -2, -8, 1.3), 1, 0);
    return {
      blink: true, mouth: 'smile', lean: 1,
      head: { a: 4, go: loop(T, [k(0), k(24, { a: 8 }), k(40, { a: 3 }), k(62, { a: 8 }), k(80, { a: 3, e: 'out' }), k(88, { a: 9 }), k(96, {})]) },
      go: loop(T, [k(0), k(50, { sy: 1.014 })]),
      // the tube stays upright: its own angle undoes the arm's (-95 at the shoulder, -25 at the elbow)
      armR: { a: -95, b: -25, go: sway(-100, 0.55), ha: 120, goH: loop(1.1, [k(0, { a: 108 }), k(50, { a: 132 })]),
        held: [rr(-2.5, -12, 5, 14.6, 2.5, '#e9f6ff', 0.62), P('M-2.5 -5.4H2.5V0.1A2.5 2.5 0 0 1 -2.5 0.1Z', GREEN, 0.92), S('M-3.2 -12H3.2', WHITE, 1.2), S('M-1.2 -10.2V-7', WHITE, 0.8, 0.8)] },
      armL: { a: 26, b: -52 },
      back: [S('M66.4 50.4V63.6', STEEL, 1.8), S('M61.4 64.4H71.4', STEEL, 2), rr(56.4, 29.6, 20, 21.4, 1.8, '#f1e6cb'), rr(63, 28, 6.8, 3, 1.1, '#8a96a8'),
        ...row(34.6, 20), ...row(39.8, 44), ...row(45, 68)],
      front: [bubbleUp(47.8, 0.9, [8, 52]), bubbleUp(49, 1.2, [26, 70]), bubbleUp(48.2, 0.7, [40, 84])],
    };
  },
  // a lens passed down and up over a pile of sheets, leaning in: the one it was looking for lights up
  search: () => {
    const T = 4.2;
    const arm: [number, number, Ease?][] = [[0, -112], [30, -62], [36, -66, 'out'], [62, -96, 'back'], [86, -96], [100, -112]];
    return {
      blink: true, mouth: 'o', lean: 3,
      head: { a: 4, go: loop(T, [k(0), k(30, { a: 10 }), k(62, { a: 5, e: 'back' }), k(70, { a: 9 }), k(86, { a: 7 }), k(96, {})]) },
      go: loop(T, [k(0), k(30, { a: 6, sy: 0.985 }), k(62, { a: 4 }), k(86, { a: 4 }), k(96, {})]),
      armR: { a: -112, b: -10, go: loop(T, arm.map(([at, a, e]) => k(at, { a, ...(e ? { e } : {}) }))),
        held: [S('M0 0V4.4', '#6b4423', 2.2), C(0, 9.4, 4.5, SKY, 0.55), ring(0, 9.4, 4.9, '#f4f6fa', 1.9), S('M-2.4 7.4C-1.6 6.6 -0.8 6.2 0.2 6.2', WHITE, 1)] },
      armL: { a: 20, b: -30 },
      back: [J(50.6, 31, -3, sheet(13, 7.4)), J(51.6, 40.8, 2, sheet(13, 7.4)), J(50.2, 50.6, -2, sheet(13, 7.4)),
        J(58, 44.5, 2, [S('M-7.4 -4.6H7.4V4.6H-7.4Z', GOLD, 1.5)], loop(T, [k(0, { o: 0, e: 'hold' }), k(60, { o: 0, e: 'out' }), k(66, { o: 1 }), k(88, { o: 1 }), k(96, { o: 0 }), k(100, { o: 0 })]), 1, 0)],
      front: [J(67.6, 38.6, 0, [ink([P(STAR, WHITE)])], pop(T, 64, 86))],
    };
  },
  // the world spinning on a fingertip, a pointer clicking beside it: the head looks up at it
  web: look => {
    const T = 3.6;
    const click = (x: number, y: number, d: string, at: number[]): Node => J(x, y, 0, [ink([S(d, WHITE, 1.2)])], puff(T, at, 9, 0, 0, 1.5), 1, 0);
    return {
      eyes: 'up', mouth: 'smile',
      head: { a: 2, go: loop(T, [k(0), k(40, { a: 6 }), k(70, { a: 1 })]) },
      go: loop(T, [k(0), k(50, { dy: -0.5, sy: 1.012 })]),
      // the globe stays upright over the hand (-95 at the shoulder, -5 at the elbow)
      armR: { a: -95, b: -5, go: sway(-91, 0.9), ha: 100, goH: sway(96, 0.9),
        held: [S('M0.8 -1.8L3.4 -4.2', look.skin, 1.7),
          J(4.6, -9.6, 0, [C(0, 0, 6.4, '#3b82d9'), P('M-5 -2.8C-3.2 -4.8 -0.6 -4.4 0 -2.7C0.6 -1 -1.4 -0.2 -2.7 0.7C-4.1 1.6 -5.7 0.9 -5.9 -0.9Z', '#58c98a'), P('M1.4 1.8C3 1.1 5 1.8 4.8 3.4C4.6 4.8 2.7 5.5 1.6 4.4C0.7 3.5 0.5 2.3 1.4 1.8Z', '#58c98a'),
            J(0, 0, 0, [S('M0 -6.4C3.9 -3.6 3.9 3.6 0 6.4C-3.9 3.6 -3.9 -3.6 0 -6.4', '#d6ebff', 0.8, 0.85)], loop(1.8, [k(0, { e: 'lin' }), k(50, { sx: 0.06, e: 'lin' })])),
            S('M-6.4 0H6.4', '#d6ebff', 0.8, 0.85), S('M-3.7 -3.8C-2.3 -5 -0.5 -5.4 0.9 -5', WHITE, 1, 0.8)])] },
      armL: { a: 30, b: -60 },
      front: [
        J(63.6, 38.4, 0, [P('M0 0V7L1.9 5.3L3.2 8.2L4.6 7.6L3.3 4.8H5.8Z', WHITE), S('M0 0V7L1.9 5.3L3.2 8.2L4.6 7.6L3.3 4.8H5.8Z', INK, 0.8)],
          loop(T, [k(0, { dx: 7, dy: 7 }), k(22, { dx: 0, dy: 0, e: 'out' }), k(26, { sx: 0.84, sy: 0.84 }), k(30, {}), k(56, { dx: 5, dy: -6 }), k(72, { dx: -1, dy: 2, e: 'out' }), k(76, { dx: -1, dy: 2, sx: 0.84, sy: 0.84 }), k(80, { dx: -1, dy: 2 }), k(100, { dx: 7, dy: 7 })])),
        click(62.4, 36.4, 'M0 0L-2 -2', [26]), click(64, 35.6, 'M0 0V-2.8', [26]), click(61.4, 38.4, 'M0 0L-2 -2', [76]), click(63, 37.6, 'M0 0V-2.8', [76]),
      ],
    };
  },
  // a paper plane: the arm goes back, throws it, and it flies off to whoever gets the work; a look after it
  delegate: () => {
    const T = 3.2, GO = 30;
    return {
      eyes: 'happy', mouth: 'grin',
      head: { go: loop(T, [k(0), k(18, { a: -5 }), k(GO, { a: 5, e: 'out' }), k(56, { a: -3 }), k(80, { a: -3 }), k(94, {})]) },
      go: loop(T, [k(0), k(18, { a: -5, sy: 0.98, e: 'in' }), k(GO, { a: 5, sy: 1.02, e: 'out' }), k(44, { a: 2 }), k(86, {})]),
      armR: { a: -60, b: -70, go: loop(T, [k(0), k(18, { a: -24, e: 'in' }), k(GO, { a: -112, e: 'out' }), k(40, { a: -104 }), k(70, { a: -104 }), k(88, {})]),
        goB: loop(T, [k(0), k(18, { a: -134, e: 'in' }), k(GO, { a: -6, e: 'out' }), k(70, { a: -6 }), k(88, {})]),
        // the plane in the hand until it leaves, and a new one when the arm comes back
        held: [P('M0 8L-4.2 -3.2L0 -0.6L4.2 -3.2Z', PAPER), S('M0 8V-0.6', LINE, 0.7)], goH: loop(T, [k(0, { e: 'hold' }), k(GO, { o: 0, e: 'hold' }), k(84, { o: 0, e: 'out' }), k(92, {})]) },
      armL: { a: 22, b: -50 },
      front: [
        J(50, 41.4, -24, [P('M0 0L-11.6 -4.4L-8.4 0L-11.6 4.4Z', PAPER), P('M0 0L-8.4 0L-11.6 4.4Z', '#cfd4df'), S('M0 0H-8.4', LINE, 0.7)],
          loop(T, [k(0, { o: 0, e: 'hold' }), k(GO - 0.2, { o: 0, e: 'hold' }), k(GO, { o: 1, e: 'out' }), k(54, { o: 1, dx: 17, dy: -8, a: -30 }), k(66, { o: 1, dx: 24, dy: -9, a: -8, e: 'in' }), k(76, { o: 0, dx: 29, dy: -7, a: 2 }), k(100, { o: 0 })]), 1, 0),
        J(52, 40.4, -24, [ink([S('M0 0H-3.4M-6 0H-8.4', WHITE, 0.9)])], puff(T, [GO + 6], 14, 6, -3), 1, 0),
      ],
    };
  },
};
export const SPRITE_ACTIVITIES = Object.keys(ACT) as readonly SpriteActivity[];
export const isSpriteActivity = (v: string | null | undefined): v is SpriteActivity => !!v && Object.hasOwn(ACT, v);

// ── what the user's click does to it (ADR 0297) ─────────────────────────────────────────────────────────────────────
/** A pat (the left click) or a whack of the stick (the right one): played once over whatever it was doing. */
export type SpriteReaction = 'pat' | 'whack';
/** How long each lasts, in seconds: then the person goes back to its state. */
export const REACTION_S: Record<SpriteReaction, number> = { pat: 1.3, whack: 1.6 };
const HEART = 'M0 3.6C-4.6 0.4 -4 -3.4 -1.6 -3.4C-0.6 -3.4 0 -2.6 0 -2C0 -2.6 0.6 -3.4 1.6 -3.4C4 -3.4 4.6 0.4 0 3.6Z';
/** the patting hand's glove: a warm yellow that reads on a light and on a dark strip */
const GLOVE = '#ffd98a';
const REACT: Record<SpriteReaction, () => Pose> = {
  // an open hand comes down from the top right and pats the head twice, the way one pats a dog: the head sinks and
  // springs back, then a happy wiggle and a small hop, hearts rising
  pat: () => {
    const T = REACTION_S.pat;
    const heart = (x: number, y: number, at: number, dx: number): Node =>
      J(x, y, 0, [P(HEART, '#ff5d7a')], once(T, [k(0, { o: 0, sx: 0.2, sy: 0.2, e: 'hold' }), k(at, { o: 0, sx: 0.2, sy: 0.2, e: 'back' }), k(at + 10, { o: 1 }), k(at + 42, { o: 0, dx, dy: -13, sx: 1.25, sy: 1.25 }), k(100, { o: 0 })]), 1, 0);
    const lift = (m: 1 | -1): Track => once(T, [k(0), k(50), k(58, { a: 46 * m, e: 'back' }), k(70, { a: 30 * m }), k(80, { a: 46 * m }), k(92, {})]);
    return {
      eyes: 'happy', mouth: 'grin',
      head: { go: once(T, [k(0), k(18, { e: 'in' }), k(22, { dy: 1.8, sy: 0.92, sx: 1.04, e: 'out' }), k(32, { a: -4 }), k(37, { a: -4, e: 'in' }), k(41, { dy: 1.8, sy: 0.92, sx: 1.04, e: 'out' }), k(56, { a: 5 }), k(68, { a: -4 }), k(80, { a: 3 }), k(92, {})]) },
      go: once(T, [k(0), k(18, { e: 'in' }), k(22, { sy: 0.96, sx: 1.02, e: 'out' }), k(32, {}), k(37, { e: 'in' }), k(41, { sy: 0.96, sx: 1.02, e: 'out' }), k(56, { dy: -2.6, sy: 1.03, e: 'in' }), k(66, { sy: 0.94, sx: 1.04, e: 'out' }),
        k(74, { dy: -1.4, e: 'in' }), k(82, { sy: 0.97, e: 'out' }), k(90, {})]),
      armL: { a: 12, go: lift(1) }, armR: { a: -12, go: lift(-1) },
      front: [
        // an open hand, palm down, fingers spread over the head: pat, pat
        J(38, 12, -6, [rr(5.6, -2.7, 4.8, 5.4, 1.5, '#e2483d'), S('M-1.6 -1.9L-8.6 -4', GLOVE, 2.2), S('M-2.2 -0.5L-10 -1.2', GLOVE, 2.3), S('M-2.2 1L-9.6 1.5', GLOVE, 2.2), S('M-1.6 2.3L-7.8 4', GLOVE, 2),
          S('M2.4 2.2L0.2 6', GLOVE, 2.3), rr(-3.4, -3, 10, 6, 2.8, GLOVE), S('M-2.6 -1.2L-3.4 -1.3M-2.8 0.3L-3.7 0.3M-2.6 1.7L-3.4 1.9', '#d9a25e', 0.6)],
          once(T, [k(0, { o: 0, dx: 15, dy: -9, e: 'hold' }), k(4, { o: 1, dx: 15, dy: -9, e: 'out' }), k(15, { o: 1, dx: 1, dy: -4, e: 'in' }), k(22, { o: 1, dy: 4.6, sy: 0.82, a: -2, e: 'out' }), k(32, { o: 1, dy: -6.5, a: -12, e: 'in' }),
            k(41, { o: 1, dy: 4.6, sy: 0.82, a: -2, e: 'out' }), k(52, { o: 1, dx: 1, dy: -3, a: -10, e: 'in' }), k(66, { o: 1, dx: 13, dy: -8 }), k(73, { o: 0, dx: 15, dy: -9 }), k(100, { o: 0 })]), 1.3, 0),
        heart(19, 21, 24, -5), heart(50, 25, 44, 6), heart(27, 10, 50, -2)],
    };
  },
  // a stick comes in from the top right, rears back and lands on the head: the eyes are already squeezed shut, the
  // head sinks into the shoulders and the whole person squashes, a star bursts where it lands; then the hands go to
  // the head and it sways, dizzy, three small stars turning round above it, and it comes back to its place
  whack: () => {
    const T = REACTION_S.whack, HIT = 28;
    const hold = (m: 1 | -1): Track => once(T, [k(0), k(HIT, { e: 'out' }), k(34, { a: 58 * m }), k(46, { a: 126 * m }), k(80, { a: 126 * m }), k(93, {})]);
    const fold = (m: 1 | -1): Track => once(T, [k(0), k(34, { e: 'out' }), k(46, { a: 104 * m }), k(80, { a: 104 * m }), k(93, {})]);
    const mark = (x: number, y: number, d: string, dx: number): Node =>
      J(x, y, 0, [ink([S(d, WHITE, 1.5)])], once(T, [k(0, { o: 0, e: 'hold' }), k(HIT, { o: 0, e: 'hold' }), k(HIT + 1, { o: 1, e: 'out' }), k(HIT + 15, { o: 0, dx, dy: -2 }), k(100, { o: 0 })]), 1, 0);
    // a small star on a flat ring above the head, two turns: bigger in front, smaller behind
    const turn = (phase: number): Node => {
      const from = 38, step = 3, n = 16, keys: Key[] = [k(0, { o: 0, e: 'hold' }), k(from - 2, { o: 0, sx: 0.3, sy: 0.3, dx: 9 * Math.cos(phase), e: 'out' })];
      for (let i = 0; i <= n; i++) {
        const th = phase + i * Math.PI / 4, z = 0.8 + 0.28 * Math.sin(th);
        keys.push(k(from + i * step, { o: 1, dx: Math.round(90 * Math.cos(th)) / 10, dy: Math.round(24 * Math.sin(th)) / 10, sx: z, sy: z, a: i * 20, e: 'lin' }));
      }
      keys.push(k(from + n * step + 6, { o: 0, dx: 9 * Math.cos(phase), dy: -4, sx: 0.4, sy: 0.4 }), k(100, { o: 0 }));
      return J(32.5, 12.5, 0, [P(STAR, GOLD)], once(T, keys), 0.62, 0);
    };
    return {
      eyes: 'closed', mouth: 'o',
      go: once(T, [k(0), k(HIT, { e: 'out' }), k(HIT + 4, { sy: 0.84, sx: 1.1, e: 'out' }), k(40, { sy: 1.05, sx: 0.97, dy: -0.8 }), k(47, { sy: 0.98 }), k(56, { a: -4.5 }), k(68, { a: 4.5 }), k(80, { a: -2.5 }), k(92, {})]),
      head: { go: once(T, [k(0), k(HIT, { e: 'out' }), k(HIT + 4, { dy: 3.2, sy: 0.8, sx: 1.1, e: 'out' }), k(40, { dy: -0.6, sy: 1.04 }), k(48, { a: 8 }), k(60, { a: -9 }), k(72, { a: 6 }), k(84, { a: -3 }), k(94, {})]) },
      armL: { a: 8, go: hold(1), goB: fold(1) }, armR: { a: -8, go: hold(-1), goB: fold(-1) },
      front: [
        J(63, 16, 30, [P('M0 -1.3L-25.6 -2.7A2.7 2.7 0 0 0 -25.6 2.7L0 1.3A1.3 1.3 0 0 0 0 -1.3Z', '#a8733c'), S('M-7 -0.5L-24.4 -1.3', '#c9955c', 0.9), S('M-2.2 -1.4V1.4M-4.6 -1.5V1.5', '#5b3a1c', 1)],
          once(T, [k(0, { o: 0, dx: 12, e: 'hold' }), k(3, { o: 1, dx: 12, e: 'out' }), k(15, { o: 1, a: 58, dx: 5, dy: 10 }), k(22, { o: 1, a: 64, dx: 6, dy: 11, e: 'in' }), k(HIT, { o: 1, a: -8, e: 'out' }), k(34, { o: 1, a: 14 }),
            k(40, { o: 1, a: 6 }), k(52, { o: 1, a: 34, dx: 10, dy: 2, e: 'in' }), k(60, { o: 0, dx: 12 }), k(100, { o: 0 })]), 1, 0),
        J(35.5, 17.5, 0, [P(STAR, GOLD), C(0, 0, 1.3, WHITE)], once(T, [k(0, { o: 0, sx: 0.2, sy: 0.2, e: 'hold' }), k(HIT - 0.4, { o: 0, sx: 0.2, sy: 0.2, e: 'hold' }), k(HIT, { o: 1, sx: 0.6, sy: 0.6, e: 'out' }), k(HIT + 6, { o: 1, sx: 1.7, sy: 1.7, a: 20 }),
          k(HIT + 15, { o: 0, sx: 2.1, sy: 2.1, a: 38 }), k(100, { o: 0 })]), 1, 0),
        mark(28.4, 15, 'M0 0L-3.6 -2.6', -3), mark(42.6, 15, 'M0 0L3.6 -2.6', 3), mark(35.5, 10.6, 'M0 0V-4', 0),
        turn(0), turn(Math.PI * 2 / 3), turn(Math.PI * 4 / 3)],
    };
  },
};
export const SPRITE_REACTIONS: readonly SpriteReaction[] = ['pat', 'whack'];

const cache = new Map<string, SpriteScene>();
/** The scene of a role in a state (built once). At work, with an `activity` the app can name, the scene of that
 *  activity; without, the role's own work. */
export function spriteScene(id: SpriteId, state: SpriteState, activity?: SpriteActivity | null): SpriteScene {
  const act = state === 'work' && activity ? activity : null, key = act ? `${id}:work:${act}` : `${id}:${state}`;
  let s = cache.get(key);
  if (!s) { const look = lookOf(id); cache.set(key, s = { nodes: person(look, act ? ACT[act](look) : (state === 'work' ? WORK[id] : SHARED[state])()) }); }
  return s;
}
/** A role's reaction to a click (built once): the same acting for everyone, in the role's own looks. */
export function reactionScene(id: SpriteId, kind: SpriteReaction): SpriteScene {
  const key = `${id}:${kind}`;
  let s = cache.get(key);
  if (!s) cache.set(key, s = { nodes: person(lookOf(id), REACT[kind]()) });
  return s;
}
export const SPRITE_IDS = Object.keys(WORK) as readonly SpriteId[];
export const isSpriteId = (id: string): id is SpriteId => Object.hasOwn(WORK, id);
export const SPRITE_STATES: readonly SpriteState[] = ['work', 'think', 'wait', 'done', 'err', 'idle'];
