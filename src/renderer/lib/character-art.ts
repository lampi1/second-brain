// The cartoon characters the roles are drawn as (shared/characters.ts): a round badge in the role's own colour with a
// friendly face, the headwear that makes the silhouette (the conductor's swept hair, the scout's wide hat, the judge's
// curled wig…) and one prop. Trusted code, never user or model content: AgentAvatar renders these shapes, and
// scripts/agent-avatar-sheets.mjs draws the approval sheets from the same data. The badge colour and the headwear carry
// the identity at 16 px; the face and the prop show from 28 px. Coordinates in a 64 × 64 box.
import type { CharacterId } from '../../shared/characters';

/** One shape: a filled path, a stroked path, a circle or an ellipse. Colours are hex values or a palette key. */
export type Shape =
  | { p: string; f: string }
  | { s: string; c: string; w: number }
  | { c: [number, number, number]; f: string }
  | { e: [number, number, number, number]; f: string };
export interface Character {
  /** badge background (top-left, bottom-right) */
  bg: [string, string];
  skin: string;
  /** clothes behind the head */
  body: Shape[];
  /** hair and headwear, drawn over the head */
  head: Shape[];
  /** the prop, drawn last; hidden below 24 px */
  prop: Shape[];
  /** glasses and other face details */
  face?: Shape[];
}

const INK = '#2a2230';
const BODY = (fill: string): Shape => ({ p: 'M8 66C9 52 20 47 32 47S55 52 56 66Z', f: fill });

