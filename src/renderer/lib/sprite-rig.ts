// The rig of the little people the roles are animated as (ADR 0295; the owner, 2026-11-13: «veri e propri omini che
// fanno cose», «non li voglio pixelosi, li voglio normali, smooth», «animazioni veramente fighe … non dentro un
// quadrato colorato ma liberi»; 2026-11-14: «li voglio più da adulto, adesso sembrano robe per bambino»): smooth
// vector people of adult proportions, the head of the role's portrait (lib/character-art.ts) on a body of the role's
// own build, legs that bend at the knee and arms at the elbow. A person is a tree of shapes and joints; a joint has a
// rest pose (a place, an angle, a scale, an opacity) and a track: keys in time, each with its own easing, compiled to
// one CSS @keyframes rule (keyframesCss), so a movement can load, strike, overshoot, squash and settle instead of
// going there and back. Trusted code, never user or model content. Pure data and text: lib/agent-sprites.ts writes
// each role's scenes with it, AgentSprite.tsx draws them, test/unit/agent-sprites.test.ts checks them.
import { JAW, features, shade, shapeSvg, type EyeLook, type Features, type Shape } from './character-art';

/** The picture: 80 × 64 units, the figure's head where the portrait has it (centre x 32), the room on the right for the tool. */
export const VIEW = { x: 0, y: 2, w: 80, h: 64 };
export const INK = '#2a2230', WHITE = '#ffffff', AMBER = '#f0a020', GREEN = '#2fb573', RED = '#e5484d', GOLD = '#f2c14e', SKY = '#8fd6ff';

/** How a key leaves for the next one: in and out, speeding up, slowing down, past the mark and back, even, or a jump at the end. */
export type Ease = 'io' | 'in' | 'out' | 'back' | 'lin' | 'hold';
const EASE: Record<Ease, string> = { io: 'cubic-bezier(.45,0,.55,1)', in: 'cubic-bezier(.6,0,1,.5)', out: 'cubic-bezier(0,.5,.4,1)', back: 'cubic-bezier(.34,1.56,.64,1)', lin: 'linear', hold: 'step-end' };
/** One moment of a track, at a percentage of the loop: what differs from the rest pose (an angle in degrees, a shift, a stretch, an opacity). */
export interface Key { at: number; a?: number; dx?: number; dy?: number; sx?: number; sy?: number; o?: number; e?: Ease }
/** A movement: seconds per round, its keys, a delay (negative = already on its way), how many rounds (none = for ever). */
export interface Track { t: number; keys: Key[]; d?: number; n?: number }
export interface Rest { x: number; y: number; a: number; s: number; o: number }
export interface Group { g: Node[]; cls?: string; j?: Rest; track?: Track }
export type Node = Shape | Group;

const P = (p: string, f: string, o?: number): Shape => (o === undefined ? { p, f } : { p, f, o });
const S = (s: string, c: string, w: number, o?: number): Shape => (o === undefined ? { s, c, w } : { s, c, w, o });
const C = (x: number, y: number, r: number, f: string, o?: number): Shape => (o === undefined ? { c: [x, y, r], f } : { c: [x, y, r], f, o });
const E = (x: number, y: number, rx: number, ry: number, f: string, o?: number): Shape => (o === undefined ? { e: [x, y, rx, ry], f } : { e: [x, y, rx, ry], f, o });
export const sh = { P, S, C, E };

/** A joint: its children drawn from (x, y), turned by `a` degrees (clockwise), scaled, faded; `track` moves it. */
export function J(x: number, y: number, a: number, g: Node[], track?: Track, s = 1, o = 1): Group {
  return { g, j: { x, y, a, s, o }, ...(track ? { track } : {}) };
}
/** Children drawn in the theme's ink (notes, a «z», a thought) or its paper: they read on a light and on a dark strip. */
export const ink = (g: Node[]): Group => ({ g, cls: 'sp-ink' });
/** Eyes that blink (the only movement around a shape's own centre). */
export const blinking = (g: Node[]): Group => ({ g, cls: 'sp-blink' });

// ── tracks ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const n2 = (v: number) => String(Math.round(v * 100) / 100);
const pose = (r: Rest, k: Partial<Key>, withO: boolean) =>
  `transform:translate(${n2(r.x + (k.dx ?? 0))}px,${n2(r.y + (k.dy ?? 0))}px) rotate(${n2(k.a ?? r.a)}deg) scale(${n2(r.s * (k.sx ?? 1))},${n2(r.s * (k.sy ?? 1))})${withO ? `;opacity:${n2(k.o ?? r.o)}` : ''}`;
