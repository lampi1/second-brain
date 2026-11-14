// The characters the roles are drawn as (shared/characters.ts): a round badge in the role's own colour with an adult
// face (a jaw, small eyes under brows, a nose, a beard or a moustache where it fits), the hair or headwear that makes
// the silhouette (the wizard's white hair and beard, the scout's worn hat, the smith's rag and cigar, the sentinel's closed
// helm…) and one prop. Trusted code, never user or model content: AgentAvatar renders these shapes, and
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

/** The eyes of a face: open, shut, narrowed by a grin, worried, looking up, or none (a face that is covered). */
export type EyeLook = 'open' | 'closed' | 'happy' | 'sad' | 'up' | 'none';
export type MouthLook = 'smirk' | 'grin' | 'flat' | 'frown' | 'o' | 'none';
/** The brows at rest: level, drawn together, one raised, thick and low. */
export type Brows = 'flat' | 'stern' | 'arched' | 'heavy';
/** What makes a face this person's own: its skin, its brows, heavy lids, the nose; `glow` for a face in the dark of a
 *  closed helm (two slits of light, no mouth); `lip` where the mouth is drawn over a beard. */
export interface Features { skin: string; brow?: string; brows?: Brows; lids?: boolean; nose?: 'sharp' | 'broad'; glow?: string; lip?: string }
export interface Character {
  /** badge background (top-left, bottom-right) */
  bg: [string, string];
  skin: string;
  /** the head's outline (a jaw); a plain one without */
  jaw?: string;
  /** hair behind the head (a mane, a hood) */
  back?: Shape[];
  /** clothes: shoulders and collar */
  body: Shape[];
  /** over the skin and under the face: a beard, stubble, the dark inside a helm */
  under?: Shape[];
  /** hair and headwear over the head */
  head: Shape[];
  /** glasses: kept in the small variant */
  wear?: Shape[];
  /** over the face: a moustache, a cigar, a scar */
  over?: Shape[];
  /** the prop, drawn last; full variant only */
  prop: Shape[];
  face: Omit<Features, 'skin'> & { eyes?: EyeLook; mouth?: MouthLook };
}

const INK = '#2a2230', WHITE = '#ffffff';
const P = (p: string, f: string, o?: number): Shape => (o === undefined ? { p, f } : { p, f, o });
const S = (s: string, c: string, w: number, o?: number): Shape => (o === undefined ? { s, c, w } : { s, c, w, o });
const C = (x: number, y: number, r: number, f: string, o?: number): Shape => (o === undefined ? { c: [x, y, r], f } : { c: [x, y, r], f, o });
const E = (x: number, y: number, rx: number, ry: number, f: string, o?: number): Shape => (o === undefined ? { e: [x, y, rx, ry], f } : { e: [x, y, rx, ry], f, o });
/** Shoulders: `w` is how far they reach from the middle at the bottom of the badge. */
const BODY = (f: string, w = 27): Shape => P(`M${32 - w} 64C${33 - w} 55.4 ${41 - w * 0.65} 50 25.5 48.4L38.5 48.4C${23 + w * 0.65} 50 ${31 + w} 55.4 ${32 + w} 64Z`, f);

/** A colour moved towards black (k > 0) or white (k < 0): shading for skin, ears and neck. */
export function shade(hex: string, k: number): string {
  const to = k > 0 ? 0 : 255, t = Math.abs(k);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, '0')).join('');
}

/** The outline of a grown head, in the badge's box: the skull, the cheeks down to `jaw` (half the width where the jaw
 *  turns) and a chin `chin` wide ending at `y`. */
export const jawPath = (jaw = 9.6, chin = 4.6, y = 44.8): string =>
  `M20.7 30C20.7 22.3 25.5 18.6 32 18.6C38.5 18.6 43.3 22.3 43.3 30V34.4C43.3 37.4 ${32 + jaw + 0.9} 39.6 ${32 + jaw} 41.4C${32 + jaw - 1.6} 43.4 ${32 + chin + 0.4} ${y} 32 ${y}C${32 - chin - 0.4} ${y} ${32 - jaw + 1.6} 43.4 ${32 - jaw} 41.4C${32 - jaw - 0.9} 39.6 20.7 37.4 20.7 34.4Z`;
