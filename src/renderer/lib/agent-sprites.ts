// The people of the roles, scene by scene (ADR 0295; grown up with ADR 0306): each role is its portrait's head
// (lib/character-art.ts) on an adult body of its own build and clothes, free on the strip (no tile), and does its own
// job while its chat works: the Orchestrator (an old wizard in a midnight robe) leads the work with its wand, the
// Strategist slams a chess knight on its table, the Scout strides and raises a spyglass, the Artisan (a bare-chested
// smith with a cigar) hammers hot iron on an anvil, the Sentinel (dark plate, closed helm) watches and slams its
// halberd, the Herald blows a long trumpet; a chat without a role is a tired developer at a standing desk. The other
// states are shared: thinking (a hand at the chin, a thought), waiting for the user (arms folded, a foot tapping, an
// amber «!»), done (a fist pump, then fists on the hips under a green tick), error (a facepalm, a red «!»), idle
// (asleep on its feet, arms folded). The kind of work at hand has its own scene for every role (ADR 0305). A click
// plays a reaction once over any of them (ADR 0297): a pat on the head, a whack of the stick. Every scene is a small
// piece of acting written as tracks of keys (lib/sprite-rig.ts): a move loads, strikes, overshoots and settles.
// Drawn by components/AgentSprite.tsx.
import type { CharacterId } from '../../shared/characters';
import { CHARACTERS, shade, type Features, type Shape } from './character-art';
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

