// The cartoon characters the roles are drawn as (shared/characters.ts): a round badge in the role's own colour with a
// friendly face, the hair or headwear that makes the silhouette (the conductor's swept hair, the scout's wide hat, the
// sentinel's visored helmet…) and one prop. Trusted code, never user or model content: AgentAvatar renders these shapes, and
// scripts/agent-avatar-sheets.mjs draws the approval sheets and checks the colours from the same data. Two variants:
// the full one (24 px and up: face details and the prop) and a small one (16–20 px) that frames the head closer and
// keeps only the badge colour, the silhouette, plain eyes and glasses. Coordinates in a 64 × 64 box, absolute path
// commands only (M L H V C Q Z), so test/unit/characters.test.ts can check every point stays inside the badge.
import type { CharacterId } from '../../shared/characters';

/** One shape: a filled path, a stroked path, a filled circle, an ellipse or a ring. Colours are hex values. */
export type Shape =
  | { p: string; f: string; o?: number }
  | { s: string; c: string; w: number; o?: number }
  | { c: [number, number, number]; f: string; o?: number }
  | { e: [number, number, number, number]; f: string; o?: number }
  | { r: [number, number, number]; c: string; w: number; o?: number };

type Eyes = 'open' | 'happy' | 'calm';
type Mouth = 'smile' | 'grin' | 'open' | 'flat' | 'none';
type Brows = 'soft' | 'raised' | 'stern';
export interface Character {
  /** badge background (top-left, bottom-right) */
  bg: [string, string];
  skin: string;
  /** hair behind the head (a wig's rolls, a bun, an afro) */
  back?: Shape[];
  /** clothes: shoulders and collar */
  body: Shape[];
  /** hair and headwear over the head */
  head: Shape[];
  /** glasses: kept in the small variant */
  wear?: Shape[];
  /** beards and other things over the face */
  over?: Shape[];
  /** the prop, drawn last; full variant only */
  prop: Shape[];
  face: { eyes?: Eyes; mouth?: Mouth; brows?: Brows; brow?: string };
}

const INK = '#2a2230';
const P = (p: string, f: string, o?: number): Shape => (o === undefined ? { p, f } : { p, f, o });
const S = (s: string, c: string, w: number, o?: number): Shape => (o === undefined ? { s, c, w } : { s, c, w, o });
const C = (x: number, y: number, r: number, f: string, o?: number): Shape => (o === undefined ? { c: [x, y, r], f } : { c: [x, y, r], f, o });
const E = (x: number, y: number, rx: number, ry: number, f: string): Shape => ({ e: [x, y, rx, ry], f });
const R = (x: number, y: number, r: number, c: string, w: number): Shape => ({ r: [x, y, r], c, w });
const BODY = (f: string): Shape => P('M5 64C6 55 14.5 49.6 25.5 48.2L38.5 48.2C49.5 49.6 58 55 59 64Z', f);

/** A colour moved towards black (k > 0) or white (k < 0): shading for skin, ears and neck. */
export function shade(hex: string, k: number): string {
  const to = k > 0 ? 0 : 255, t = Math.abs(k);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, '0')).join('');
}