const fades = (r: Rest, t?: Track) => r.o !== 1 || !!t?.keys.some(k => k.o !== undefined);
/** The body of a joint's @keyframes rule: every key, the rest pose where the track does not start or end by itself. */
function frames(r: Rest, t: Track): string {
  // two keys at the same moment (a move that ends where the next one starts): the later one stands
  const keys = [...t.keys].sort((p, q) => p.at - q.at).filter((k, i, all) => all[i + 1]?.at !== k.at), withO = fades(r, t);
  if (keys[0]?.at !== 0) keys.unshift({ at: 0 });
  if (keys[keys.length - 1]!.at !== 100) keys.push({ at: 100 });
  return keys.map(k => `${n2(k.at)}%{${pose(r, k, withO)};animation-timing-function:${EASE[k.e ?? 'io']}}`).join('');
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/** The name of a joint's animation: the same movement has the same name, so it is written once. */
export const trackName = (r: Rest, t: Track): string => `spk-${hash(frames(r, t))}`;
/** A joint's own style: its rest pose and, with a track, its animation. */
export function jointStyle(n: Group): Record<string, string> {
  if (!n.j) return {};
  const out: Record<string, string> = { transform: pose(n.j, {}, false).slice('transform:'.length) };
  if (fades(n.j, n.track)) out.opacity = n2(n.j.o);
  if (n.track) out.animation = `${trackName(n.j, n.track)} ${n2(n.track.t)}s linear ${n2(n.track.d ?? 0)}s ${n.track.n ?? 'infinite'} both`;
  return out;
}
/** Every @keyframes rule a tree needs, each once, by its name. */
export function keyframeRules(nodes: readonly Node[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const n of walk(nodes)) if ('g' in n && n.j && n.track) { const body = frames(n.j, n.track); seen.set(`spk-${hash(body)}`, `@keyframes spk-${hash(body)}{${body}}`); }
  return seen;
}
export const keyframesCss = (nodes: readonly Node[]): string => [...keyframeRules(nodes).values()].join('\n');

/** There and back for ever: `t` seconds one way. */
export const sway = (a: number, t: number, d = 0, e: Ease = 'io'): Track => ({ t: t * 2, d, keys: [{ at: 0, e }, { at: 50, a, e }] });

export type Eyes = EyeLook;
export type Mouth = 'smile' | 'grin' | 'flat' | 'frown' | 'o';
export interface ArmPose {
  /** the shoulder's angle (0 = hanging; positive turns towards the left of the picture) and the elbow's */
  a: number; b?: number;
  go?: Track; goB?: Track;
  /** what the hand holds, drawn from the hand, along the forearm; its own angle and movement */
  held?: Node[]; ha?: number; goH?: Track;
  /** the fingers over what the hand holds (drawn after the hand, in the held thing's frame): the hand round a mug, a
   *  can, a stem; the palm stays behind it (a two-layer hand, as cut-out animation does it) */
  grip?: Node[];
}
/** A leg: the hip's angle and the knee's, and their movements. */
export interface LegPose { a?: number; go?: Track; b?: number; goB?: Track }
export interface Pose {
  armL?: ArmPose; armR?: ArmPose; legL?: LegPose; legR?: LegPose;
  /** the head: a tilt, a movement (it follows the body a little late), things on the face (a spyglass, a horn), in
   *  the head's own box (the badge's 64 × 64) */
  head?: { a?: number; go?: Track; over?: Node[] };
  eyes?: Eyes; mouth?: Mouth; blink?: boolean;
  /** the whole figure, turned around its feet (a lean) and moved or squashed from the ground (a hop, a landing) */
  lean?: number; go?: Track;
  /** behind the figure (a table, an anvil) and in front of everything (a bubble, notes) */
  back?: Node[]; front?: Node[];
  /** in front of the body but under the head and the arms (a table he stands behind: the hands reach over it) */
  mid?: Node[];
}
/** A body's measures: half the width between the shoulders, at the waist and at the hips, the thickness of an arm and
 *  of a leg, half the neck; `belly`: how far a paunch comes out past the waist. */
export interface Build { sh: number; waist: number; hip: number; arm: number; leg: number; neck: number; belly?: number }
const BUILD: Build = { sh: 7.2, waist: 5, hip: 5.4, arm: 3.7, leg: 4.3, neck: 2.2 };
export interface Look extends Features {
  /** the head, in the badge's box: its outline, the hair behind it, what is under the face (a beard, the dark of a
   *  helm), the hair or headwear and glasses over it, and what is over the face (a moustache, a cigar that smokes) */
  jaw?: string; hairBack?: Shape[]; under?: Shape[]; hair: Shape[]; over?: Node[];
  /** the clothes: the torso, the upper arm and the forearm (the skin = a bare arm), the hand (a glove), a cuff */
  top: string; sleeve?: string; fore?: string; hand?: string; cuff?: string;
  /** the legs: the thigh and the hips, the shin (a boot, a stocking), the shoe */
  pants: string; shin?: string; shoes: string;
  /** details over the torso and the hips (a tie, an apron); behind the whole body (a coat's tails, a cape); on each
   *  shoulder, turning with the arm (`pad`: a muscle) or staying on the shoulder over it (`cap`: a pauldron; `m`: 1 the
   *  left of the picture, -1 the right) */
  wear?: Node[]; behind?: Node[]; pad?: (m: 1 | -1) => Node[]; cap?: (m: 1 | -1) => Node[];
  build?: Build;
}

/** A grown figure, a little over three heads tall: the badge's head at this scale, its chin on the neck. */
const HEAD = { s: 0.56, x: 32, y: 32.9, chin: 44.5 };
const SH_Y = 36.3, HIP_Y = 49.4, UPPER = 6.6, FORE = 5.9, THIGH = 7.2, SHIN = 6.6;
/** The hand of an arm seen from its elbow: where a held thing starts. */
const HAND = FORE;

function face(look: Look, eyes: Eyes, mouth: Mouth, blink: boolean): Node[] {
  const f = features(look, eyes, mouth === 'smile' ? 'smirk' : mouth);
  return [blink && eyes === 'open' ? blinking(f.eyes) : { g: f.eyes }, ...f.rest];
}

function arm(side: 'l' | 'r', p: ArmPose, look: Look, b: Build): Group {
  const sleeve = look.sleeve ?? look.top, fore = look.fore ?? sleeve, m = side === 'l' ? 1 : -1;
  const x = side === 'l' ? 32 - b.sh : 32 + b.sh, upper = [S(`M0 0V${UPPER}`, sleeve, b.arm), ...(look.pad?.(m) ?? [])];
  const forearm = J(0, UPPER, p.b ?? 0, [S(`M0 0V${n2(FORE - b.arm * 0.4)}`, fore, b.arm * 0.9), ...(look.cuff ? [S(`M0 ${n2(FORE - b.arm * 0.62)}V${n2(FORE - b.arm * 0.4)}`, look.cuff, b.arm * 0.94)] : []),
    ...(p.held ? [J(0, HAND, p.ha ?? 0, p.held, p.goH)] : []), C(0, HAND, b.arm * 0.56, look.hand ?? look.skin), ...(p.grip ? [J(0, HAND, p.ha ?? 0, p.grip, p.goH)] : [])], p.goB);
  // a pauldron covers the upper arm only: the forearm, the hand and what it holds pass over it (the same turn twice)
  return look.cap ? { g: [J(x, SH_Y, p.a, upper, p.go), J(x, SH_Y, 0, look.cap(m)), J(x, SH_Y, p.a, [forearm], p.go)] } : J(x, SH_Y, p.a, [...upper, forearm], p.go);
}
function leg(side: 'l' | 'r', p: LegPose | undefined, look: Look, b: Build, toe: number): Group {
  const x = (b.hip - b.leg / 2 + 0.3) * (side === 'l' ? -1 : 1);
  return J(32 + x, HIP_Y, p?.a ?? 0, [
    S(`M0 0V${THIGH}`, look.pants, b.leg),
    J(0, THIGH, p?.b ?? 0, [S(`M0 0V${n2(SHIN - b.leg * 0.45)}`, look.shin ?? look.pants, b.leg * 0.9), E(toe, SHIN, 3.1, 1.75, look.shoes)], p?.goB),
  ], p?.go);
}
/** The trunk from the neck to the hips: the slope of the shoulders, the chest, the waist (or a paunch). */
function torso(b: Build): string {
  const a = b.sh + b.arm * 0.34, w = b.waist + (b.belly ?? 0), bulge = b.belly ? w + 1 : (a + w) / 2 - 0.6;
  const R = (x: number) => n2(32 + x), L = (x: number) => n2(32 - x);
  return `M${L(b.neck)} 33.8H${R(b.neck)}C${R(b.neck + 1.4)} 34.7 ${R(a - 1.5)} 34.2 ${R(a)} 36.3L${R(a - 0.4)} 39.4C${R(a - 0.8)} 42.4 ${R(bulge)} 44.6 ${R(w)} 47.4L${R(b.hip)} 50.6H${L(b.hip)}`
    + `L${L(w)} 47.4C${L(bulge)} 44.6 ${L(a - 0.8)} 42.4 ${L(a - 0.4)} 39.4L${L(a)} 36.3C${L(a - 1.5)} 34.2 ${L(b.neck + 1.4)} 34.7 ${L(b.neck)} 33.8Z`;
}

/** The whole person in a pose: its shadow, what is behind, legs, torso, head, arms over everything, what is in front. */
export function person(look: Look, pose: Pose = {}): Node[] {
  const b = look.build ?? BUILD, ear = shade(look.skin, 0.14), hips = Math.min(b.waist + (b.belly ?? 0), b.hip + 0.3);
  const walking = !!(pose.legL?.go ?? pose.legR?.go);
  const head = J(HEAD.x, HEAD.y, pose.head?.a ?? 0, [J(-32, -HEAD.chin, 0, [
    ...(look.hairBack ?? []),
    ...(look.glow ? [] : [C(20.4, 33, 2.6, ear), C(43.6, 33, 2.6, ear)]),
    P(look.jaw ?? JAW, look.skin),
    ...(look.under ?? []),
    ...face(look, pose.eyes ?? 'open', pose.mouth ?? 'smile', !!pose.blink),
    ...(look.over ?? []),
    ...look.hair,
    ...(pose.head?.over ?? []),
  ])], pose.head?.go, HEAD.s);
  const figure: Node[] = [
    ...(look.behind ?? []),
    leg('l', pose.legL, look, b, walking ? 0.9 : -0.5), leg('r', pose.legR, look, b, walking ? 0.9 : 0.5),
    S(`M32 31V${SH_Y - 1}`, look.glow ? look.top : ear, b.neck * 2),
    P(torso(b), look.top),
    P(`M${n2(32 - hips)} 46.9H${n2(32 + hips)}L${n2(32 + b.hip)} 50.6Q32 52.6 ${n2(32 - b.hip)} 50.6Z`, look.pants),
    ...(look.wear ?? []),
    ...(pose.mid ?? []),
    head,
    arm('l', pose.armL ?? { a: 5 }, look, b), arm('r', pose.armR ?? { a: -5 }, look, b),
  ];
  return [
    { g: [E(32, 64.6, 10, 1.4, '#000000')], cls: 'sp-shadow' },
    ...(pose.back ?? []),
    J(32, 64.2, pose.lean ?? 0, [J(-32, -64.2, 0, figure)], pose.go),
    ...(pose.front ?? []),
  ];
}

/** A speech bubble top right in the state's colour, with a white mark: «!» or a tick. */
export function bubble(colour: string, mark: '!' | 'ok', track?: Track, o = 1): Group {
  return J(66.5, 14.5, 0, [
    P('M-7 -9H7C8.9 -9 10.4 -7.5 10.4 -5.6V4.2C10.4 6.1 8.9 7.6 7 7.6H-2.6L-8.4 12.4L-7 7.6C-8.9 7.6 -10.4 6.1 -10.4 4.2V-5.6C-10.4 -7.5 -8.9 -9 -7 -9Z', colour),
    ...(mark === '!' ? [S('M0 -5.2V0.2', WHITE, 2.8), C(0, 4.1, 1.6, WHITE)] : [S('M-4.6 -0.8L-1.4 2.6L4.8 -4.2', WHITE, 2.8)]),
  ], track, 1, o);
}
/** A quaver, its head at 0 0. */
export const quaver = (c: string): Node[] => [E(0, 0, 2.2, 1.7, c), S('M1.9 -0.4V-7.4L5.4 -6', c, 1.4)];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** A node as SVG markup (the unit test compares scenes with it; AgentSprite draws the same tree as React elements). */
export function nodeSvg(n: Node): string {
  if (!('g' in n)) return shapeSvg(n);
  const style = Object.entries(jointStyle(n)).map(([k, v]) => `${k}:${v}`).join(';');
  const cls = [n.j ? 'sp-j' : '', n.cls ?? ''].filter(Boolean).join(' ');
  return `<g${cls ? ` class="${esc(cls)}"` : ''}${style ? ` style="${esc(style)}"` : ''}>${n.g.map(nodeSvg).join('')}</g>`;
}
/** Every joint and shape of a tree, flat. */
export function walk(nodes: readonly Node[], out: Node[] = []): Node[] {
  for (const n of nodes) { out.push(n); if ('g' in n) walk(n.g, out); }
  return out;
}