// ── who they are: the body and the clothes under each role's head ───────────────────────────────────────────────────
const COAL = '#191a22', ROBE = '#2a2456', IRON = '#3b4252', IRON_HI = '#5d6780', BLOOD = '#b3261e', LEATHER = '#5a3a22', SMITH = CHARACTERS.artisan.skin;
/** A shape of one shoulder mirrored for the other: `x` turns a distance from the arm's line to that side. */
const sided = (m: 1 | -1, d: (x: (v: number) => number) => string): string => d(v => Math.round(v * m * 100) / 100);
/** The cigar's ember and its smoke, in the head's box (the cigar itself is in the character's `over`). */
const smoke = (): Node[] => [
  J(43.9, 42.95, 0, [C(0, 0, 1.5, '#ffd27a')], loop(3.6, [k(0), k(58), k(66, { o: 1, sx: 1.3, sy: 1.3 }), k(80, {})]), 1, 0.25),
  J(45.2, 41, 0, [ink([C(0, 0, 1.7, WHITE, 0.5)])], puff(3.6, [4, 68], 26, 4, -13, 2.4), 1, 0),
  J(46, 39.4, 0, [ink([C(0, 0, 1.3, WHITE, 0.45)])], puff(3.6, [14, 76], 22, 8, -15, 2.6), 1, 0),
  J(44.6, 40.2, 0, [ink([C(0, 0, 1.1, WHITE, 0.4)])], puff(3.6, [40], 30, 2, -17, 2.2), 1, 0),
];
type Body = Omit<Look, keyof Features | 'jaw' | 'hairBack' | 'under' | 'hair' | 'over'>;
/** `live`: with what moves by itself all the time (smoke, a cape in the wind); a scene that ends stands still. */
const BODY: Record<Exclude<SpriteId, 'plain'>, (live: boolean) => Body> = {
  // a midnight robe down to the ankles with a gold hem and a few stars, wide sleeves, soft shoes under it
  orchestrator: () => ({
    build: { sh: 6.9, waist: 5, hip: 5.4, arm: 3.9, leg: 3.8, neck: 2 }, top: ROBE, cuff: '#e3c067', pants: ROBE, shoes: '#4a3a78',
    wear: [P('M26.6 46.6H37.4C38.6 51.4 39.8 56.4 41 61.6C38 62.7 35 63.1 32 63.1C29 63.1 26 62.7 23 61.6C24.2 56.4 25.4 51.4 26.6 46.6Z', ROBE),
      P('M30.4 36.4H33.6L34.8 62.9C33 63.1 31 63.1 29.2 62.9Z', '#3a2f6e'), S('M23.2 61.5C29 63.3 35 63.3 40.8 61.5', '#e3c067', 1.1), S('M26.8 47.4H37.2', '#e3c067', 1),
      J(27.4, 55, 0, [P(STAR, '#e3c067')], undefined, 0.22), J(37, 52.4, 0, [P(STAR, '#e3c067')], undefined, 0.18), J(36.4, 58.6, 0, [P(STAR, '#e3c067')], undefined, 0.16)],
  }),
  // shirt sleeves rolled to the elbow, a charcoal waistcoat, an ochre tie
  strategist: () => ({
    build: { sh: 6.9, waist: 4.8, hip: 5.1, arm: 3.4, leg: 4.1, neck: 2.1 }, top: '#eef0f5', fore: CHARACTERS.strategist.skin, pants: '#2c2f3d', shoes: '#111218',
    wear: [P('M30.8 34.6H33.2L32.8 36L33.5 40L32 41.6L30.5 40L31.2 36Z', '#d9a23c'),
      P('M26.6 35.4L32 42.2L37.4 35.4L38.6 37.4L37.5 47.5H26.5L25.4 37.4Z', '#2c2f3d'), C(32, 43.8, 0.45, '#8a8d99'), C(32, 45.6, 0.45, '#8a8d99'), S('M27 47.3H37', '#1d1f29', 1)],
  }),
  // a long olive coat open over a tan shirt, a red scarf, a strap across the chest, tall boots
  scout: () => ({
    build: { sh: 7.4, waist: 5.2, hip: 5.5, arm: 3.8, leg: 4.3, neck: 2.3 }, top: '#d9c08a', sleeve: '#55613a', pants: '#4f3f2c', shin: '#33230f', shoes: '#2a1c0c',
    behind: [P('M24.4 40L22.6 57.4H41.4L39.6 40Z', '#454f2e')],
    wear: [S('M27.6 35.4L36.6 46.8', '#3a2a16', 1.3), S('M27 47.4H37', '#2a1c0c', 1.3), C(32, 47.4, 0.8, '#c9a25c'),
      P('M24.2 35.6L28.8 34.4L27.6 47.4L26.8 56.2L22.8 56.8L23.4 44Z', '#55613a'), P('M39.8 35.6L35.2 34.4L36.4 47.4L37.2 56.2L41.2 56.8L40.6 44Z', '#55613a'),
      P('M28.6 33.6H35.4L34.6 36L32 38.8L29.4 36Z', '#c23a2a')],
  }),
  // bare to the waist under a leather apron: a bull's shoulders, arms like hams, leather at the wrists
  artisan: () => ({
    build: { sh: 9.8, waist: 6.6, hip: 6.5, arm: 5.6, leg: 5.2, neck: 3.4 }, top: SMITH, cuff: LEATHER, pants: '#2a2d38', shin: '#2b1c12', shoes: '#22160d',
    pad: m => [C(0, 0.2, 3.5, SMITH), E(-0.5 * m, 3.5, 3.3, 3.5, SMITH), S(sided(m, x => `M${x(1.7)} 1.4Q${x(2.7)} 3.6 ${x(1.5)} 5.6`), shade(SMITH, 0.24), 0.8)],
    wear: [S('M24.2 39.2Q28 41.6 32 39.6Q36 41.6 39.8 39.2', shade(SMITH, 0.26), 0.9), S('M28.4 35.2Q30 36 31.4 35.4M35.6 35.2Q34 36 32.6 35.4', shade(SMITH, 0.2), 0.8),
      P('M27 38.8H37L39 47L40 57.6H24L25 47Z', LEATHER), S('M27.4 39L25.6 34.9M36.6 39L38.4 34.9', LEATHER, 1.6), S('M25.2 47.2H38.8', '#45290f', 1.3),
      rr(29.3, 49.6, 5.4, 3.6, 0.8, '#45290f'), S('M27.4 40H36.6', '#7a5330', 0.8)],
  }),
  // dark plate from the neck down: spiked shoulders, a red mark on the chest, a cape the colour of old blood
  sentinel: live => ({
    build: { sh: 8.7, waist: 5.9, hip: 6, arm: 4.5, leg: 4.8, neck: 2.8 }, top: IRON, sleeve: '#262b37', fore: IRON, hand: COAL, pants: '#262b37', shin: IRON, shoes: COAL,
    behind: [J(32, 35, 0, [P('M-8.4 1L-11.4 24C-7.4 26 7.4 26 11.4 24L8.4 1Z', '#6e1a16'), S('M-4 6L-5.4 23.6M3.6 6L4.6 24', '#571310', 0.9)], live ? sway(1.6, 2.6) : undefined)],
    cap: m => [P(sided(m, x => `M${x(-4.6)} 2.4C${x(-5)} -2.2 ${x(-2.2)} -4.2 ${x(1)} -4C${x(3.2)} -3.8 ${x(3.8)} -1.8 ${x(3.6)} 2.4Z`), IRON_HI),
      P(sided(m, x => `M${x(-4)} -1.6L${x(-7.4)} -6L${x(-1.4)} -3.9Z`), '#8d96a8'), S(sided(m, x => `M${x(-4.2)} 1.6H${x(3.4)}`), '#262b37', 0.8)],
    wear: [P('M26.4 36.4C29 35.2 35 35.2 37.6 36.4L37 43.4C34 45 30 45 27 43.4Z', '#4a5263'), S('M29.6 38.4L32 41.6L34.4 38.4', BLOOD, 1.5),
      S('M26.2 47.3H37.8', COAL, 1.7), C(32, 47.3, 1, '#8d96a8'), P('M26 48H31.5L31 54H25.4ZM32.5 48H38L38.6 54H33Z', IRON_HI), S('M32 31.6V34.4', '#262b37', 5.6)],
  }),
  // a stout man in a long blue coat with gold edges over a red waistcoat, lace at the throat, breeches and stockings
  herald: () => ({
    build: { sh: 7.9, waist: 6.1, hip: 6.5, arm: 4, leg: 4.5, neck: 2.6, belly: 2.2 }, top: '#27407f', cuff: '#f4efe2', pants: '#e3d6b8', shin: '#f4f1ea', shoes: '#1d1a22',
    behind: [P('M23.4 42L21.4 58.4H42.6L40.6 42Z', '#1f3468')],
    wear: [P('M28.8 37.6H35.2L37.6 47.4H26.4Z', '#b8312a'), C(32, 40.4, 0.6, GOLD), C(32, 42.8, 0.6, GOLD), C(32, 45.2, 0.6, GOLD),
      S('M28.6 34.6L26 47.6M35.4 34.6L38 47.6', GOLD, 0.9), P('M29.6 33.8H34.4L35.4 37.2Q33.6 39 32 37.6Q30.4 39 28.6 37.2Z', WHITE), S('M30.2 36.2Q32 37.4 33.8 36.2', '#d6d0c0', 0.7)],
  }),
};
/** A chat without a role: someone who has seen too many sprints, in a hoodie with headphones round the neck. */
const PLAIN: Look = {
  skin: '#e2b996', brow: '#3b2a1e', brows: 'flat', lids: true, top: '#3a3f4f', pants: '#28324a', shoes: '#e6e8ee',
  hairBack: [P('M19.6 30C18.6 20.4 24.4 15 32 15C39.6 15 45.4 20.4 44.4 30L42.6 33.6H21.4Z', '#3b2a1e')],
  under: [P('M20.9 33.6C21.6 38.8 24 42.6 27.6 44.2C30.4 45.4 33.6 45.4 36.4 44.2C40 42.6 42.4 38.8 43.1 33.6C41.8 36.4 39.8 37.8 37.6 37.6C35.6 36.6 33.6 36.5 32 37C30.4 36.5 28.4 36.6 26.4 37.6C24.2 37.8 22.2 36.4 20.9 33.6Z', '#3b2a1e', 0.42)],
  hair: [P('M20.2 30.4C19.2 21.4 24.6 16 32 16C39.4 16 44.8 21.4 43.8 30.4C43.2 27.4 42 25.4 40.2 24L37.4 26.4L34.6 23.4L31.4 26.6L28.4 23.4L25.2 26.4L23 24.4C21.6 26 20.6 28 20.2 30.4Z', '#3b2a1e'),
    S('M25.6 34.5Q27.3 35.4 29 34.5M35 34.5Q36.7 35.4 38.4 34.5', '#b98d6c', 0.9)],
  behind: [P('M25.4 36.6Q32 30.6 38.6 36.6L37.6 39.4H26.4Z', '#2d3140')],
  wear: [S('M27.4 35.2Q32 39.6 36.6 35.2', COAL, 1.7), C(27.2, 35.4, 1.7, '#59627a'), C(36.8, 35.4, 1.7, '#59627a'),
    S('M30.8 37.6V41.4M33.2 37.6V41.4', '#c6cbd8', 0.7), P('M28 43.4H36L37 47.2H27Z', '#2d3140')],
};
const lookOf = (id: SpriteId, live = true): Look => {
  if (id === 'plain') return PLAIN;
  const ch = CHARACTERS[id], { eyes: _e, mouth: _m, ...f } = ch.face;
  return { skin: ch.skin, ...f, ...(ch.jaw ? { jaw: ch.jaw } : {}), ...(ch.back ? { hairBack: ch.back } : {}), ...(ch.under ? { under: ch.under } : {}),
    over: [...(ch.over ?? []), ...(id === 'artisan' && live ? smoke() : [])], hair: [...ch.head, ...(ch.wear ?? [])], ...BODY[id](live) };
};