export const CHARACTERS: Record<CharacterId, Character> = {
  orchestrator: {
    bg: ['#8f6dff', '#5333d1'], skin: '#efc19c',
    back: [P('M17.6 37C13.8 30.5 14.4 22 19.2 16.8C23.8 11.8 30.4 10.2 37 11.2C44.6 12.4 50.4 17.2 51.8 24.2C52.8 29.4 51.2 34.4 48.2 37.4L45.6 29L20.4 29Z', '#cfd4e2'),
      P('M44 17.4C48.6 13.2 55 13.8 58.4 18.4C54.6 17.8 51.4 18.8 48.6 21.8Z', '#c2c8d8')],
    body: [BODY('#24222f'), P('M26.4 48.2L37.6 48.2L32 59Z', '#f7f7fb'),
      P('M25.4 48.2L31.2 58L28.2 61L21.4 50.2Z', '#3a3850'), P('M38.6 48.2L32.8 58L35.8 61L42.6 50.2Z', '#3a3850'),
      P('M27.2 48.4L31.6 50.6L27.2 52.8Z', '#e5484d'), P('M36.8 48.4L32.4 50.6L36.8 52.8Z', '#e5484d'), C(32, 50.6, 1.2, '#c23439')],
    head: [P('M20.2 29.6C19.6 21.2 25 16.4 32 16.4C39 16.4 44.6 21.2 44.2 29.6C42 24.4 37.6 22 32.6 22.4C27.6 22.8 23.2 25.2 20.2 29.6Z', '#eef0f6'),
      S('M24.2 21C28.2 18.2 34.4 17.6 40.4 19.8', '#c3c8d6', 1.2), S('M22.4 25.4C25.4 22.6 29.4 21.4 33.4 21.6', '#c3c8d6', 1)],
    prop: [C(13, 24.6, 2.3, '#ffffff'), S('M15.1 24.4V15.6L19.4 14.4V17.2', '#ffffff', 1.4),
      P('M44 51C45.8 47 47.2 44 48.4 41.8L52 43.4C51 46.6 49.8 50.4 48.2 53.4Z', '#24222f'),
      S('M50 40.6L58.4 21.4', '#ffffff', 1.8), C(58.4, 21.4, 1.3, '#ffd166'), C(50.2, 41.2, 2.7, '#efc19c')],
    face: { eyes: 'happy', mouth: 'smile', brows: 'soft', brow: '#b9bfcc' },
  },
  strategist: {
    bg: ['#5a86ff', '#2a4bc2'], skin: '#a8693f',
    body: [BODY('#2c2f3d'), P('M26.2 46.8C29 48.8 35 48.8 37.8 46.8L38.8 49.4C35.2 51.8 28.8 51.8 25.2 49.4Z', '#e2c08a'),
      P('M26 49.4L38 49.4L35 61L29 61Z', '#d3ad70'), P('M25.4 48.6L29.6 60L26.6 62L21 50.2Z', '#3d4154'), P('M38.6 48.6L34.4 60L37.4 62L43 50.2Z', '#3d4154')],
    head: [P('M20 30C19 21.4 24.6 16.8 32 16.8C39.4 16.8 45 21.4 44 30C43.2 27 42 25 40.4 23.6C35.4 25 28.4 24.6 24.4 22.6C22.4 24.6 21 27 20 30Z', '#1d1a22'),
      S('M26.4 19.2C29 21.6 33 22.6 37.4 22.4', '#3d3746', 1)],
    wear: [S('M23.4 29.8H30.6V34.4H23.4ZM33.4 29.8H40.6V34.4H33.4ZM30.6 31.4H33.4', '#121016', 1.4)],
    prop: [P('M47.4 51.6L56.6 51.6L56.6 50L55.4 49.2C55 46.6 56.2 44.4 56.2 41.8C56.2 38.8 54 36.8 51.2 36.8L50.6 36L49.6 37.4C48.4 38.2 47.2 39.8 46.4 41.6L46 43.4C46 44.4 46.8 44.8 47.6 44.6L49.8 43.6C50.2 45.2 49.2 46.8 48.4 48L48.2 49.2Z', '#ffffff'),
      P('M46.2 51.6H57.8V53.6H46.2Z', '#ffffff'), C(50.6, 39.8, 0.7, '#2a4bc2')],
    face: { eyes: 'open', mouth: 'smile', brows: 'raised', brow: '#1d1a22' },
  },
  scout: {
    bg: ['#4cc46c', '#20864a'], skin: '#f7d6ba',
    body: [BODY('#e2c48a'), P('M22 52.6H28.4V57.4H22ZM35.6 52.6H42V57.4H35.6Z', '#cfae6e'), P('M25.6 47.8L38.4 47.8L32 54.6Z', '#e0533d'), S('M23 49.6L40 62', '#7d5b28', 1.6)],
    head: [P('M20.4 30.6C20.4 25.4 23 23.4 26 23.4L38 23.4C41 23.4 43.6 25.4 43.6 30.6C41.2 28 38.2 27 35.2 27.4C33.2 25.8 30.6 25.8 28.6 27.4C25.4 26.8 22.8 28 20.4 30.6Z', '#cf6a2e'),
      E(32, 25, 21, 3.6, '#7d5b28'), E(32, 23.6, 21.4, 3.6, '#c39b55'),
      P('M21.6 24C21.6 15 26 10.6 32 10.6C38 10.6 42.4 15 42.4 24Z', '#d2ab65'),
      S('M26 13.8C29 12.2 35 12.2 38 13.8', '#b28a46', 1.2), P('M21.6 19.8H42.4V23.4H21.6Z', '#5a3d1c')],
    prop: [S('M46.6 46.8L41.4 52.2', '#6b4423', 3.4), C(51.2, 41.6, 5.2, '#c9f0ff', 0.6), R(51.2, 41.6, 5.6, '#ffffff', 2.6),
      S('M48.2 39.2C49 38.4 50 38 51.2 38', '#ffffff', 1.2)],
    face: { eyes: 'open', mouth: 'grin', brows: 'raised', brow: '#b4561f' },
  },
  artisan: {
    bg: ['#ffaf45', '#e2690f'], skin: '#7a4a2c',
    body: [BODY('#3d6fb0'), P('M22.6 51.4L41.4 51.4L42.4 64L21.6 64Z', '#7b4a26'), S('M24.4 51.6L27 48M39.6 51.6L37 48', '#7b4a26', 2.2),
      P('M28 55.8H36V60.4H28Z', '#643b1d')],
    head: [P('M20 29.6C19 20.6 24.6 16.4 32 16.4C39.4 16.4 45 20.6 44 29.6C40.6 26.6 36.6 25.6 32 25.6C27.4 25.6 23.4 26.6 20 29.6Z', '#d93b3b'),
      S('M20.4 28.8C24 25.8 28 25 32 25C36 25 40 25.8 43.6 28.8', '#a82525', 1.6),
      P('M43 24.2C46.6 21.6 50.4 20.8 53 21.8C51.4 24 49.2 25.2 46.2 25.8Z', '#c22e2e'), P('M43.6 26C47.2 26.6 50.6 28.6 51.6 31.2C48.6 31.2 46 30 43.4 28.2Z', '#b72a2a'),
      C(43.8, 25.6, 2, '#d93b3b'), C(26, 21, 1.1, '#ffffff'), C(32, 19.4, 1.1, '#ffffff'), C(38, 21, 1.1, '#ffffff'), C(29, 23.4, 0.9, '#ffffff'), C(35, 23.4, 0.9, '#ffffff')],
    prop: [S('M43.6 53.2L52.4 44.4', '#dfe4ea', 3.4), S('M51.6 40.4C49.4 42.8 50.2 46.8 53.6 47.6C56.6 48.2 59 45.4 58.2 42.4', '#dfe4ea', 3.2)],
    face: { eyes: 'open', mouth: 'grin', brows: 'soft', brow: '#2a1a12' },
  },
  sentinel: {
    bg: ['#2cc2b0', '#0b7c74'], skin: '#d39a6c',
    body: [BODY('#2d3a4a'), P('M22 52.4C26 49.8 38 49.8 42 52.4L41 64L23 64Z', '#a7b2c1'), S('M23 53.6C27 51.4 37 51.4 41 53.6', '#d9a72c', 1.6)],
    head: [P('M24.4 16.4C24 10.2 29 5.6 36 6C41.6 6.4 44.6 10 44 14.2C41 12 37.4 11.6 34 12.6C30 13.6 27 15 24.4 16.4Z', '#e2483d'),
      S('M27.4 13.6C30 10.6 34 9.2 38.4 9.6', '#b8302a', 1),
      P('M19 31C18.6 20 24.6 14.6 32 14.6C39.4 14.6 45.4 20 45 31L42.4 31L42.4 27L21.6 27L21.6 31Z', '#cdd5e0'),
      P('M19 28.8L22.6 28.8L23.2 39.4C21 38.8 19.6 36.2 19 33ZM45 28.8L41.4 28.8L40.8 39.4C43 38.8 44.4 36.2 45 33Z', '#aab5c4'),
      P('M20.4 25.4H43.6V28.6H20.4Z', '#7f8ca0'), C(23.2, 27, 0.7, '#e8edf3'), C(32, 27, 0.7, '#e8edf3'), C(40.8, 27, 0.7, '#e8edf3'),
      S('M25 19.6C27 17.6 30 16.6 33 16.6', '#eef2f6', 1.4)],
    prop: [P('M43.6 37.6C46.6 37.2 48.6 36 50.6 34.6C52.6 36 54.6 37.2 57.6 37.6L57.6 43C57.6 48 54.6 51.6 50.6 53.6C46.6 51.6 43.6 48 43.6 43Z', '#f2c94c'),
      P('M46.2 39.6C47.8 39.2 49.2 38.6 50.6 37.6L50.6 50.6C47.6 48.8 46.2 46.2 46.2 43Z', '#ffe08a'), S('M46.8 42.6L50.6 46.2L54.4 42.6', '#b07d12', 1.6)],
    face: { eyes: 'open', mouth: 'smile', brows: 'stern', brow: '#3b2416' },
  },
  herald: {
    bg: ['#f65e55', '#b8292b'], skin: '#f7d6ba',
    body: [BODY('#2d4fa1'), C(32, 55.6, 1.3, '#f2c14e'), C(32, 60.6, 1.3, '#f2c14e'),
      C(25.4, 48, 2.7, '#ffffff'), C(28.6, 49.4, 2.7, '#ffffff'), C(32, 49.8, 2.7, '#ffffff'), C(35.4, 49.4, 2.7, '#ffffff'), C(38.6, 48, 2.7, '#ffffff')],
    head: [P('M21 30.4C20.6 26 22 24 24 23.4L40 23.4C42 24 43.4 26 43 30.4C41 27.6 38 26.6 32 26.6C26 26.6 23 27.6 21 30.4Z', '#8a4b26'),
      P('M9.6 25.6C13 22 17 16 24 14.6C28 13.8 30 15 32 15C34 15 36 13.8 40 14.6C47 16 51 22 54.4 25.6C47 24.6 40 26.4 32 26.4C24 26.4 17 24.6 9.6 25.6Z', '#26224a'),
      S('M10.2 25.4C17 24.6 24 26.2 32 26.2C40 26.2 47 24.6 53.8 25.4', '#f2c14e', 1.6), C(32, 21.6, 2.1, '#e2483d'),
      P('M38 16C40 9 47 4.6 55 5.6C51 7.6 47 10.6 44.6 14C43 16 40.6 17.4 38 16Z', '#fff3d6'), S('M39 15.4C43 10.4 48 7.2 54 6', '#e2b85c', 0.9)],
    prop: [P('M5.6 34.4L14 40L14 43.2L5.6 48.6Z', '#f2c14e'), E(5.6, 41.5, 1.8, 7, '#d9a52e'), S('M14 41.6L21.4 43.6', '#f2c14e', 2.4),
      P('M10.6 43.2L19 45.4L18.4 52.4L14.6 50.4L10.8 51.6Z', '#e2483d'), C(22.4, 44, 2.5, '#f7d6ba')],
    face: { eyes: 'open', mouth: 'open', brows: 'raised', brow: '#6e3a1c' },
  },
  pulse: {
    bg: ['#43c4f2', '#1477b6'], skin: '#9a6040',
    body: [BODY('#f2c230'), P('M24.6 48L32 53.4L39.4 48L41.4 51L32 57.4L22.6 51Z', '#ddab1c'), S('M32 57.4V64', '#c9991b', 1.4)],
    head: [P('M20 29C19.6 19.6 25 15 32 15C39 15 44.4 19.6 44 29Z', '#e0533d'), P('M19.4 24.8H44.6V29.8H19.4Z', '#c23f2b'),
      S('M22.6 25.4V29.2M25.8 25.4V29.2M29 25.4V29.2M32.2 25.4V29.2M35.4 25.4V29.2M38.6 25.4V29.2M41.8 25.4V29.2', '#a8331f', 0.9), C(32, 13.4, 3.8, '#fff4e6')],
    over: [P('M21.4 33C21.4 40.2 25.4 45.6 32 45.6C38.6 45.6 42.6 40.2 42.6 33C41 37 39 38.6 36 38.4C34.6 37.4 33.4 37 32 37C30.6 37 29.4 37.4 28 38.4C25 38.6 23 37 21.4 33Z', '#d8dce3'),
      S('M30 40.6Q32 41.8 34 40.6', '#8b8f9c', 1.2)],
    prop: [C(50.4, 44, 8.6, '#ffe48a', 0.35), S('M47.6 36C47.6 32.6 53.2 32.6 53.2 36', '#3a3340', 1.2), P('M45 38.6L50.4 35.4L55.8 38.6Z', '#3a3340'),
      P('M46 38.6H54.8V50H46Z', '#3a3340'), P('M47.4 40H53.4V48.6H47.4Z', '#ffd23f'), E(50.4, 44.6, 1.4, 2.4, '#ff8a2a'), P('M45 50H55.8V52H45Z', '#3a3340')],
    face: { eyes: 'calm', mouth: 'none', brows: 'soft', brow: '#c3c7d0' },
  },
};