export const JAW = jawPath();

const ROBE = '#2a2456', STEEL = '#3b4252', STEEL_HI = '#5d6780', BLOOD = '#b3261e', LEATHER = '#5a3a22';
export const CHARACTERS: Record<CharacterId, Character> = {
  // the old wizard: long white hair parted in the middle, a white beard down to the chest, small round glasses low on
  // the nose, a midnight robe with a gold hem and a wand
  orchestrator: {
    bg: ['#8f6dff', '#5333d1'], skin: '#ecc4a4', jaw: jawPath(8.6, 3.6, 45.2),
    back: [P('M19.8 25C16.4 31 15 41 16 50C16.6 55 18.4 58.6 21 61L26 50L24 34ZM44.2 25C47.6 31 49 41 48 50C47.4 55 45.6 58.6 43 61L38 50L40 34Z', '#cfd4df')],
    body: [BODY(ROBE), P('M24.4 48.4H39.6L36.2 64H27.8Z', '#3a2f6e'), S('M24.6 48.6L28.4 64M39.4 48.6L35.6 64', '#e3c067', 1.4),
      P('M12.6 57.4L13.2 58.9L14.7 59.5L13.2 60.1L12.6 61.6L12 60.1L10.5 59.5L12 58.9Z', '#e3c067'), P('M50.4 55.4L50.9 56.6L52.1 57.1L50.9 57.6L50.4 58.8L49.9 57.6L48.7 57.1L49.9 56.6Z', '#e3c067')],
    under: [P('M20.8 33C21.4 36.4 23 38.2 25.4 38.6C27.2 37.4 29.6 37 32 37.6C34.4 37 36.8 37.4 38.6 38.6C41 38.2 42.6 36.4 43.2 33C44.6 39.4 43.8 45 41.4 49.4C39.2 53.4 36 57.4 32 60.8C28 57.4 24.8 53.4 22.6 49.4C20.2 45 19.4 39.4 20.8 33Z', '#f1f3f8'),
      S('M26.4 44.6C27.4 49.6 29.6 54 32 57.4M37.6 44.6C36.6 49.6 34.4 54 32 57.4M32 45V53', '#c3c9d6', 0.9)],
    head: [P('M20.3 31C19.2 21.6 24.6 16 32 16C39.4 16 44.8 21.6 43.7 31C42.9 26.6 40.9 23.6 37.8 22.4C35.4 21.6 33.4 22.4 32 24.2C30.6 22.4 28.6 21.6 26.2 22.4C23.1 23.6 21.1 26.6 20.3 31Z', '#f1f3f8'),
      S('M32 24V17.4', '#c3c9d6', 0.9), S('M23 24.6C24.4 21.4 27 19.4 30 18.8M41 24.6C39.6 21.4 37 19.4 34 18.8', '#c3c9d6', 0.9)],
    wear: [C(27.3, 34.3, 2.7, '#cfe6ff', 0.22), C(36.7, 34.3, 2.7, '#cfe6ff', 0.22), { r: [27.3, 34.3, 2.7], c: '#c9982e', w: 1.1 }, { r: [36.7, 34.3, 2.7], c: '#c9982e', w: 1.1 },
      S('M30 34H34', '#c9982e', 1.1)],
    over: [S('M32 38.4C30.2 37.6 27.8 38 26.2 40C25.2 41.4 24.6 43.4 24.4 45.4M32 38.4C33.8 37.6 36.2 38 37.8 40C38.8 41.4 39.4 43.4 39.6 45.4', '#f1f3f8', 2.2)],
    prop: [P('M44 51C45.8 47 47.2 44 48.4 41.8L52 43.4C51 46.6 49.8 50.4 48.2 53.4Z', ROBE), S('M47.6 42.6L51.4 44.2', '#e3c067', 1.2),
      S('M50 40.6L56 23.6', '#f4e9d2', 1.8), C(50.2, 41.2, 2.7, '#ecc4a4'),
      P('M56.4 16.6L57.6 20.6L61.6 21.8L57.6 23L56.4 27L55.2 23L51.2 21.8L55.2 20.6Z', '#ffd166'), C(56.4, 21.8, 1.1, WHITE),
      P('M13.4 21.4L14.2 23.8L16.6 24.6L14.2 25.4L13.4 27.8L12.6 25.4L10.2 24.6L12.6 23.8Z', WHITE, 0.9), P('M19.2 14.4L19.7 15.9L21.2 16.4L19.7 16.9L19.2 18.4L18.7 16.9L17.2 16.4L18.7 15.9Z', WHITE, 0.7)],
    face: { eyes: 'open', mouth: 'smirk', brows: 'arched', brow: '#b4bac8', nose: 'sharp', lip: '#b98a72' },
  },
  // the strategist: a cropped fade going grey, gold-rimmed glasses, a short boxed beard, nothing given away
  strategist: {
    bg: ['#5a86ff', '#2a4bc2'], skin: '#a8693f', jaw: jawPath(9, 4.2, 45),
    body: [BODY('#eef0f5'), P('M24.6 48.6L32 62L39.4 48.6L44 51L43 64H21L20 51Z', '#2c2f3d'), P('M29.6 49L34.4 49L33.6 52L35 60L32 63L29 60L30.4 52Z', '#d9a23c'),
      P('M25.6 48.2L32 51.4L29 54.6L24.6 49.6ZM38.4 48.2L32 51.4L35 54.6L39.4 49.6Z', '#ffffff')],
    under: [P('M20.9 33.4C21.5 36.6 23 38.4 25.4 38.8C26.8 37.4 29.2 36.9 32 37.2C34.8 36.9 37.2 37.4 38.6 38.8C41 38.4 42.5 36.6 43.1 33.4C43.8 38.8 42.4 42.2 39.4 44.2C37 45.8 34.6 46.4 32 46.4C29.4 46.4 27 45.8 24.6 44.2C21.6 42.2 20.2 38.8 20.9 33.4Z', '#1d1a22'),
      P('M29.8 43.2Q32 42.4 34.2 43.2L33.6 46.1Q32 46.5 30.4 46.1Z', '#8a8d99')],
    head: [P('M20.5 29.6C19.8 21.6 24.9 17 32 17C39.1 17 44.2 21.6 43.5 29.6C42.9 26.8 41.9 25.2 40.5 24C35.5 24.9 28.5 24.9 23.5 24C22.1 25.2 21.1 26.8 20.5 29.6Z', '#1d1a22'),
      S('M21.3 28.2L22.6 25.2M42.7 28.2L41.4 25.2', '#8a8d99', 1.5), S('M26.4 19.6C29 21.4 33 22.2 37.4 22', '#3d3746', 1)],
    wear: [P('M23 29.5H30.6V34.3H23ZM33.4 29.5H41V34.3H33.4Z', '#cfe6ff', 0.2), S('M23 29.5H30.6V34.3H23ZM33.4 29.5H41V34.3H33.4ZM30.6 31.2H33.4M23 30.4L20.8 29.8M41 30.4L43.2 29.8', '#e3c067', 1.2),
      S('M24.2 30.6L25.8 30.6M34.6 30.6L36.2 30.6', WHITE, 0.8, 0.8)],
    prop: [P('M47.4 51.6L56.6 51.6L56.6 50L55.4 49.2C55 46.6 56.2 44.4 56.2 41.8C56.2 38.8 54 36.8 51.2 36.8L50.6 36L49.6 37.4C48.4 38.2 47.2 39.8 46.4 41.6L46 43.4C46 44.4 46.8 44.8 47.6 44.6L49.8 43.6C50.2 45.2 49.2 46.8 48.4 48L48.2 49.2Z', WHITE),
      P('M46.2 51.6H57.8V53.6H46.2Z', WHITE), C(50.6, 39.8, 0.7, '#2a4bc2')],
    face: { eyes: 'open', mouth: 'flat', brows: 'flat', brow: '#1d1a22', lids: true, nose: 'broad', lip: '#d99a72' },
  },
  // the scout: a tracker under a worn leather hat, ginger hair and a short beard, eyes narrowed by the sun
  scout: {
    bg: ['#4cc46c', '#20864a'], skin: '#e6b890',
    back: [P('M19.6 27C18.2 33 18.8 39 21.4 43.4L24 36L40 36L42.6 43.4C45.2 39 45.8 33 44.4 27Z', '#a44a1a')],
    body: [BODY('#55613a'), P('M25.2 48.2H38.8L36.6 64H27.4Z', '#d9c08a'), P('M25.4 48L32 56.8L38.6 48L40.4 50.8L32 61L23.6 50.8Z', '#c23a2a'),
      P('M22.4 49.6L27.6 64H17.4L15.4 55.6ZM41.6 49.6L36.4 64H46.6L48.6 55.6Z', '#454f2e'), S('M21.6 51.6L41 63.6', '#3a2a16', 1.8)],
    under: [P('M20.9 33.6C21.6 38.8 24 42.6 27.6 44.2C30.4 45.4 33.6 45.4 36.4 44.2C40 42.6 42.4 38.8 43.1 33.6C41.8 36.4 39.8 37.8 37.6 37.6C35.6 36.6 33.6 36.5 32 37C30.4 36.5 28.4 36.6 26.4 37.6C24.2 37.8 22.2 36.4 20.9 33.6Z', '#b5551f', 0.78)],
    head: [P('M20.4 31C20.4 25.4 23 23.4 26 23.4L38 23.4C41 23.4 43.6 25.4 43.6 31C41.6 28.4 39 27.2 36 27.4C33.4 26.2 30.6 26.2 28 27.4C25 27.2 22.4 28.4 20.4 31Z', '#b5551f'),
      E(32, 25.2, 22.4, 3.9, '#4a3319'), E(32, 23.7, 22.6, 3.8, '#7d5a2c'),
      P('M21.8 24.2C21.4 15.4 25.6 10.8 29.4 11.4C30.6 11.6 31.4 12.6 32 12.6C32.6 12.6 33.4 11.6 34.6 11.4C38.4 10.8 42.6 15.4 42.2 24.2Z', '#8d6833'),
      S('M27.6 13.6C29.6 15.2 34.4 15.2 36.4 13.6', '#6f5026', 1.2), P('M21.7 19.8H42.3V23.6H21.7Z', '#33230f'), S('M24.6 21.7H27.8M30.4 21.7H33.6M36.2 21.7H39.4', '#c9a25c', 0.9)],
    over: [S('M38.4 34.4L41 38.2', '#b98a66', 1)],
    prop: [S('M45.6 51.4L50.4 44.6', '#8a6534', 4.4), S('M50.4 44.6L55 38', '#c9a25c', 5.2), S('M49.6 45.8L51.2 43.4M54.2 39.2L55.8 36.8', '#f2dc9c', 5.6), C(55.6, 37.2, 2, '#c9f0ff', 0.9)],
    face: { eyes: 'open', mouth: 'smirk', brows: 'flat', brow: '#8a3f14', lids: true, nose: 'sharp', lip: '#6b2f12' },
  },
  // the smith: a bull neck, a red rag tied on the skull, a black beard down to the chest and a cigar in its corner
  artisan: {
    bg: ['#ffaf45', '#e2690f'], skin: '#8a5533', jaw: jawPath(10.6, 6.4, 45),
    body: [P('M3 64C4 54.6 12 49 25 48L39 48C52 49 60 54.6 61 64Z', '#8a5533'), S('M14.6 54.6C18 52.4 22 51.6 25.6 51.8M49.4 54.6C46 52.4 42 51.6 38.4 51.8', '#6e4126', 1.1),
      P('M23 53.6H41L42.6 64H21.4Z', LEATHER), S('M24.4 53.8L22.4 49M39.6 53.8L41.6 49', LEATHER, 2.6), S('M24.6 56.6H39.4', '#45290f', 1)],
    under: [P('M20.5 32.6C21.2 35.8 22.6 37.4 25 37.7C27.2 36.4 29.6 36.1 32 36.9C34.4 36.1 36.8 36.4 39 37.7C41.4 37.4 42.8 35.8 43.5 32.6C45 39.6 43.8 45.4 40.4 48.6C38 50.8 35 51.6 32 51.6C29 51.6 26 50.8 23.6 48.6C20.2 45.4 19 39.6 20.5 32.6Z', '#17120f'),
      S('M25.6 43C26.6 45.6 28 47.6 29.8 48.8M38.4 43C37.4 45.6 36 47.6 34.2 48.8M32 44.6V49.6', '#3a2d25', 1)],
    head: [P('M19.9 30C18.8 20.6 24.4 16 32 16C39.6 16 45.2 20.6 44.1 30C40.6 26.8 36.6 25.8 32 25.8C27.4 25.8 23.4 26.8 19.9 30Z', BLOOD),
      S('M20.4 29C24 26 28 25.1 32 25.1C36 25.1 40 26 43.6 29', '#7d1711', 1.7), S('M24.4 20.4C27 18.4 31 17.6 35.4 18.2', '#d1483c', 1.1),
      P('M43.2 24.4C46.8 21.8 50.6 21 53.2 22C51.6 24.2 49.4 25.4 46.4 26Z', '#9c2019'), P('M43.8 26.2C47.4 26.8 50.8 28.8 51.8 31.4C48.8 31.4 46.2 30.2 43.6 28.4Z', '#8a1b15'), C(44, 25.8, 2, BLOOD)],
    over: [S('M34.2 40.6L42.4 42.6', '#6b4226', 2.5), S('M41.6 42.4L43.2 42.8', '#d9d4cc', 2.5), C(43.9, 42.95, 1.1, '#ff7a1a'), S('M25 26.6L26.6 30.4', '#6e4126', 0.9)],
    prop: [S('M50.6 58.6L52.4 40.4', '#7b5230', 3), P('M45 32.6H59.8C60.9 32.6 61.6 33.3 61.6 34.4V40C61.6 41.1 60.9 41.8 59.8 41.8H45C43.9 41.8 43.2 41.1 43.2 40V34.4C43.2 33.3 43.9 32.6 45 32.6Z', '#8d96a8'),
      P('M43.2 38.6H61.6V40C61.6 41.1 60.9 41.8 59.8 41.8H45C43.9 41.8 43.2 41.1 43.2 40Z', '#5d6577'), S('M46 34.8H58.6', '#c3cad8', 1.1)],
    face: { eyes: 'open', mouth: 'none', brows: 'heavy', brow: '#17120f', nose: 'broad', lip: '#c08566' },
  },
  // the sentinel: no face, a dark helm with a blood-red crest and two slits of light where the eyes should be
  sentinel: {
    bg: ['#2cc2b0', '#0b7c74'], skin: '#0b0c11', jaw: 'M22.4 27.6H41.6V36H35.4V46.4H28.6V36H22.4Z',
    body: [BODY('#262b37', 29), P('M20.6 51.6C25 49.2 39 49.2 43.4 51.6L42 64H22Z', STEEL), S('M27.6 55.2L32 60.4L36.4 55.2', BLOOD, 2),
      P('M3.6 64C4 56.6 9.6 51.6 17.4 50.4C20.2 52.2 21.4 56 20.6 64ZM60.4 64C60 56.6 54.4 51.6 46.6 50.4C43.8 52.2 42.6 56 43.4 64Z', STEEL_HI),
      P('M9.4 52.6L7.6 45.4L12.8 50.8ZM54.6 52.6L56.4 45.4L51.2 50.8Z', '#8d96a8')],
    under: [],
    head: [P('M29.3 18.4C27.4 12.4 28.8 6.8 32 5.2C35.2 6.8 36.6 12.4 34.7 18.4Z', BLOOD), S('M31 16.6C30.4 12.6 30.8 9.4 32 7.4', '#e0584c', 1),
      P('M19.2 31C18.6 21.2 24.4 16.2 32 16.2C39.6 16.2 45.4 21.2 44.8 31L44.6 41C44 44.6 41.2 47 37.4 47.4L35.4 46.4V36H41.6V27.6H22.4V36H28.6V46.4L26.6 47.4C22.8 47 20 44.6 19.4 41Z', STEEL),
      P('M19.2 31C18.6 21.2 24.4 16.2 32 16.2C33 16.2 34 16.3 35 16.5C28.6 17.4 24 22 24 28.4L22.4 27.6V36L24 37.6V46.2C21.4 45.2 19.8 43.4 19.4 41Z', STEEL_HI, 0.55),
      S('M21.6 27.2H42.4', '#8d96a8', 1.5), S('M32 16.6V27', '#262b37', 1.2), C(23.6, 39.6, 0.8, '#8d96a8'), C(40.4, 39.6, 0.8, '#8d96a8'), C(23.6, 43.4, 0.8, '#8d96a8'), C(40.4, 43.4, 0.8, '#8d96a8')],
    prop: [S('M52.6 62L52.6 22', '#4a3319', 2.4), P('M52.6 12L55.2 22.6H50Z', '#c3cad8'), P('M53.8 24C58.6 22.6 61.4 26 61.6 31.4C58.6 30 56 30.4 53.8 32.4Z', '#8d96a8'),
      P('M51.4 24.6L45.6 27.4L51.4 30.2Z', '#5d6577'), S('M54.6 25.6C57.8 25 59.8 27 60.4 29.8', '#e8edf3', 1)],
    face: { eyes: 'open', mouth: 'none', glow: '#ff3b30' },
  },
  // the herald: a stout crier in a feathered tricorn, a waxed moustache, a drinker's nose and a great deal to announce
  herald: {
    bg: ['#f65e55', '#b8292b'], skin: '#f0c8a8', jaw: jawPath(10.8, 6, 45.6),
    back: [P('M19.4 27.4C18 31.6 18.6 35.4 21 37.6C22.6 36 22.8 33 22 30ZM44.6 27.4C46 31.6 45.4 35.4 43 37.6C41.4 36 41.2 33 42 30Z', '#7a4423')],
    body: [BODY('#27407f', 29), P('M22.6 50.6L27 64H37L41.4 50.6C38 48.6 26 48.6 22.6 50.6Z', '#f4efe2'), P('M27.4 48.6C29 50.6 30.6 51 32 49.6C33.4 51 35 50.6 36.6 48.6L37.6 53.6C35.6 55.2 33.4 55 32 53.4C30.6 55 28.4 55.2 26.4 53.6Z', '#ffffff'),
      S('M28 54.4C29.6 56.4 31 56.6 32 55.4C33 56.6 34.4 56.4 36 54.4', '#d6d0c0', 0.9), P('M27.4 55.2C29 57.2 30.8 57.4 32 56C33.2 57.4 35 57.2 36.6 55.2L36 59.6C34.4 61 33 60.8 32 59.6C31 60.8 29.6 61 28 59.6Z', '#ffffff'),
      S('M21.4 51.4L19.4 64M42.6 51.4L44.6 64', '#f2c14e', 1.5)],
    head: [P('M20.8 31C20.4 26.4 21.8 24.2 24 23.6L40 23.6C42.2 24.2 43.6 26.4 43.2 31C41.4 28 38.4 26.8 32 26.8C25.6 26.8 22.6 28 20.8 31Z', '#7a4423'),
      P('M9.2 25.8C12.8 22 17 15.8 24 14.4C28 13.6 30 15 32 15C34 15 36 13.6 40 14.4C47 15.8 51.2 22 54.8 25.8C47 24.8 40 26.6 32 26.6C24 26.6 17 24.8 9.2 25.8Z', '#1d2240'),
      S('M9.8 25.6C17 24.8 24 26.4 32 26.4C40 26.4 47 24.8 54.2 25.6', '#f2c14e', 1.7), C(32, 21.4, 2.3, '#c23a2a'), C(32, 21.4, 0.9, '#f2c14e'),
      P('M38 16C40 9 47 4.6 55 5.6C51 7.6 47 10.6 44.6 14C43 16 40.6 17.4 38 16Z', '#f7ecd2'), S('M39 15.4C43 10.4 48 7.2 54 6', '#d6b25c', 0.9)],
    over: [C(32, 35.6, 2.1, '#e08a72'), S('M32 38C30.2 37 27.8 37.2 26.2 38.8C25.4 39.8 24.2 39.7 23.4 38.4M32 38C33.8 37 36.2 37.2 37.8 38.8C38.6 39.8 39.8 39.7 40.6 38.4', '#6a3516', 1.9),
      P('M30.4 43H33.6L32 47.6Z', '#6a3516'), S('M25.4 44.4C28.6 46.6 35.4 46.6 38.6 44.4', '#d3a685', 0.9, 0.7)],
    prop: [P('M5.6 34.4L14 40L14 43.2L5.6 48.6Z', '#f2c14e'), E(5.6, 41.5, 1.8, 7, '#d9a52e'), S('M14 41.6L21.4 43.6', '#f2c14e', 2.4),
      P('M10.6 43.2L19 45.4L18.4 52.4L14.6 50.4L10.8 51.6Z', '#c23a2a'), C(22.4, 44, 2.5, '#f0c8a8')],
    face: { eyes: 'open', mouth: 'grin', brows: 'arched', brow: '#6a3516', nose: 'sharp' },
  },
};