// ── what each role does while its chat works ─────────────────────────────────────────────────────────────────────────
const WORK = {
  // the wand leads four slow beats: down, in, out, up; the left hand shapes the spell a moment late, the wand trails
  // and its tip glows; stars of light leave it and drift up
  orchestrator: () => {
    const T = 3.2, spark = (x: number, y: number, at: number[], dx: number, dy: number, s: number): Node => J(x, y, 0, [P(STAR, GOLD), C(0, 0, 1, WHITE)], puff(T, at, 30, dx, dy, s, 50), 0.5, 0);
    return {
      blink: true, mouth: 'smile',
      head: { a: -3, go: loop(T, [k(0), k(25, { a: -6 }), k(50, { a: 2 }), k(75, { a: -2 })], 0.12) },
      go: loop(T, [0, 25, 50, 75].flatMap(b => [k(b, { dy: 0.5, sy: 0.988, e: 'out' }), k(b + 12.5, { dy: -0.4, sy: 1.006, e: 'in' })])),
      armR: { a: -70, b: -22, go: loop(T, [k(0), k(25, { a: -104 }), k(50, { a: -92 }), k(75, { a: -128 })]), goB: loop(T, [k(0), k(25, { a: -64 }), k(50, { a: -4 }), k(75, { a: -26 })]),
        goH: loop(T, [k(0), k(12, { a: 16 }), k(37, { a: -14 }), k(62, { a: 12 }), k(87, { a: -16 })]),
        held: [S('M0 0V10.4', '#f4e9d2', 1.2), J(0, 10.8, 0, [C(0, 0, 2.6, GOLD, 0.35), C(0, 0, 1.2, '#fff3c4')], loop(T / 4, [k(0), k(50, { sx: 1.5, sy: 1.5, o: 0.6 })]))] },
      armL: { a: 80, b: 24, go: loop(T, [k(0), k(25, { a: 100 }), k(50, { a: 84 }), k(75, { a: 122 })], 0.14), goB: loop(T, [k(0), k(25, { a: 50 }), k(50, { a: 14 }), k(75, { a: 32 })], 0.14) },
      front: [spark(57, 22, [4, 54], 8, -13, 1.5), spark(61, 30, [28, 78], 10, -8, 1.2), spark(53, 17, [40, 90], -4, -11, 1)],
    };
  },
  // a hand at the beard, a long look at the board; the knight goes up (a small dip first), hangs, comes down hard:
  // the pawns jump, the coffee shivers, a nod
  strategist: () => {
    const arm: [number, number, Ease?][] = [[0, -78], [30, -78, 'out'], [34, -74, 'out'], [46, -108], [58, -106, 'in'], [66, -76, 'out'], [69, -81], [73, -78]];
    const hop = (at: number, dy: number): Track => loop(4, [k(at, { e: 'out' }), k(at + 3, { dy, e: 'in' }), k(at + 6.5, {})]);
    return {
      blink: true, mouth: 'flat',
      head: { a: 4, go: loop(4, [k(0), k(20, { a: 8 }), k(40, { a: 3 }), k(48, { a: -2 }), k(60, { a: -2 }), k(71, { a: 8, e: 'out' }), k(78, { a: 4 })]) },
      go: loop(4, [k(0), k(34, { sy: 0.99 }), k(46, { dy: -0.4, sy: 1.008 }), k(58, { dy: -0.4 }), k(66, { sy: 0.985 }), k(72, {})]),
      // the knight stays upright: the hand turns it back by the arm's own angle (the elbow is at -12)
      armR: { a: -78, b: -12, go: loop(4, arm.map(([at, a, e]) => k(at, { a, ...(e ? { e } : {}) }))), ha: 90, goH: loop(4, arm.map(([at, a, e]) => k(at, { a: 12 - a, ...(e ? { e } : {}) }))),
        held: [J(0, -0.6, 0, [P('M-2.7 8.6H2.7V7.4L1.8 6.7C2 4.9 2.7 3.6 2.7 2C2.7 0.2 1.3 -1 -0.4 -1L-0.8 -1.7L-1.4 -0.6C-2.3 0 -3 1 -3.3 2.2C-3.3 2.8 -2.9 3.1 -2.3 2.9L-1 2.4C-0.8 3.6 -1.4 4.8 -1.8 5.7L-1.8 6.7L-2.7 7.4Z', WHITE), C(-1.1, 0.9, 0.5, '#2a4bc2')], undefined, 1.35)] },
      armL: { a: -34, b: -130, goB: loop(4, [k(8), k(12, { a: -122 }), k(16, {}), k(20, { a: -122 }), k(24, {})]) },
      back: [rr(40.6, 49.6, 33, 2.6, 1.2, '#e9dcc0'), S('M45.4 50.5H50M54.6 50.5H59.2M63.8 50.5H68.4', '#2a4bc2', 1.3, 0.55), S('M58 52.6V63.2', '#b9a987', 2.6), S('M52.4 64.4H63.6', '#b9a987', 2.2),
        J(0, 0, 0, [C(64.6, 41.8, 2.2, '#1d1a22'), P('M61.6 49.6L63.4 43.6H65.8L67.6 49.6Z', '#1d1a22')], hop(66, -1.4)),
        J(0, 0, 0, [C(70.4, 44.8, 1.6, '#f7f3e6'), P('M68.4 49.6L69.6 46H71.2L72.4 49.6Z', '#f7f3e6')], hop(67, -1)),
        J(0, 0, 0, [rr(41.6, 46.6, 3.6, 3, 0.9, WHITE), S('M41.6 47.4Q40.2 48 41.6 48.8', WHITE, 0.8), S('M42.2 47.2H44.6', '#5a3a22', 0.9)], hop(66.5, -0.7))],
      front: [J(43.4, 45, 0, [ink([S('M0 0Q1.2 -1.4 0 -2.8Q-1.2 -4.2 0 -5.6', WHITE, 0.8, 0.6)])], puff(4, [6, 50], 30, 1, -5, 1.2), 1, 0)],
    };
  },
  // four long steps, a stop, the spyglass up to the eye, a slow look along the horizon, a glint: something is there
  scout: () => {
    const T = 4.2;
    const swing = (first: number): Key[] => [k(0, { a: first }), k(12, { a: -first }), k(24, { a: first }), k(36, { a: -first }), k(48, { a: first }), k(56, { a: 0 }), k(92, { a: 0, e: 'in' }), k(100, { a: first })];
    const knee = (at: number[]): Key[] => at.flatMap(h => [k(h - 6), k(h, { a: 36 }), k(h + 6)]);
    const lift: [number, Ease?][] = [[48, 'back'], [60], [88], [96]];
    const up = (v: number, rest: number) => loop(T, lift.map(([at, e], i) => k(at, { ...(i === 1 || i === 2 ? { a: v } : { a: rest }), ...(e ? { e } : {}) })));
    return {
      blink: true, mouth: 'smile',
      head: { go: loop(T, [k(0), k(52, {}), k(62, { a: 5 }), k(72, { a: 1 }), k(82, { a: 6 }), k(94, {})]) },
      go: loop(T, [k(0, { e: 'out' }), k(6, { dy: -1, e: 'in' }), k(12, { e: 'out' }), k(18, { dy: -1, e: 'in' }), k(24, { e: 'out' }), k(30, { dy: -1, e: 'in' }), k(36, { e: 'out' }), k(42, { dy: -1, e: 'in' }), k(48, {}),
        k(54, { sy: 0.985 }), k(62, { a: 4, sy: 0.985 }), k(86, { a: 4, sy: 0.985 }), k(94, {})]),
      legL: { a: 22, go: loop(T, swing(22)), goB: loop(T, knee([6, 30])) }, legR: { a: -22, go: loop(T, swing(-22)), goB: loop(T, knee([18, 42])) },
      armL: { a: -18, b: -8, go: loop(T, [k(0), k(12, { a: 18 }), k(24, { a: -18 }), k(36, { a: 18 }), k(48, { a: -18 }), k(58, { a: 30 }), k(92, { a: 30 })]),
        goB: loop(T, [k(0), k(48, {}), k(58, { a: -62 }), k(92, { a: -62 })]) },
      // carried level at the hip, then level at the eye: the three angles always add up to the horizon
      armR: { a: -30, b: -50, ha: -10, go: up(-130, -30), goB: up(-84, -50), goH: up(124, -10),
        held: [S('M0 -5.4V0.6', '#6b4a22', 2.5), S('M0 0.6V5.2', '#b78d45', 3.1), S('M0 5.2V9.4', '#d9b25c', 3.7), S('M-1.9 9.7H1.9', '#f2dc9c', 1.1), S('M-1.3 -5.6H1.3', '#3a2a16', 1.1)] },
      front: [J(53.4, 20, 0, [ink([P(STAR, WHITE)])], pop(T, 70, 86))],
    };
  },
  // the hammer goes up over the shoulder and comes down three times (the body rises and sinks, the anvil rings, the
  // iron flares, sparks fly), then it hangs while he looks at the work, nods twice and pulls on the cigar
  artisan: () => {
    const T = 3.6, hits = [12, 30, 48];
    const blow = (rest: number, up: number, down: number, back: number): Key[] => hits.flatMap(h => [k(h - 12, { e: 'out' }), k(h - 4, { a: up, e: 'in' }), k(h, { a: down, e: 'out' }), k(h + 3, { a: back }), k(h + 6, { a: rest })]);
    return {
      blink: true, mouth: 'flat', lean: 3,
      head: { go: loop(T, [...hits.flatMap(h => [k(h, { e: 'out' }), k(h + 2, { a: 5 }), k(h + 7, {})]), k(60, {}), k(66, { a: 7 }), k(70, { a: 3 }), k(74, { a: 8 }), k(78, { a: 3 }), k(88, {})]) },
      go: loop(T, [...hits.flatMap(h => [k(h - 12, { e: 'out' }), k(h - 4, { dy: -0.9, sy: 1.02, e: 'in' }), k(h, { sy: 0.965, sx: 1.02, e: 'out' }), k(h + 4, {})]), k(58, {}), k(66, { a: 2 }), k(82, { a: 2 }), k(90, {})]),
      armR: { a: -50, b: -20, ha: -15, go: loop(T, [...blow(-50, -160, -48, -58), k(58, {}), k(66, { a: -34, e: 'back' }), k(84, { a: -34 }), k(94, {})]),
        goB: loop(T, [...blow(-20, 30, -22, -16), k(58, {}), k(66, { a: -40 }), k(84, { a: -40 }), k(94, {})]),
        held: [S('M0 -2V7.4', '#7b5230', 2), rr(-4.3, 5, 8.6, 5.6, 1.2, '#8d96a8'), rr(-4.3, 8.6, 8.6, 2, 0.9, '#5d6577'), S('M-3 6.4H3', '#c3cad8', 0.9)] },
      armL: { a: 26, b: -64 },
      back: [rr(53.2, 57.2, 15.2, 7.4, 1.3, '#6b4a2a'), S('M55 59.6H66.6M55 62H66.6', '#4f3519', 0.9),
        J(0, 0, 0, [P('M51 47.6H69.6L75.4 48.8L69.6 50.6H51Z', '#59627a'), P('M55.4 50.6H65.8L64.6 54.4H56.6Z', '#454c5d'), P('M53.4 54.4H67.8L69 57.4H52.2Z', '#59627a'), S('M52 48.5H69.4', '#aab2bf', 0.9),
          S('M56 47H65', '#ff7a1a', 1.9), J(0, 0, 0, [S('M56 47H65', '#fff0b3', 1.9)], puff(T, hits, 14, 0, 0), 1, 0)],
          loop(T, hits.flatMap(h => [k(h, { e: 'out' }), k(h + 1.2, { dy: 0.8 }), k(h + 4, {})])))],
      front: [J(60, 46.4, 0, [S('M0 0L2.6 -2.6', '#ffc531', 1.6)], puff(T, hits, 9, 7, -8)), J(61, 46.8, 0, [S('M0 0L3.2 -0.6', '#ffc531', 1.6)], puff(T, hits, 9, 10, -2)),
        J(58.4, 46.2, 0, [S('M0 0L-1.6 -3', '#ffc531', 1.6)], puff(T, hits, 9, -6, -9)), J(62, 46, 0, [C(0, 0, 0.9, '#ffe9a3')], puff(T, hits, 12, 9, -7)), J(57, 46, 0, [C(0, 0, 0.8, '#ffe9a3')], puff(T, hits, 12, -8, -5))],
    };
  },
  // on guard, the halberd upright in its fist: a long stare to the left, the head snaps right; then the butt of the
  // halberd comes down on the ground (dust, a shake) and it goes back to staring
  sentinel: () => {
    const T = 5, SLAM = 62;
    return {
      mouth: 'flat', lean: -1.5,
      go: loop(T, [k(0), k(30, {}), k(44, { a: 3 }), k(SLAM - 6, { a: 3 }), k(SLAM, { a: 3, sy: 0.975, e: 'out' }), k(SLAM + 6, { a: 3 }), k(84, { a: 3 }), k(96, {})]),
      head: { a: -5, go: loop(T, [k(0), k(33, {}), k(42, { a: 7, e: 'back' }), k(52, { a: 4 }), k(SLAM, { a: 7 }), k(86, { a: 6 }), k(98, {})]) },
      // the pole stays upright: the hand turns it back by the arm's angles
      armR: { a: -50, b: -30, ha: 80, go: loop(T, [k(SLAM - 10, { e: 'out' }), k(SLAM - 3, { a: -60, e: 'in' }), k(SLAM, { a: -50, e: 'out' }), k(SLAM + 6, {})]),
        goH: loop(T, [k(SLAM - 10, { e: 'out' }), k(SLAM - 3, { a: 90, e: 'in' }), k(SLAM, { a: 80, e: 'out' }), k(SLAM + 6, {})]),
        held: [J(0, 0, 0, [S('M0 -27.4V21.4', '#4a3319', 1.9), S('M0 20.4V21.6', '#8d96a8', 2.3), P('M0 -35.6L2 -27H-2Z', '#c3cad8'),
          P('M1 -26.6C5.6 -28 8.8 -24.8 9 -19.4C6 -21 3.2 -20.6 1 -18.4Z', '#8d96a8'), S('M2.4 -25.6C5.4 -26 7.4 -24 8 -21.4', '#e8edf3', 0.8), P('M-1 -25.8L-6.4 -23L-1 -20.4Z', '#5d6577'),
          S('M-1.4 -17.4H1.4M-1.4 -27.2H1.4', '#262b37', 1.1)],
          loop(T, [k(SLAM - 10, { e: 'out' }), k(SLAM - 3, { dy: -1.6, e: 'in' }), k(SLAM, { dy: 0.5, e: 'out' }), k(SLAM + 3, { dy: -0.4 }), k(SLAM + 6, {})]))] },
      armL: { a: 12, b: -16, goB: loop(T, [k(SLAM - 4), k(SLAM, { a: -34, e: 'out' }), k(SLAM + 14, {})]) },
      front: [J(54.6, 63.4, 0, [ink([C(0, 0, 1.3, WHITE, 0.5)])], puff(T, [SLAM], 14, 6, -3, 2.2), 1, 0), J(49, 63.4, 0, [ink([C(0, 0, 1.1, WHITE, 0.5)])], puff(T, [SLAM], 14, -5, -2.4, 2), 1, 0),
        J(51.8, 65.4, 0, [ink([S('M-5 0H-2M2 0H5', WHITE, 0.9)])], puff(T, [SLAM], 10, 0, 0, 1.5), 1, 0)],
    };
  },
  // a breath that fills the coat (leaning back, the trumpet dips), the blast (forward, the trumpet up, the banner
  // swings), a held note that shakes his belly, notes in the air
  herald: () => ({
    mouth: 'o',
    go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: -4, sy: 1.035, e: 'back' }), k(22, { a: 3, sy: 0.98 }), k(26, { a: 2.5 }), k(34, { a: 2.5, dy: -0.5 }), k(42, { a: 2.5 }), k(50, { a: 2.5, dy: -0.5 }), k(58, { a: 2.5 }), k(66, { a: 2.5, dy: -0.5 }), k(74, { a: 2.5 }), k(88, {})]),
    head: { a: -2, go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: 6, e: 'back' }), k(23, { a: -8 }), k(74, { a: -7 }), k(90, {})]),
      over: [S('M34 40.2L63 37.4', GOLD, 2.3), P('M61.6 35.4L75.6 30.4C77.4 34.6 77.4 40.6 75.6 44.8L62 39.8Z', GOLD), E(76, 37.6, 2, 7.3, '#d9a52e'), S('M33 40.3H35.4', '#d9a52e', 3),
        J(44, 40.6, 0, [P('M0 0L15 -1.4L14.4 12.6L7.4 9.2L0.4 12Z', '#b8312a'), S('M2 2.6L13 1.6', '#f2c14e', 1.3), C(7.4, 5.8, 1.5, '#f2c14e')], loop(2.8, [k(0), k(14, { a: -6 }), k(24, { a: 9, e: 'out' }), k(40, { a: -4 }), k(56, { a: 3 }), k(74, {})]))] },
    armR: { a: -100, b: -123, go: loop(2.8, [k(0, { e: 'out' }), k(14, { a: -94, e: 'back' }), k(23, { a: -108 }), k(74, { a: -107 }), k(90, {})]) },
    armL: { a: 30, b: -62 },
    front: notes(60, 19, 2.8, [24, 44]),
  }),
  // one hand on the keys, the other round a mug: lines of code write themselves on the screen, then a long sip
  plain: () => {
    const T = 5.6;
    const line = (y: number, w: number, c: string, from: number, to: number): Node =>
      J(53.4, y, 0, [S(`M0 0H${w}`, c, 1.4)], loop(T, [k(0, { sx: 0, e: 'hold' }), k(from, { sx: 0, e: 'lin' }), k(to, { sx: 1 }), k(92, { sx: 1 }), k(96, { sx: 1, o: 0, e: 'hold' }), k(100, { sx: 0, o: 0 })]));
    const sip = (rest: number, v: number): Track => loop(T, [k(60), k(68, { a: v, e: 'out' }), k(82, { a: v }), k(92, { a: rest })]);
    return {
      blink: true, mouth: 'flat', lean: 1.5,
      head: { a: 3, go: loop(T, [k(0), k(30, { a: 6 }), k(58, { a: 3 }), k(68, { a: -4 }), k(82, { a: -6 }), k(92, { a: 3 })]) },
      armR: { a: -35, b: -6, goB: sway(-18, 0.1) },
      // the mug stays upright in the hand; at the sip it tips
      armL: { a: -10, b: -100, ha: 110, go: sip(-10, -40), goB: sip(-100, -138), goH: sip(110, 196),
        held: [rr(-2.3, -4.4, 4.6, 5, 0.9, '#e6e8ee'), S('M2.3 -3.2Q4.2 -2.2 2.3 -1', '#e6e8ee', 0.9), S('M-1.3 -4.2H1.3', '#5a3a22', 0.9)] },
      back: [S('M41.4 48.4H74', '#c6cbd8', 2.2), S('M45.4 49.6V63.4M70 49.6V63.4', '#8d96a8', 1.8), S('M43 64.4H47.8M67.6 64.4H72.4', '#8d96a8', 1.8),
        rr(50.4, 31.6, 20.8, 14.8, 2.4, '#d8dbe4'), rr(51.8, 33, 18, 12, 1.4, '#1f2430'), rr(45.6, 46.3, 27.6, 1.5, 0.7, '#aab0bf'),
        line(36.4, 8, SKY, 2, 18), line(39.2, 11.6, WHITE, 20, 40), line(42, 5.6, '#7ee0a8', 42, 54)],
    };
  },
} satisfies Partial<Record<CharacterId | 'plain', () => Pose>>;