/** The face from a character's expression: eyes, brows, nose, mouth and cheeks (small: plain eyes only). */
export function faceShapes(ch: Character, small: boolean): Shape[] {
  const { eyes = 'open', mouth = 'smile', brows = 'soft', brow = INK } = ch.face;
  if (small) return eyes === 'happy'
    ? [S('M25.2 32.6Q27.3 30.2 29.4 32.6M34.6 32.6Q36.7 30.2 38.8 32.6', INK, 2)]
    : [E(27.3, 32.4, 1.9, 2.2, INK), E(36.7, 32.4, 1.9, 2.2, INK)];
  const out: Shape[] = [];
  if (eyes === 'happy') out.push(S('M25.4 32.6Q27.3 30.4 29.2 32.6M34.8 32.6Q36.7 30.4 38.6 32.6', INK, 1.5));
  else if (eyes === 'calm') out.push(E(27.3, 32.6, 1.6, 1.4, INK), E(36.7, 32.6, 1.6, 1.4, INK), C(27.8, 32.1, 0.5, '#ffffff'), C(37.2, 32.1, 0.5, '#ffffff'));
  else out.push(E(27.3, 32.4, 1.7, 2.1, INK), E(36.7, 32.4, 1.7, 2.1, INK), C(27.9, 31.6, 0.65, '#ffffff'), C(37.3, 31.6, 0.65, '#ffffff'));
  out.push(S(brows === 'stern' ? 'M24.8 27.8L29.4 28.8M39.2 27.8L34.6 28.8'
    : brows === 'raised' ? 'M24.8 27.6Q27.2 26 29.6 27.6M34.4 27.2Q36.8 25.6 39.2 27.2'
      : 'M25 28.4Q27.2 27.4 29.4 28.4M34.6 28.4Q36.8 27.4 39 28.4', brow, 1.3));
  out.push(S('M31.2 35.4Q32 36.4 32.8 35.4', shade(ch.skin, 0.28), 1.1));
  if (mouth === 'smile') out.push(S('M29 38.4Q32 40.8 35 38.4', INK, 1.4));
  else if (mouth === 'grin') out.push(P('M28.4 37.8Q32 38.8 35.6 37.8Q35 41.6 32 41.6Q29 41.6 28.4 37.8Z', '#5b1f2a'), P('M29.2 38.2Q32 38.9 34.8 38.2L34.6 39.1Q32 39.6 29.4 39.1Z', '#ffffff'));
  else if (mouth === 'open') out.push(P('M29.2 37.6Q32 37.2 34.8 37.6Q34.8 41.8 32 41.8Q29.2 41.8 29.2 37.6Z', '#5b1f2a'), E(32, 40.6, 1.6, 0.8, '#e46a7a'));
  else if (mouth === 'flat') out.push(S('M29.6 39H34.4', INK, 1.4));
  out.push({ e: [24.4, 36.6, 2, 1.2], f: '#ff7d86', o: 0.45 }, { e: [39.6, 36.6, 2, 1.2], f: '#ff7d86', o: 0.45 });
  return out;
}

