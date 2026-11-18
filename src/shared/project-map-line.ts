// One level of a project map as boxes and arrows (ADR 0271), and the level drawn as a line (issue #443, ADR 0322):
// the shapes levelOf returns (LevelNode, LevelEdge, Level), the sizes of the drawing (BOX, ROW_MAX, LINE_MAX) and
// lineOf, which places phases and steps in the saved order and routes every arrow that goes further than the place
// beside along the free lanes between the boxes, so none runs behind a box. Pure: no Electron, no I/O. Used by
// project-map.ts (levelOf), which exports these names again for the renderer and the tests.
import type { MapActor, MapElement, MapState } from './project-map';

export interface LevelNode { id: string; x: number; y: number; w: number; h: number; ctx: boolean;
  /** in a line (#443): its place in the order, from 1; the boxes that go together share it */
  n?: number; par?: boolean }
export interface LevelEdge { id: string; from: string; to: string; label: string; status: MapState; stale: boolean; note?: string; actor?: MapActor; count: number;
  /** every link the arrow stands for (ADR 0307: a click on it tells each one in full) */
  ids: string[];
  /** next = an arrow to the following step (#443): every link behind it is one, or the line drew it itself (ids empty) */
  kind?: 'next';
  /** in a line: side = between two places next to each other, drawn side to side; route = the corners of an arrow
   *  that goes further (a jump, a way back, the next row, an outside box), along the free lanes between the boxes */
  side?: true; route?: [number, number][] }
export interface Level { nodes: LevelNode[]; edges: LevelEdge[]; width: number; height: number;
  /** drawn as a line, in the saved order (#443) */
  linear?: boolean }

export const BOX = { w: 210, h: 128, gx: 60, gy: 84, ctxW: 160, ctxH: 70, pad: 32 } as const;
/** at most this many boxes side by side: a wider row wraps onto the next line */
export const ROW_MAX = 4;
/** a line longer than this many places goes on in the next row, read like text (#443) */
export const LINE_MAX = 6;
/** the gap between two boxes that go together, one above the other in the same place of the line */
const PAR_GAP = 18;
/** the gap between two places of a line: room for the arrow to the next, wider than between two layered boxes */
const LINE_GAP = 92;
/** an arrow that goes further than the next place runs in the free lanes: this far from a box's side (LANE), leaving
 *  and entering a box this far above or below its middle (TAP), where the arrow to the next place is not */
const LANE = 20, TAP = 28;

/** A level as a line (#443): its pieces in the saved order, left to right, each in its own place; a piece marked `par`
 *  shares the place of the one before it (one above the other: the only split). A line longer than LINE_MAX places
 *  goes on in the next row. Between two places the line draws the arrow to the following step itself, unless a link
 *  already joins those boxes. The outside elements the level talks to (ctx) sit in a row under it. */
