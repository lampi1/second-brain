// The rig of the little people the roles are animated as (ADR 0295; the owner, 2026-11-13: «veri e propri omini che
// fanno cose», «non li voglio pixelosi, li voglio normali, smooth», «animazioni veramente fighe … non dentro un
// quadrato colorato ma liberi»): smooth vector people, the head of the role's portrait (lib/character-art.ts) on a
// small body with two legs and two arms that bend at the elbow. A person is a tree of shapes and joints; a joint has a
// rest pose (a place, an angle, a scale, an opacity) and a track: keys in time, each with its own easing, compiled to
// one CSS @keyframes rule (keyframesCss), so a movement can load, strike, overshoot, squash and settle instead of
// going there and back. Trusted code, never user or model content. Pure data and text: lib/agent-sprites.ts writes
// each role's scenes with it, AgentSprite.tsx draws them, test/unit/agent-sprites.test.ts checks them.
import { shade, shapeSvg, type Shape } from './character-art';

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

export type Eyes = 'open' | 'closed' | 'happy' | 'sad' | 'up' | 'none';
export type Mouth = 'smile' | 'grin' | 'flat' | 'frown' | 'o';
export interface ArmPose {
  /** the shoulder's angle (0 = hanging; positive turns towards the left of the picture) and the elbow's */
  a: number; b?: number;
  go?: Track; goB?: Track;
  /** what the hand holds, drawn from the hand, along the forearm; its own angle and movement */
  held?: Node[]; ha?: number; goH?: Track;
}
export interface LegPose { a?: number; go?: Track }
export interface Pose {
  armL?: ArmPose; armR?: ArmPose; legL?: LegPose; legR?: LegPose;
  /** the head: a tilt, a movement (it follows the body a little late), things on the face (binoculars, a horn) */
  head?: { a?: number; go?: Track; over?: Node[] };
  eyes?: Eyes; mouth?: Mouth; blink?: boolean;
  /** the whole figure, turned around its feet (a lean) and moved or squashed from the ground (a hop, a landing) */
  lean?: number; go?: Track;
  /** behind the figure (a table, an anvil) and in front of everything (a bubble, notes) */
  back?: Node[]; front?: Node[];
}
export interface Look {
  skin: string;
  /** the portrait's hair behind the head, and its hair or headwear and glasses over it */
  hairBack?: Shape[]; hair: Shape[];
  top: string; sleeve?: string; pants: string; shoes: string;
  /** details on the clothes, drawn over the torso */
  wear?: Node[];
}

const SHOULDER = { l: 25.6, r: 38.4, y: 46.6 }, HIP = { l: 28.3, r: 35.7, y: 57 };
/** The hand of an arm seen from its elbow: where a held thing starts. */
const HAND = 5.4;

function face(look: Look, eyes: Eyes, mouth: Mouth, blink: boolean): Node[] {
  const out: Node[] = [];
  const pair = (dx: number, dy: number): Node[] => [E(27.3 + dx, 32.4 + dy, 1.9, 2.3, INK), E(36.7 + dx, 32.4 + dy, 1.9, 2.3, INK), C(27.9 + dx, 31.5 + dy, 0.7, WHITE), C(37.3 + dx, 31.5 + dy, 0.7, WHITE)];
  if (eyes === 'open') out.push(blink ? blinking(pair(0, 0)) : { g: pair(0, 0) });
  else if (eyes === 'up') out.push({ g: pair(0.9, -1.1) });
  else if (eyes === 'sad') out.push({ g: pair(0, 0.5) }, S('M24.6 29.2L29.4 27.6M39.4 29.2L34.6 27.6', shade(look.skin, 0.55), 1.4));
  else if (eyes === 'happy') out.push(S('M25 33.2Q27.3 30.2 29.6 33.2M34.4 33.2Q36.7 30.2 39 33.2', INK, 1.8));
  else if (eyes === 'closed') out.push(S('M25.2 32.4Q27.3 34.4 29.4 32.4M34.6 32.4Q36.7 34.4 38.8 32.4', INK, 1.6));
  if (mouth === 'smile') out.push(S('M29.2 38.2Q32 40.6 34.8 38.2', INK, 1.4));
  else if (mouth === 'grin') out.push(P('M28.4 37.6Q32 38.6 35.6 37.6Q35 41.6 32 41.6Q29 41.6 28.4 37.6Z', '#5b1f2a'), P('M29.2 38Q32 38.8 34.8 38L34.6 39Q32 39.5 29.4 39Z', WHITE));
  else if (mouth === 'flat') out.push(S('M29.8 39H34.2', INK, 1.4));
  else if (mouth === 'frown') out.push(S('M29.4 40Q32 37.8 34.6 40', INK, 1.4));
  else out.push(E(32, 39.2, 1.5, 1.8, '#5b1f2a'));
  out.push(E(24.4, 36.8, 2.1, 1.3, '#ff7d86', 0.5), E(39.6, 36.8, 2.1, 1.3, '#ff7d86', 0.5));
  return out;
}

function arm(side: 'l' | 'r', p: ArmPose, look: Look): Group {
  const sleeve = look.sleeve ?? look.top;
  return J(SHOULDER[side], SHOULDER.y, p.a, [
    S('M0 0V5', sleeve, 4.6),
    J(0, 5, p.b ?? 0, [S('M0 0V3.6', sleeve, 4.6), ...(p.held ? [J(0, HAND, p.ha ?? 0, p.held, p.goH)] : []), C(0, HAND, 2.5, look.skin)], p.goB),
  ], p.go);
}
function leg(side: 'l' | 'r', p: LegPose | undefined, look: Look, toe: number): Group {
  return J(HIP[side], HIP.y, p?.a ?? 0, [S('M0 0V4.4', look.pants, 5.2), E(toe, 5.8, 3.4, 2, look.shoes)], p?.go);
}

/** The whole person in a pose: its shadow, what is behind, legs, torso, head, arms over everything, what is in front. */
export function person(look: Look, pose: Pose = {}): Node[] {
  const ear = shade(look.skin, 0.12);
  const walking = !!(pose.legL?.go ?? pose.legR?.go);
  const head = J(32, 43.6, pose.head?.a ?? 0, [J(-32, -43.6, 0, [
    ...(look.hairBack ?? []),
    C(20.2, 32.8, 2.7, ear), C(43.8, 32.8, 2.7, ear), E(32, 31.4, 11.6, 12.6, look.skin),
    ...face(look, pose.eyes ?? 'open', pose.mouth ?? 'smile', !!pose.blink),
    ...look.hair,
    ...(pose.head?.over ?? []),
  ])], pose.head?.go);
  const figure: Node[] = [
    leg('l', pose.legL, look, walking ? 0.9 : -0.5), leg('r', pose.legR, look, walking ? 0.9 : 0.5),
    P('M24.6 47.6C24.6 44.8 26.6 42.8 29.4 42.8H34.6C37.4 42.8 39.4 44.8 39.4 47.6L40 55.6C40 57 39 58 37.6 58H26.4C25 58 24 57 24 55.6Z', look.top),
    ...(look.wear ?? []),
    P('M24.2 54.6H39.8L40 55.6C40 57 39 58 37.6 58H26.4C25 58 24 57 24 55.6Z', look.pants),
    head,
    arm('l', pose.armL ?? { a: 6 }, look), arm('r', pose.armR ?? { a: -6 }, look),
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