/** Every shape of a character, back to front, over its badge: the one list AgentAvatar and the sheets draw. */
export function characterShapes(id: CharacterId, small: boolean): Shape[] {
  const ch = CHARACTERS[id], ear = shade(ch.skin, 0.12);
  return [
    ...(ch.back ?? []),
    ...ch.body,
    P('M27.6 39L36.4 39L36.4 48.6C33.6 50.6 30.4 50.6 27.6 48.6Z', ear),
    C(20, 32.8, 2.8, ear), C(44, 32.8, 2.8, ear),
    E(32, 31.4, 11.6, 12.6, ch.skin),
    ...faceShapes(ch, small),
    ...(ch.over ?? []),
    ...ch.head,
    ...(small ? (ch.wear ?? []).map(s => ('w' in s ? { ...s, w: s.w * 1.4 } : s)) : (ch.wear ?? [])),
    ...(small ? [] : ch.prop),
  ];
}

/** The badge circle and view box: the whole 64 × 64 badge, or (small) a closer frame around the head. */
export const frameOf = (small: boolean) => (small ? { cx: 32, cy: 30, r: 22 } : { cx: 32, cy: 32, r: 32 });
/** From this size up the full variant is drawn; below it the small one. */
export const FULL_MIN = 24;
/** The accent colour of a role's page and card: its character's badge colour. */
export const characterTone = (id: CharacterId): string => CHARACTERS[id].bg[0];