export function lineOf(own: readonly MapElement[], ctx: readonly string[], edges: Map<string, LevelEdge>): Level {
  const places: MapElement[][] = [];
  for (const e of own) { if (e.par && places.length) places[places.length - 1]!.push(e); else places.push([e]); }
  for (let i = 0; i + 1 < places.length; i++) for (const a of places[i]!) for (const b of places[i + 1]!) {
    if (edges.has(`${a.id}>${b.id}`) || edges.has(`${b.id}>${a.id}`)) continue;
    edges.set(`${a.id}>${b.id}`, { id: `seq:${a.id}>${b.id}`, from: a.id, to: b.id, label: '', status: 'ok', stale: false, count: 1, ids: [], kind: 'next' });
  }
  // where each piece sits: its place in the line (i) and its row (r)
  const at = new Map<string, { i: number; r: number }>();
  places.forEach((p, i) => p.forEach(e => at.set(e.id, { i, r: Math.floor(i / LINE_MAX) })));
  const rows = Array.from({ length: Math.ceil(places.length / LINE_MAX) }, (_, r) => places.slice(r * LINE_MAX, (r + 1) * LINE_MAX));
  // an arrow over the first row or under the last one needs its lane inside the drawing
  const far = [...edges.values()].flatMap(e => { const a = at.get(e.from), b = at.get(e.to); return a && b && a.r === b.r && Math.abs(a.i - b.i) > 1 ? [{ r: a.r, over: b.i > a.i }] : []; });
  const widest = Math.max(1, ...rows.map(r => r.length), Math.min(ctx.length, ROW_MAX));
  const width = BOX.pad * 2 + widest * BOX.w + (widest - 1) * LINE_GAP;
  const nodes: LevelNode[] = [];
  const tops: number[] = [], bottoms: number[] = [];
  let y = BOX.pad + (far.some(f => f.over && f.r === 0) ? LANE + TAP : 0), n = 0;
  rows.forEach((row, r) => {
    const tall = Math.max(...row.map(p => p.length));
    row.forEach((p, c) => {
      n++;
      p.forEach((e, k) => nodes.push({ id: e.id, x: BOX.pad + c * (BOX.w + LINE_GAP), y: y + k * (BOX.h + PAR_GAP), w: BOX.w, h: BOX.h, ctx: false, n, ...(p.length > 1 ? { par: true } : {}) }));
    });
    tops[r] = y;
    bottoms[r] = y += tall * BOX.h + (tall - 1) * PAR_GAP;
    if (r < rows.length - 1) y += BOX.gy;
  });
  if (!ctx.length && far.some(f => !f.over && f.r === rows.length - 1)) y += LANE + TAP;
  for (let i = 0; i < ctx.length; i += ROW_MAX) {
    const row = ctx.slice(i, i + ROW_MAX);
    y += BOX.gy;
    // on the line's own columns, so the lanes between the columns stay free down through these rows too
    row.forEach((id, c) => nodes.push({ id, x: BOX.pad + c * (BOX.w + LINE_GAP) + Math.round((BOX.w - BOX.ctxW) / 2), y: y + Math.round((BOX.h - BOX.ctxH) / 2), w: BOX.ctxW, h: BOX.ctxH, ctx: true }));
    y += BOX.h;
  }
  // every arrow that is not to the place beside: out of a box by its right side, along the lanes, into the other by
  // its left side (an outside box by its top), so it never runs behind a box
  const box = new Map(nodes.map(b => [b.id, b]));
  const lanes = new Map<string, number>();
  const stagger = (key: string) => { const k = lanes.get(key) ?? 0; lanes.set(key, k + 1); return (k % 4) * 7; };
  for (const e of edges.values()) {
    const a = box.get(e.from), b = box.get(e.to), pa = at.get(e.from), pb = at.get(e.to);
    if (!a || !b || (!pa && !pb)) continue;
    if (pa && pb && pa.i === pb.i) {
      // two of the pieces that go together: next to each other the plain arrow; with one between them, round its side
      if (Math.abs(a.y - b.y) > BOX.h + PAR_GAP) e.route = [[a.x + a.w, a.y + a.h / 2], [a.x + a.w + LANE, a.y + a.h / 2], [b.x + b.w + LANE, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]];
      continue;
    }
    if (pa && pb && pa.r === pb.r && Math.abs(pa.i - pb.i) === 1) { e.side = true; continue; }
    // the lane it runs along (its height), and whether it leaves a and enters b above (-1) or below (+1) the middle
    let lane: number, ua: number, ub: number;
    if (pa && pb && pa.r === pb.r) { const over = pb.i > pa.i; ua = ub = over ? -1 : 1; lane = over ? tops[pa.r]! - LANE - stagger(`o${pa.r}`) : bottoms[pa.r]! + LANE + stagger(`u${pa.r}`); }
    else if (pa && pb) { const down = pb.r > pa.r; ua = down ? 1 : -1; ub = -ua; lane = down ? bottoms[pa.r]! + BOX.gy / 2 : tops[pa.r]! - BOX.gy / 2; }
    else { ua = ub = 1; lane = (pa ? b : a).y - LANE - 4; }
    const out: [number, number][] = pa
      ? [[a.x + a.w, a.y + a.h / 2 + ua * TAP], [a.x + a.w + LANE, a.y + a.h / 2 + ua * TAP], [a.x + a.w + LANE, lane]]
      : [[a.x + a.w / 2, a.y], [a.x + a.w / 2, lane]];
    const into: [number, number][] = pb
      ? [[b.x - LANE, lane], [b.x - LANE, b.y + b.h / 2 + ub * TAP], [b.x, b.y + b.h / 2 + ub * TAP]]
      : [[b.x + b.w / 2, lane], [b.x + b.w / 2, b.y]];
    e.route = [...out, ...into];
  }
  return { nodes, edges: [...edges.values()], width, height: y + BOX.pad, linear: true };
}