// ── the states every role shares ─────────────────────────────────────────────────────────────────────────────────────
/** Arms folded over the chest (the left one under). */
const FOLDED = { l: { a: -20, b: -78 }, r: { a: 22, b: 76 } };
/** Fists on the hips. */
const HIPS = { l: { a: 30, b: -62 }, r: { a: -30, b: 62 } };
const SHARED: Record<Exclude<SpriteState, 'work'>, () => Pose> = {
  // one arm across, the other hand at the chin: two taps of a finger, a shift of the weight; the thought grows a
  // bubble at a time
  think: () => ({
    eyes: 'up', mouth: 'flat', lean: -1, go: sway(1.2, 1.8),
    head: { a: 3, go: sway(6, 1.8, 0.15) },
    armR: { a: 30, b: 130, goB: loop(3.6, [k(40), k(44, { a: 122 }), k(48, {}), k(52, { a: 122 }), k(56, {})]) }, armL: { a: -12, b: -84 },
    front: [J(43.6, 21.6, 0, [ink([C(0, 0, 1.5, WHITE)])], pop(3.6, 2, 84)), J(48.4, 17.4, 0, [ink([C(0, 0, 2.3, WHITE)])], pop(3.6, 10, 84)),
      J(60, 10.8, 0, [ink([E(0, 0, 9.6, 6.8, WHITE), C(-6, -3, 4.2, WHITE), C(3.4, -4.8, 5, WHITE)]), { g: [C(-3.8, 0.2, 1.2, INK), C(0, 0.2, 1.2, INK), C(3.8, 0.2, 1.2, INK)], cls: 'sp-paper' }], pop(3.6, 18, 84))],
  }),
  // arms folded, a foot tapping: then a hand opens towards you («well?») and goes back; the «!» wobbles with it
  wait: () => ({
    blink: true, mouth: 'flat',
    head: { a: -3, go: loop(3.2, [k(0), k(40, { a: -5 }), k(54, { a: 5, e: 'back' }), k(78, { a: 4 }), k(90, {})]) },
    go: loop(3.2, [k(0), k(50, { sy: 1.01 }), k(54, { a: 1.5 }), k(80, { a: 1.5 }), k(90, {})]),
    armL: FOLDED.l,
    armR: { ...FOLDED.r, go: loop(3.2, [k(46), k(56, { a: -42, e: 'back' }), k(78, { a: -40 }), k(90, {})]), goB: loop(3.2, [k(46), k(56, { a: -58, e: 'back' }), k(66, { a: -50 }), k(78, { a: -58 }), k(90, {})]) },
    legR: { go: loop(3.2, [0, 11, 22, 33].flatMap(t => [k(t, { e: 'out' }), k(t + 4, { a: -9, e: 'in' }), k(t + 8, {})])), goB: loop(3.2, [0, 11, 22, 33].flatMap(t => [k(t, { e: 'out' }), k(t + 4, { a: 16, e: 'in' }), k(t + 8, {})])) },
    front: [bubble(AMBER, '!', loop(3.2, [k(0, { a: -5 }), k(11, { a: 5 }), k(22, { a: -4 }), k(33, { a: 4 }), k(44, {}), k(54, { e: 'out' }), k(60, { dy: -2, sx: 1.14, sy: 1.14, e: 'in' }), k(70, { sx: 0.97, sy: 0.97 }), k(80, {})]))],
  }),
  // a short crouch, a fist punched up with the whole body behind it, down again; then fists on the hips, chest out,
  // one slow nod under the green tick
  done: () => {
    const T = 2.2;
    const glint = (x: number, y: number, at: number, s: number): Node => J(x, y, 0, [P(STAR, GOLD)], once(T, [k(0, { o: 0, sx: 0.1, sy: 0.1, e: 'hold' }), k(at, { o: 0, sx: 0.1, sy: 0.1, e: 'back' }), k(at + 10, { o: 1, sx: s, sy: s, a: 30 }), k(at + 30, { o: 0, sx: s * 0.4, sy: s * 0.4, a: 90 }), k(100, { o: 0 })]), 1, 0);
    return {
      eyes: 'happy', mouth: 'grin',
      go: once(T, [k(0, { e: 'out' }), k(10, { sy: 0.93, sx: 1.04, e: 'out' }), k(24, { dy: -3.2, sy: 1.05, sx: 0.98, e: 'in' }), k(38, { sy: 0.94, sx: 1.04, e: 'out' }), k(48, { sy: 1.015 }), k(58, {}), k(76, { sy: 1.02 }), k(90, {})]),
      head: { go: once(T, [k(0), k(10, { a: 4 }), k(24, { a: -6 }), k(40, { a: 3 }), k(58, {}), k(72, { a: 7 }), k(84, { a: -1 }), k(94, {})]) },
      armR: { ...HIPS.r, go: once(T, [k(0, { a: -10 }), k(10, { a: 14, e: 'in' }), k(24, { a: -168, e: 'out' }), k(34, { a: -160 }), k(46, { a: -160, e: 'in' }), k(62, { e: 'back' })]),
        goB: once(T, [k(0, { a: 0 }), k(10, { a: 96, e: 'in' }), k(24, { a: -14, e: 'out' }), k(34, { a: -40 }), k(46, { a: -40, e: 'in' }), k(62, { e: 'back' })]) },
      armL: { ...HIPS.l, go: once(T, [k(0, { a: 10 }), k(10, { a: 16 }), k(24, { a: 22 }), k(46, { a: 22 }), k(62, { e: 'back' })]), goB: once(T, [k(0, { a: 0 }), k(10, { a: -40 }), k(24, { a: -70 }), k(46, { a: -70 }), k(62, {})]) },
      front: [bubble(GREEN, 'ok', once(T, [k(0, { o: 0, sx: 0, sy: 0, e: 'hold' }), k(20, { o: 0, sx: 0.2, sy: 0.2, e: 'back' }), k(32, { o: 1 }), k(100, {})])),
        glint(47.6, 16.4, 24, 0.7), glint(18.4, 22, 28, 0.55), glint(50, 30, 32, 0.45)],
    };
  },
  // a hand over the eyes, the head sinks into it and shakes slowly; a long breath out; the «!» rattles twice a round
  err: () => ({
    eyes: 'closed', mouth: 'frown',
    head: { a: 6, go: loop(3.4, [k(0), k(30, { a: 9 }), k(46, { a: 3 }), k(58, { a: 9 }), k(70, { a: 4 }), k(84, { a: 8 }), k(100, {})]) },
    go: loop(3.4, [k(0), k(36, { sy: 0.985 }), k(50, { sy: 1.015, dy: -0.3, e: 'out' }), k(66, { sy: 0.97, sx: 1.012 }), k(100, {})]),
    armR: { a: 152, b: -4, go: loop(3.4, [k(0), k(30, { a: 150 }), k(46, { a: 155 }), k(58, { a: 150 }), k(70, { a: 154 }), k(84, { a: 151 })]) }, armL: { a: 4, go: sway(6, 0.85) },
    front: [J(38.4, 33, 0, [ink([E(0, 0, 2.6, 1.7, WHITE, 0.7), C(2.2, -0.8, 1.6, WHITE, 0.7)])], puff(3.4, [52], 22, 10, 2.5, 1.7), 1, 0),
      bubble(RED, '!', loop(3.4, [k(0), k(3, { a: -9 }), k(6, { a: 9 }), k(9, { a: -7 }), k(12, { a: 6 }), k(16, {}), k(50, {}), k(53, { a: -9 }), k(56, { a: 9 }), k(59, { a: -6 }), k(63, {})]))],
  }),
  // asleep on its feet, arms folded: a slow breath, the head sinks, jerks up, settles; three «z» in a row
  idle: () => ({
    eyes: 'closed', mouth: 'flat',
    go: loop(5, [k(0), k(45, { sy: 1.02, sx: 0.995 })]),
    head: { a: 8, go: loop(5, [k(0), k(35, { a: 12, e: 'in' }), k(60, { a: 16, e: 'back' }), k(66, { a: 3 }), k(78, { a: 7 })]) },
    armL: FOLDED.l, armR: FOLDED.r,
    front: [J(44, 21, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(8, { o: 1 }), k(40, { o: 0, dx: 5, dy: -7 }), k(100, { o: 0 })]), 0.8),
      J(49.5, 15, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(20, { o: 0 }), k(28, { o: 1 }), k(62, { o: 0, dx: 6, dy: -8 }), k(100, { o: 0 })]), 1.05),
      J(56, 8.6, 0, [ink([S(Z, WHITE, 1.7)])], loop(5, [k(0, { o: 0 }), k(20, { o: 0 }), k(40, { o: 0 }), k(48, { o: 1 }), k(86, { o: 0, dx: 6, dy: -8 }), k(100, { o: 0 })]), 1.35)],
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
      blink: true, mouth: 'flat', lean: 1,
      go: loop(4.4, [k(0), k(50, { sy: 1.01 })]),
      head: { a: 5, go: loop(4.4, [k(0), k(16, { a: 10 }), k(20, { a: 5, e: 'out' }), k(36, { a: 10 }), k(40, { a: 5, e: 'out' }), k(56, { a: 10 }), k(66, { a: 4 }), k(74, { a: 8, e: 'out' }), k(84, { a: 5 })]) },
      armR: { a: -40, b: -60, goB: loop(4.4, [k(0), k(60, { e: 'in' }), k(68, { a: -72, e: 'out' }), k(78, {})]) }, armL: { a: -30, b: -80 },
      front: [J(41.4, 40.7, -4, [
        rr(-8.2, -3, 16.4, 6.8, 1, '#b5483a'),
        P('M0 -3.4C-2.4 -4.6 -5 -4.6 -7.6 -3.6V3C-5 2 -2.4 2 0 3.2Z', '#fdfaf0'), P(page, '#f4eedc'),
        S('M-6.2 -1.9H-1.6M-6.2 -0.5H-1.6M-6.2 0.9H-2.8', '#b9b2a0', 0.7), S('M1.6 -1.9H6.2M1.6 -0.5H6.2M1.6 0.9H5', '#b9b2a0', 0.7),
        // the page that turns: it folds onto the spine and opens on the other side
        J(0, 0, 0, [P(page, '#fdfaf0'), S('M1.6 -1.9H6.2M1.6 -0.5H6.2', '#cfc8b4', 0.7)], loop(4.4, [k(0), k(60, { e: 'in' }), k(67, { sx: 0.04, e: 'out' }), k(75, { sx: -1 }), k(76, { sx: -1, o: 0, e: 'hold' }), k(100, { o: 0 })])),
        S('M0 -3.4V3.2', '#d9d2bd', 0.7),
        C(-7.2, 2.4, 1.6, look.hand ?? look.skin), C(7.2, 2.4, 1.6, look.hand ?? look.skin),
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
      armR: { a: -44, b: -22, go: loop(T, hits.flatMap(h => [k(h - 14, { e: 'out' }), k(h - 5, { a: -120, e: 'in' }), k(h, { a: -40, e: 'out' }), k(h + 3, { a: -48 }), k(h + 7, {})])),
        goB: loop(T, hits.flatMap(h => [k(h - 14, { e: 'out' }), k(h - 5, { a: -34, e: 'in' }), k(h, { a: -20, e: 'out' }), k(h + 7, {})])) },
      armL: { a: 24, b: -40 },
      back: [
        rr(43.8, 50.6, 9.6, 13.8, 1.4, '#3a4152'), S('M45.8 55L48.6 52.4M48.8 55L51.6 52.4', AMBER, 1.1, 0.8),
        J(48.6, 50.6, 0, [rr(-5.4, -4.4, 10.8, 4.4, 1.4, PAPER), rr(-5.4, -1.5, 10.8, 1.5, 0.7, '#aab2bf'), S('M2 -3.6V-2.5H-2M-0.9 -3.5L-2 -2.5L-0.9 -1.6', INK, 0.9)],
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
    const bubbleUp = (x: number, r: number, at: number[]): Node => J(x, 20.4, 0, [C(0, 0, r, '#bff3d6')], puff(T, at, 16, x > 51 ? 2 : -2, -8, 1.3), 1, 0);
    return {
      blink: true, mouth: 'flat', lean: 1,
      head: { a: 4, go: loop(T, [k(0), k(24, { a: 8 }), k(40, { a: 3 }), k(62, { a: 8 }), k(80, { a: 3, e: 'out' }), k(88, { a: 9 }), k(96, {})]) },
      go: loop(T, [k(0), k(50, { sy: 1.014 })]),
      // the tube stays upright: its own angle undoes the arm's (-95 at the shoulder, -25 at the elbow)
      armR: { a: -95, b: -25, go: sway(-100, 0.55), ha: 120, goH: loop(1.1, [k(0, { a: 108 }), k(50, { a: 132 })]),
        held: [rr(-2.5, -12, 5, 14.6, 2.5, '#e9f6ff', 0.62), P('M-2.5 -5.4H2.5V0.1A2.5 2.5 0 0 1 -2.5 0.1Z', GREEN, 0.92), S('M-3.2 -12H3.2', WHITE, 1.2), S('M-1.2 -10.2V-7', WHITE, 0.8, 0.8)] },
      armL: { a: 26, b: -52 },
      back: [S('M66.4 50.4V63.6', STEEL, 1.8), S('M61.4 64.4H71.4', STEEL, 2), rr(56.4, 29.6, 20, 21.4, 1.8, '#f1e6cb'), rr(63, 28, 6.8, 3, 1.1, '#8a96a8'),
        ...row(34.6, 20), ...row(39.8, 44), ...row(45, 68)],
      front: [bubbleUp(50.4, 0.9, [8, 52]), bubbleUp(51.6, 1.2, [26, 70]), bubbleUp(50.8, 0.7, [40, 84])],
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
      back: [J(52.6, 21.6, -3, sheet(13, 7.4)), J(53.6, 31.2, 2, sheet(13, 7.4)), J(52.2, 40.8, -2, sheet(13, 7.4)),
        J(60, 34.9, 2, [S('M-7.4 -4.6H7.4V4.6H-7.4Z', GOLD, 1.5)], loop(T, [k(0, { o: 0, e: 'hold' }), k(60, { o: 0, e: 'out' }), k(66, { o: 1 }), k(88, { o: 1 }), k(96, { o: 0 }), k(100, { o: 0 })]), 1, 0)],
      front: [J(69.6, 29, 0, [ink([P(STAR, WHITE)])], pop(T, 64, 86))],
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
        held: [S('M0.8 -1.8L3.4 -4.2', look.hand ?? look.skin, 1.7),
          J(4.6, -9.6, 0, [C(0, 0, 6.4, '#3b82d9'), P('M-5 -2.8C-3.2 -4.8 -0.6 -4.4 0 -2.7C0.6 -1 -1.4 -0.2 -2.7 0.7C-4.1 1.6 -5.7 0.9 -5.9 -0.9Z', '#58c98a'), P('M1.4 1.8C3 1.1 5 1.8 4.8 3.4C4.6 4.8 2.7 5.5 1.6 4.4C0.7 3.5 0.5 2.3 1.4 1.8Z', '#58c98a'),
            J(0, 0, 0, [S('M0 -6.4C3.9 -3.6 3.9 3.6 0 6.4C-3.9 3.6 -3.9 -3.6 0 -6.4', '#d6ebff', 0.8, 0.85)], loop(1.8, [k(0, { e: 'lin' }), k(50, { sx: 0.06, e: 'lin' })])),
            S('M-6.4 0H6.4', '#d6ebff', 0.8, 0.85), S('M-3.7 -3.8C-2.3 -5 -0.5 -5.4 0.9 -5', WHITE, 1, 0.8)])] },
      armL: { a: 30, b: -60 },
      front: [
        J(66.5, 27.9, 0, [P('M0 0V7L1.9 5.3L3.2 8.2L4.6 7.6L3.3 4.8H5.8Z', WHITE), S('M0 0V7L1.9 5.3L3.2 8.2L4.6 7.6L3.3 4.8H5.8Z', INK, 0.8)],
          loop(T, [k(0, { dx: 7, dy: 7 }), k(22, { dx: 0, dy: 0, e: 'out' }), k(26, { sx: 0.84, sy: 0.84 }), k(30, {}), k(56, { dx: 5, dy: -6 }), k(72, { dx: -1, dy: 2, e: 'out' }), k(76, { dx: -1, dy: 2, sx: 0.84, sy: 0.84 }), k(80, { dx: -1, dy: 2 }), k(100, { dx: 7, dy: 7 })])),
        click(65.3, 25.9, 'M0 0L-2 -2', [26]), click(66.9, 25.1, 'M0 0V-2.8', [26]), click(64.3, 27.9, 'M0 0L-2 -2', [76]), click(65.9, 27.1, 'M0 0V-2.8', [76]),
      ],
    };
  },
  // a paper plane: the arm goes back, throws it, and it flies off to whoever gets the work; a look after it
  delegate: () => {
    const T = 3.2, GO = 30;
    return {
      mouth: 'smile',
      head: { go: loop(T, [k(0), k(18, { a: -5 }), k(GO, { a: 5, e: 'out' }), k(56, { a: -3 }), k(80, { a: -3 }), k(94, {})]) },
      go: loop(T, [k(0), k(18, { a: -5, sy: 0.98, e: 'in' }), k(GO, { a: 5, sy: 1.02, e: 'out' }), k(44, { a: 2 }), k(86, {})]),
      armR: { a: -60, b: -70, go: loop(T, [k(0), k(18, { a: -24, e: 'in' }), k(GO, { a: -112, e: 'out' }), k(40, { a: -104 }), k(70, { a: -104 }), k(88, {})]),
        goB: loop(T, [k(0), k(18, { a: -134, e: 'in' }), k(GO, { a: -6, e: 'out' }), k(70, { a: -6 }), k(88, {})]),
        // the plane in the hand until it leaves, and a new one when the arm comes back
        held: [P('M0 8L-4.2 -3.2L0 -0.6L4.2 -3.2Z', PAPER), S('M0 8V-0.6', LINE, 0.7)], goH: loop(T, [k(0, { e: 'hold' }), k(GO, { o: 0, e: 'hold' }), k(84, { o: 0, e: 'out' }), k(92, {})]) },
      armL: { a: 22, b: -50 },
      front: [
        J(52.7, 30.2, -24, [P('M0 0L-11.6 -4.4L-8.4 0L-11.6 4.4Z', PAPER), P('M0 0L-8.4 0L-11.6 4.4Z', '#cfd4df'), S('M0 0H-8.4', LINE, 0.7)],
          loop(T, [k(0, { o: 0, e: 'hold' }), k(GO - 0.2, { o: 0, e: 'hold' }), k(GO, { o: 1, e: 'out' }), k(54, { o: 1, dx: 17, dy: -8, a: -30 }), k(66, { o: 1, dx: 24, dy: -9, a: -8, e: 'in' }), k(76, { o: 0, dx: 29, dy: -7, a: 2 }), k(100, { o: 0 })]), 1, 0),
        J(54.7, 29.2, -24, [ink([S('M0 0H-3.4M-6 0H-8.4', WHITE, 0.9)])], puff(T, [GO + 6], 14, 6, -3), 1, 0),
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
  // springs back; it takes it with its eyes shut and half a smile, leans into the hand, and one heart gives it away
  pat: () => {
    const T = REACTION_S.pat;
    const heart = (x: number, y: number, at: number, dx: number): Node =>
      J(x, y, 0, [P(HEART, '#ff5d7a')], once(T, [k(0, { o: 0, sx: 0.2, sy: 0.2, e: 'hold' }), k(at, { o: 0, sx: 0.2, sy: 0.2, e: 'back' }), k(at + 10, { o: 1 }), k(at + 42, { o: 0, dx, dy: -13, sx: 1.25, sy: 1.25 }), k(100, { o: 0 })]), 1, 0);
    return {
      eyes: 'closed', mouth: 'smile',
      head: { go: once(T, [k(0), k(18, { e: 'in' }), k(22, { dy: 1.4, sy: 0.93, sx: 1.03, e: 'out' }), k(32, { a: -3 }), k(37, { a: -3, e: 'in' }), k(41, { dy: 1.4, sy: 0.93, sx: 1.03, e: 'out' }), k(56, { a: 6 }), k(74, { a: 5 }), k(92, {})]) },
      go: once(T, [k(0), k(18, { e: 'in' }), k(22, { sy: 0.975, sx: 1.012, e: 'out' }), k(32, {}), k(37, { e: 'in' }), k(41, { sy: 0.975, sx: 1.012, e: 'out' }), k(56, { a: 2.5 }), k(76, { a: 2 }), k(92, {})]),
      armL: { a: 5, go: once(T, [k(0), k(22, { a: 9 }), k(41, { a: 9 }), k(60, { a: 3 }), k(92, {})]) }, armR: { a: -5, go: once(T, [k(0), k(22, { a: -9 }), k(41, { a: -9 }), k(60, { a: -3 }), k(92, {})]) },
      front: [
        // an open hand, palm down, fingers spread over the head: pat, pat
        J(38, 12, -6, [rr(5.6, -2.7, 4.8, 5.4, 1.5, '#e2483d'), S('M-1.6 -1.9L-8.6 -4', GLOVE, 2.2), S('M-2.2 -0.5L-10 -1.2', GLOVE, 2.3), S('M-2.2 1L-9.6 1.5', GLOVE, 2.2), S('M-1.6 2.3L-7.8 4', GLOVE, 2),
          S('M2.4 2.2L0.2 6', GLOVE, 2.3), rr(-3.4, -3, 10, 6, 2.8, GLOVE), S('M-2.6 -1.2L-3.4 -1.3M-2.8 0.3L-3.7 0.3M-2.6 1.7L-3.4 1.9', '#d9a25e', 0.6)],
          once(T, [k(0, { o: 0, dx: 15, dy: -9, e: 'hold' }), k(4, { o: 1, dx: 15, dy: -9, e: 'out' }), k(15, { o: 1, dx: 1, dy: -4, e: 'in' }), k(22, { o: 1, dy: 4.6, sy: 0.82, a: -2, e: 'out' }), k(32, { o: 1, dy: -6.5, a: -12, e: 'in' }),
            k(41, { o: 1, dy: 4.6, sy: 0.82, a: -2, e: 'out' }), k(52, { o: 1, dx: 1, dy: -3, a: -10, e: 'in' }), k(66, { o: 1, dx: 13, dy: -8 }), k(73, { o: 0, dx: 15, dy: -9 }), k(100, { o: 0 })]), 1.3, 0),
        heart(46, 22, 44, 5), heart(20, 24, 56, -4)],
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
  if (!s) { const look = lookOf(id, state !== 'done'); cache.set(key, s = { nodes: person(look, act ? ACT[act](look) : (state === 'work' ? WORK[id] : SHARED[state])()) }); }
  return s;
}
/** A role's reaction to a click (built once): the same acting for everyone, in the role's own looks. */
export function reactionScene(id: SpriteId, kind: SpriteReaction): SpriteScene {
  const key = `${id}:${kind}`;
  let s = cache.get(key);
  if (!s) cache.set(key, s = { nodes: person(lookOf(id, false), REACT[kind]()) });
  return s;
}
export const SPRITE_IDS = Object.keys(WORK) as readonly SpriteId[];
export const isSpriteId = (id: string): id is SpriteId => Object.hasOwn(WORK, id);
export const SPRITE_STATES: readonly SpriteState[] = ['work', 'think', 'wait', 'done', 'err', 'idle'];