/** One shape as SVG markup (the approval sheets; AgentAvatar draws the same shapes as React elements). */
export function shapeSvg(s: Shape): string {
  const o = s.o === undefined ? '' : ` opacity="${s.o}"`, line = (c: string, w: number) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  if ('p' in s) return `<path d="${s.p}" fill="${s.f}"${o}/>`;
  if ('s' in s) return `<path d="${s.s}" ${line(s.c, s.w)}${o}/>`;
  if ('e' in s) return `<ellipse cx="${s.e[0]}" cy="${s.e[1]}" rx="${s.e[2]}" ry="${s.e[3]}" fill="${s.f}"${o}/>`;
  if ('r' in s) return `<circle cx="${s.r[0]}" cy="${s.r[1]}" r="${s.r[2]}" ${line(s.c, s.w)}${o}/>`;
  return `<circle cx="${s.c[0]}" cy="${s.c[1]}" r="${s.c[2]}" fill="${s.f}"${o}/>`;
}
/** A whole badge as standalone SVG markup at a pixel size; `uid` keeps gradient and clip ids unique in a page. */
export function characterSvg(id: CharacterId, size: number, uid: string): string {
  const small = size < FULL_MIN, { cx, cy, r } = frameOf(small), [a, b] = CHARACTERS[id].bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - r} ${cy - r} ${2 * r} ${2 * r}" width="${size}" height="${size}">`
    + `<defs><linearGradient id="g${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
    + `<clipPath id="c${uid}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>`
    + `<g clip-path="url(#c${uid})"><rect x="0" y="0" width="64" height="64" fill="url(#g${uid})"/>${characterShapes(id, small).map(shapeSvg).join('')}</g>`
    + `<circle class="ring" cx="${cx}" cy="${cy}" r="${r - r * 0.024}" fill="none" stroke-width="${r * 0.047}"/></svg>`;
}