/** A face in a look: the eyes apart (they blink), then the brows, the nose and the mouth. A grown face: small eyes
 *  under real brows, a nose, no round cheeks. */
export function features(f: Features, eyes: EyeLook, mouth: MouthLook): { eyes: Shape[]; rest: Shape[] } {
  const ex = [27.3, 36.7] as const, y = 31.9;
  if (f.glow) {
    const dim = shade(f.glow, 0.5), core = shade(f.glow, -0.55);
    const d = eyes === 'closed' ? 'M25.4 32.4H29.6M34.4 32.4H38.6'
      : eyes === 'happy' ? 'M25.2 33Q27.4 30.6 29.6 33M34.4 33Q36.6 30.6 38.8 33'
        : eyes === 'sad' ? 'M25 33.2L29.6 31.6M39 33.2L34.4 31.6'
          : eyes === 'up' ? 'M25.4 31H29.6M34.4 31H38.6'
            : 'M24.8 30.9L29.8 32.9M39.2 30.9L34.2 32.9';
    if (eyes === 'none') return { eyes: [], rest: [] };
    return { eyes: eyes === 'closed' ? [S(d, dim, 1.3)] : [S(d, f.glow, 3.4, 0.28), S(d, f.glow, 1.9), S(d, core, 0.7)], rest: [] };
  }
  const lid = shade(f.skin, 0.4), brow = f.brow ?? INK, lip = f.lip ?? INK, own: Shape[] = [], rest: Shape[] = [];
  const dot = (dx: number, dy: number) => ex.flatMap(x => [E(x + dx, y + dy, 1.5, 1.75, INK), C(x + dx + 0.5, y + dy - 0.6, 0.5, WHITE)]);
  if (eyes === 'open') own.push(...dot(0, 0), ...(f.lids ? ex.map(x => S(`M${x - 2.1} ${y - 1.25}H${x + 2.1}`, lid, 1.3)) : []));
  else if (eyes === 'up') own.push(...dot(0.7, -0.9));
  else if (eyes === 'sad') own.push(...dot(0, 0.4), ...ex.map(x => S(`M${x - 2.1} ${y - 0.9}H${x + 2.1}`, lid, 1.3)));
  else if (eyes === 'happy') own.push(...ex.map(x => S(`M${x - 2} ${y + 0.6}Q${x} ${y - 1.5} ${x + 2} ${y + 0.6}`, INK, 1.5)));
  else if (eyes === 'closed') own.push(...ex.map(x => S(`M${x - 2} ${y}Q${x} ${y + 1.4} ${x + 2} ${y}`, INK, 1.4)));
  const kind = f.brows ?? 'flat';
  if (eyes !== 'none') rest.push(
    eyes === 'sad' ? S('M24.8 29.5L29.6 27.9M39.2 29.5L34.4 27.9', brow, kind === 'heavy' ? 2.1 : 1.5)
      : eyes === 'up' ? S('M24.8 27.9Q27.3 26.3 29.8 27.7M34.2 27.7Q36.7 26.3 39.2 27.9', brow, kind === 'heavy' ? 2.1 : 1.5)
        : kind === 'stern' ? S('M24.6 27.9L30 29.6M39.4 27.9L34 29.6', brow, 1.6)
          : kind === 'heavy' ? S('M24.3 27.9L30.3 29.9M39.7 27.9L33.7 29.9', brow, 2.4)
            : kind === 'arched' ? S('M24.8 28.9Q27.2 27.5 29.8 28.7M34.2 27.9Q36.8 26 39.4 27.9', brow, 1.5)
              : S('M24.8 28.7H29.8M34.2 28.7H39.2', brow, 1.5));
  const nose = shade(f.skin, 0.32);
  rest.push(f.nose === 'broad' ? S('M29.9 35.5Q30.3 37.1 32 36.7Q33.7 37.1 34.1 35.5', nose, 1.3) : S('M32.5 32L31 36Q31.9 36.9 33.2 36.3', nose, 1.1));
  if (mouth === 'smirk') rest.push(S('M29.2 39.8Q32.4 41 35.2 39', lip, 1.4));
  else if (mouth === 'grin') rest.push(P('M28.6 38.8Q32 39.6 35.6 38.4Q35 41.8 32 41.8Q29.2 41.8 28.6 38.8Z', '#4a1820'), P('M29.4 39.2Q32 39.9 34.8 39L34.6 40Q32 40.6 29.6 40.1Z', WHITE));
  else if (mouth === 'flat') rest.push(S('M29.6 40H34.6', lip, 1.4));
  else if (mouth === 'frown') rest.push(S('M29.4 40.8Q32 38.8 34.8 40.6', lip, 1.4));
  else if (mouth === 'o') rest.push(E(32, 40.2, 1.4, 1.6, '#4a1820'));
  return { eyes: own, rest };
}

/** The face from a character's expression (small: the eyes only). */
export function faceShapes(ch: Character, small: boolean): Shape[] {
  const { eyes = 'open', mouth = 'smirk', ...f } = ch.face, drawn = features({ skin: ch.skin, ...f }, eyes, small ? 'none' : mouth);
  return small ? drawn.eyes : [...drawn.eyes, ...drawn.rest];
}

/** Every shape of a character, back to front, over its badge: the one list AgentAvatar and the sheets draw. */
export function characterShapes(id: CharacterId, small: boolean): Shape[] {
  const ch = CHARACTERS[id], ear = shade(ch.skin, 0.14);
  return [
    ...(ch.back ?? []),
    P('M26.6 39L37.4 39L37.4 49C34 51 30 51 26.6 49Z', ear),
    ...ch.body,
    ...(ch.face.glow ? [] : [C(20.4, 33, 2.6, ear), C(43.6, 33, 2.6, ear)]),
    P(ch.jaw ?? JAW, ch.skin),
    ...(ch.under ?? []),
    ...faceShapes(ch, small),
    ...(small ? [] : (ch.over ?? [])),
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