export const CHARACTERS: Record<CharacterId, Character> = {
  orchestrator: {
    bg: ['#8b6cff', '#5a3ad6'], skin: '#f1c7a3',
    body: [BODY('#24233a'), { p: 'M27 47h10l-5 9Z', f: '#ffffff' }, { p: 'M28 49l4 2-4 2Zm8 0-4 2 4 2Z', f: '#e0454b' }],
    head: [{ p: 'M18 36C16 22 25 15 34 16 44 17 50 25 46 35 44 29 39 25 33 25 26 25 21 29 18 36Z', f: '#dde2ec' },
      { p: 'M30 17C38 12 49 15 51 25 46 20 39 19 34 21Z', f: '#c4cbd9' }],
    prop: [{ s: 'M47 33 58 14', c: '#ffffff', w: 2.4 }, { c: [58, 14, 2], f: '#ffd166' }],
  },
  strategist: {
    bg: ['#22c3a6', '#0c8a75'], skin: '#c88b62',
    body: [BODY('#21466c'), { p: 'M26 47h12l-6 6Z', f: '#e8f1f8' }],
    head: [{ p: 'M19 33C18 22 24 17 32 17S46 22 45 33C42 27 37 24 32 24S22 27 19 33Z', f: '#1f1d24' }],
    face: [{ s: 'M23.8 35.5a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0Zm9.2 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0ZM31 35.2h2', c: INK, w: 1.3 }],
    prop: [{ p: 'M50 58h9l-1-4h-1l-1-5 2-3-2-4-4-1-3 3 1 2 3-1-2 4 1 5h-1Z', f: '#ffffff' }],
  },
  scout: {
    bg: ['#5cc461', '#2f8a3b'], skin: '#f3cfae',
    body: [BODY('#c9a464'), { p: 'M24 49l8 6 8-6', f: '#a8843f' }],
    head: [{ e: [32, 25, 21, 4.8], f: '#7d4f22' }, { p: 'M21 25C21 15 26 10 32 10S43 15 43 25Z', f: '#a4692f' }, { p: 'M21.5 21h21v3.5h-21Z', f: '#4e3014' }],
    prop: [{ s: 'M50.5 50.5a5 5 0 1 0 .1 0Z', c: '#ffffff', w: 2.4 }, { s: 'M47 55l-4 5', c: '#ffffff', w: 3 }],
  },
  artisan: {
    bg: ['#ffa53d', '#e06d10'], skin: '#8d5a3b',
    body: [BODY('#355a8f'), { p: 'M22 50h20v16H22Z', f: '#6b4526' }, { p: 'M25 50h3v-3h-3Zm11 0h3v-3h-3Z', f: '#6b4526' }],
    head: [{ p: 'M18.5 33C18 21 24 16 32 16S46 21 45.5 33C41 28 37 27 32 27S23 28 18.5 33Z', f: '#d83a3a' },
      { p: 'M45 27l7-4-1 7Zm0 1 6 5-7-1Z', f: '#b72b2b' }, { c: [26, 22, 1.4], f: '#ffffff' }, { c: [33, 19.5, 1.4], f: '#ffffff' }, { c: [39, 23, 1.4], f: '#ffffff' }],
    prop: [{ s: 'M46 60l9-9', c: '#d7dde6', w: 3.2 }, { p: 'M53 47a4 4 0 0 1 6 5l-2-2-2 1-1 2 2 2a4 4 0 0 1-5-6Z', f: '#d7dde6' }],
  },
  sentinel: {
    bg: ['#5b8fd8', '#2b5aa0'], skin: '#e8b48f',
    body: [BODY('#3a4658'), { p: 'M16 54h32v4H16Z', f: '#c9a43a' }],
    head: [{ p: 'M17 35C17 20 24 13 32 13S47 20 47 35L45 31H19Z', f: '#aab6c6' }, { p: 'M31 8h2l1 6h-4Z', f: '#e04a4a' },
      { p: 'M19.5 26h25v5.5h-25Z', f: '#26303d' }, { p: 'M22 27.5h20v1.5H22Z', f: '#7fb2ff' }],
    prop: [{ p: 'M47 45h12v6c0 6-6 10-6 10s-6-4-6-10Z', f: '#f2cf4a' }, { s: 'M53 47v11', c: '#a8861d', w: 1.6 }],
  },
  herald: {
    bg: ['#f0605a', '#c0302d'], skin: '#f5d3b3',
    body: [BODY('#2a2244'), { c: [32, 53, 1.5], f: '#f2c94c' }, { c: [32, 59, 1.5], f: '#f2c94c' }],
    head: [{ p: 'M12 28C20 13 44 13 52 28 44 23 20 23 12 28Z', f: '#2a2244' }, { p: 'M20 22C26 17 38 17 44 22L42 25H22Z', f: '#3b3160' },
      { p: 'M40 17C46 8 55 9 57 12 50 12 46 15 42 20Z', f: '#ffd166' }],
    prop: [{ p: 'M4 44l11-5v13l-11-5Z', f: '#f2c94c' }, { e: [16, 45.5, 2, 6.5], f: '#d9a92e' }],
  },
  router: {
    bg: ['#ffd23f', '#e5a400'], skin: '#a86b48',
    body: [BODY('#2c6e63')],
    head: [{ p: 'M18 34C16 21 24 15 32 15S48 21 46 34C45 27 40 22 32 22S19 27 18 34Z', f: '#2a1c16' },
      { c: [19.5, 26, 3.4], f: '#2a1c16' }, { c: [44.5, 26, 3.4], f: '#2a1c16' },
      { s: 'M17 34C16 18 48 18 47 34', c: '#2b2d33', w: 2.6 }, { e: [17, 36, 3, 4.2], f: '#2b2d33' }, { e: [47, 36, 3, 4.2], f: '#2b2d33' },
      { s: 'M17 39C18 45 23 46 27 45', c: '#2b2d33', w: 1.8 }],
    prop: [{ s: 'M52 47v16', c: '#5a3d1d', w: 2.4 }, { p: 'M45 45h12l4 3.5-4 3.5H45Z', f: '#ffffff' }],
  },
  judge: {
    bg: ['#7076c9', '#3f4392'], skin: '#d9a07a',
    body: [BODY('#17161f'), { p: 'M28 47h8l-1 5 2 4h-10l2-4Z', f: '#f4f4f4' }],
    head: [{ p: 'M18 32C17 19 24 14 32 14S47 19 46 32C43 26 38 23 32 23S21 26 18 32Z', f: '#f2f2f2' },
      { c: [17.5, 33, 4], f: '#f2f2f2' }, { c: [16.5, 40, 4], f: '#f2f2f2' }, { c: [17.5, 47, 4], f: '#e6e6e6' },
      { c: [46.5, 33, 4], f: '#f2f2f2' }, { c: [47.5, 40, 4], f: '#f2f2f2' }, { c: [46.5, 47, 4], f: '#e6e6e6' },
      { s: 'M24 20c3-2 5-2 8 0s5 2 8 0', c: '#cfcfd6', w: 1.4 }],
    prop: [{ p: 'M50 44l7 7-3 3-7-7Z', f: '#8a5a2b' }, { s: 'M51 52l-5 7', c: '#8a5a2b', w: 2.4 }],
  },
  scribe: {
    bg: ['#e05aa8', '#a52a77'], skin: '#f2c9a0',
    body: [BODY('#2d7d7a'), { p: 'M30 47h4v19h-4Z', f: '#24625f' }],
    head: [{ c: [32, 13, 6], f: '#6b3a1e' }, { p: 'M18.5 34C17 22 24 17 32 17S47 22 45.5 34C43 27 38 24 32 24S21 27 18.5 34Z', f: '#7a4423' }],
    face: [{ s: 'M23.8 35.5a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0Zm9.2 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0ZM31 35.2h2', c: '#5b3a1e', w: 1.3 }],
    prop: [{ p: 'M60 38C54 40 49 47 47 58L49 58C51 50 55 45 60 38Z', f: '#ffffff' }, { s: 'M47 58l-1 4', c: '#3a3340', w: 1.4 }],
  },
  pulse: {
    bg: ['#2f78b5', '#174a78'], skin: '#e0a97e',
    body: [BODY('#f2c230'), { s: 'M32 49v17', c: '#c9991b', w: 1.4 }],
    head: [{ p: 'M18 31C18 19 24 14 32 14S46 19 46 31Z', f: '#e0533d' }, { p: 'M17.5 27h29v5h-29Z', f: '#c23f2b' }, { c: [32, 12, 3.6], f: '#ffffff' }],
    prop: [{ c: [52, 50, 7.5], f: '#ffe48a' }, { p: 'M49 46h6v9h-6Z', f: '#3a3340' }, { p: 'M50 47h4v7h-4Z', f: '#ffd23f' }],
  },
};

/** The face every character shares: eyes, smile and cheeks over the head circle (drawn by AgentAvatar). */
export const FACE: Shape[] = [
  { c: [27.5, 36, 1.9], f: INK }, { c: [36.5, 36, 1.9], f: INK },
  { s: 'M28 41.5Q32 45 36 41.5', c: INK, w: 1.7 },
  { e: [24.5, 40.5, 2.2, 1.3], f: '#ff8a8a' }, { e: [39.5, 40.5, 2.2, 1.3], f: '#ff8a8a' },
];
export const HEAD = { cx: 32, cy: 35, r: 13 } as const;
/** Below this size the prop and the cheeks are left out: the badge colour and the headwear carry the identity. */
export const PROP_MIN = 24;
/** The accent colour of a catalog entry's page and card: its character's badge colour. */
export const characterTone = (id: CharacterId): string => CHARACTERS[id].bg[0];
