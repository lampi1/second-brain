// The rig of the little people the roles are animated as (ADR 0294; the owner, 2026-11-13: «veri e propri omini che
// fanno cose … delle sprite»): a 20 × 16 pixel canvas, one chibi body (a big head, a small body, two arms, two legs)
// drawn from a look (skin, hat or hair, clothes) and a pose (arms, legs, eyes, a hop, a squat), and the small things
// every role shares (a speech bubble, a thought, a note, a spark). Trusted code, never user or model content, like
// lib/character-art.ts. Pure data: lib/agent-sprites.ts builds each role's frames with it, AgentSprite.tsx draws them,
// test/unit/agent-sprites.test.ts checks them.

export const SPRITE_W = 20, SPRITE_H = 16;
/** Where the body stands: the head spans OX … OX+7, the room on its right is for the tool. */
export const OX = 5, HY = 2, BY = 9;
export const INK = '#2a2230', AMBER = '#f0b44c', GREEN = '#3fbf7f', RED = '#e5484d', GOLD = '#f2c14e', SKY = '#7dd3fc', ACCENT = '#8f9cff';

/** One frame: the colour of each pixel, row by row ('' = nothing). */
export type Frame = readonly (readonly string[])[];

export class Canvas {
  private cells: string[][] = Array.from({ length: SPRITE_H }, () => Array.from({ length: SPRITE_W }, () => ''));
  set(x: number, y: number, c: string): this { if (x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE_H) this.cells[y]![x] = c; return this; }
  rect(x: number, y: number, w: number, h: number, c: string): this { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
  /** Several pixels of one colour: [x, y] pairs. */
  dots(c: string, ...at: [number, number][]): this { for (const [x, y] of at) this.set(x, y, c); return this; }
  frame(): Frame { return this.cells; }
}

export type Arm = 'down' | 'out' | 'fwd' | 'up' | 'high' | 'chin' | 'back';
export type Eyes = 'open' | 'blink' | 'happy' | 'sad' | 'up' | 'left' | 'right' | 'none';
export type Legs = 'stand' | 'a' | 'b';
export interface Pose {
  /** the whole body moved: a hop (dy -1) or a step aside (dx ±1) */
  dx?: number; dy?: number;
  /** a squat: head and body one pixel down, the legs folded */
  bob?: boolean;
  eyes?: Eyes; mouth?: boolean;
  armL?: Arm; armR?: Arm; legs?: Legs;
  /** the colour of the ground line under the feet (the state's) */
  ground?: string;
}
export interface Look {
  skin: string;
  /** hair or headwear, drawn over the head; x, y = the head's top-left corner */
  head(cv: Canvas, x: number, y: number): void;
  top: string; sleeve?: string;
  /** details on the clothes; x, y = the body's top-left corner (6 × 4) */
  wear?(cv: Canvas, x: number, y: number): void;
  legs?: string; shoes?: string;
  /** glasses: two light lenses behind the eyes and a bridge */
  glasses?: boolean;
}

// an arm from the shoulder: sleeve pixels, the last one the hand; mirrored for the left arm
const ARMS: Record<Arm, [number, number][]> = {
  down: [[0, 0], [0, 1], [0, 2]],
  out: [[0, 1], [1, 1], [2, 1]],
  fwd: [[0, 0], [1, 1], [2, 1]],
  up: [[0, 0], [1, -1], [1, -2]],
  high: [[0, 0], [1, -1], [2, -2], [2, -3]],
  chin: [[0, 1], [0, 0], [-1, -1]],
  back: [[0, 0], [1, 1], [1, 2]],
};

/** Draw the body; returns where the hands are, so a tool can be put in them. */
export function person(cv: Canvas, look: Look, pose: Pose = {}): { l: [number, number]; r: [number, number] } {
  const dx = pose.dx ?? 0, dy = pose.dy ?? 0, sq = pose.bob ? 1 : 0;
  const x = OX + dx, hy = HY + dy + sq, by = BY + dy + sq;
  const legs = look.legs ?? '#4a5068', shoes = look.shoes ?? '#7a5236';
  // the ground line: shorter while in the air
  if (pose.ground) cv.rect(dy < 0 ? OX + 2 : OX + 1, 15, dy < 0 ? 4 : 6, 1, pose.ground);
  // legs: two pixels tall, one lifted while walking, folded in a squat
  const foot = 14 + dy;
  for (const [lx, lifted] of [[x + 1, pose.legs === 'a'], [x + 5, pose.legs === 'b']] as const) {
    if (sq) { cv.rect(lx, foot, 2, 1, shoes); continue; }
    if (lifted) { cv.rect(lx, foot - 1, 2, 1, shoes); continue; }
    cv.rect(lx, foot - 1, 2, 1, legs).rect(lx, foot, 2, 1, shoes);
  }
  // body
  cv.rect(x + 1, by, 6, 4, look.top);
  look.wear?.(cv, x + 1, by);
  // head: 8 × 7 with the corners cut
  cv.rect(x, hy, 8, 7, look.skin);
  for (const [cx, cy] of [[0, 0], [7, 0], [0, 6], [7, 6]] as const) cv.set(x + cx, hy + cy, '');
  // the body shows through the cut bottom corners only where the arms are, so nothing to repair there
  const e1 = x + 2, e2 = x + 5, ey = hy + 3;
  if (look.glasses) cv.rect(x + 1, ey, 2, 2, '#c4dafa').rect(x + 5, ey, 2, 2, '#c4dafa').rect(x + 3, ey, 2, 1, INK).dots(INK, [x, ey], [x + 7, ey]);
  switch (pose.eyes ?? 'open') {
    case 'open': cv.rect(e1, ey, 1, 2, INK).rect(e2, ey, 1, 2, INK); break;
    case 'blink': cv.dots(INK, [e1, ey + 1], [e2, ey + 1]); break;
    case 'happy': cv.dots(INK, [e1 - 1, ey + 1], [e1, ey], [e1 + 1, ey + 1], [e2 - 1, ey + 1], [e2, ey], [e2 + 1, ey + 1]); break;
    case 'sad': cv.dots(INK, [e1 - 1, ey], [e1, ey + 1], [e2 + 1, ey], [e2, ey + 1]); break;
    case 'up': cv.rect(e1 + 1, ey - 1, 1, 2, INK).rect(e2 + 1, ey - 1, 1, 2, INK); break;
    case 'left': cv.rect(e1 - 1, ey, 1, 2, INK).rect(e2 - 1, ey, 1, 2, INK); break;
    case 'right': cv.rect(e1 + 1, ey, 1, 2, INK).rect(e2 + 1, ey, 1, 2, INK); break;
    case 'none': break;
  }
  if (pose.eyes !== 'none') cv.dots('#ff8fa3b0', [x + 1, hy + 5], [x + 6, hy + 5]);
  if (pose.mouth) cv.rect(x + 3, hy + 5, 2, 1, '#7a2b35');
  look.head(cv, x, hy);
  // arms over everything
  const sleeve = look.sleeve ?? look.top;
  const arm = (kind: Arm, sx: number, dir: 1 | -1): [number, number] => {
    const pts = ARMS[kind];
    let hand: [number, number] = [sx, by];
    pts.forEach(([ax, ay], i) => { hand = [sx + ax * dir, by + ay]; cv.set(hand[0], hand[1], i === pts.length - 1 ? look.skin : sleeve); });
    return hand;
  };
  return { l: arm(pose.armL ?? 'down', x, -1), r: arm(pose.armR ?? 'down', x + 7, 1) };
}

/** A speech bubble top right with a mark in it: "!" (waiting, error) or a tick (done). `up` lifts it one pixel. */
export function bubble(cv: Canvas, colour: string, mark: '!' | 'ok', up = false): void {
  const y = up ? 0 : 1;
  cv.rect(14, y, 5, 5, colour).set(14, y + 5, colour).set(13, y + 6, colour);
  if (mark === '!') cv.dots(INK, [16, y + 1], [16, y + 2], [16, y + 4]);
  else cv.dots(INK, [15, y + 2], [16, y + 3], [17, y + 2], [18, y + 1]);
}
/** A quaver: its head at x, y. */
export const note = (cv: Canvas, x: number, y: number, c: string): Canvas => cv.dots(c, [x, y], [x + 1, y - 1], [x + 1, y - 2], [x + 2, y - 2]);
/** A four-point glint. */
export const glint = (cv: Canvas, x: number, y: number, c = '#fff6c9'): Canvas => cv.dots(c, [x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);

/** One frame as SVG path data per colour: every run of pixels of a row is one sub-path. `dx` shifts the frame along the strip. */
export function framePaths(frame: Frame, dx = 0): { fill: string; d: string }[] {
  const by = new Map<string, string[]>();
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x]!;
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      (by.get(c) ?? by.set(c, []).get(c)!).push(`M${x + dx} ${y}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return [...by].map(([fill, parts]) => ({ fill, d: parts.join('') }));
}
