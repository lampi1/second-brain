// One level of a project map as boxes and arrows (ADR 0271), and the level drawn as a line (issue #443, ADR 0322;
// vertical since ADR 0335, the owner 2026-11-22: «non deve mai andare a capo»): the shapes levelOf returns (LevelNode,
// LevelEdge, LevelGroup, Level), the sizes of the drawing (BOX, ROW_MAX) and lineOf, which places phases and steps top
// to bottom in the saved order, the ones that go together side by side inside a framed group (split before, join
// after), and routes every arrow that goes further than the next place along a lane right of the drawing, so none runs
// behind a box. Pure: no Electron, no I/O. Used by project-map.ts (levelOf), which exports these names again for the
// renderer and the tests.
import type { MapActor, MapElement, MapState } from './project-map';

export interface LevelNode { id: string; x: number; y: number; w: number; h: number; ctx: boolean;
  /** in a line (#443): its place in the order, from 1; the boxes that go together share it */
  n?: number; par?: boolean;
  /** in a line of phases (ADR 0335): drawn open, a frame with its steps inside; in = the open piece a step sits in */
  frame?: true; in?: string }
export interface LevelEdge { id: string; from: string; to: string; label: string; status: MapState; stale: boolean; note?: string; actor?: MapActor; count: number;
  /** every link the arrow stands for (ADR 0307: a click on it tells each one in full) */
  ids: string[];
  /** next = an arrow to the following step (#443): every link behind it is one, or the line drew it itself (ids empty) */
  kind?: 'next';
  /** in a line: side = between two boxes of one group next to each other, drawn side to side; route = the corners of
   *  every other arrow, through the gaps between the places and the lane right of the drawing */
  side?: true; route?: [number, number][];
  /** in a line (ADR 0335): an arrow that splits into a group or joins out of it, drawn in the colour of «together» */
  fan?: true }
/** the frame of the boxes that go together in one place of a line (ADR 0335): the split point on its top edge, the
 *  join point on its bottom edge */
export interface LevelGroup { ids: string[]; n: number; x: number; y: number; w: number; h: number; split: [number, number]; join: [number, number];
  /** the open piece it sits in, if any */
  in?: string }
export interface Level { nodes: LevelNode[]; edges: LevelEdge[]; width: number; height: number;
  /** drawn as a line, in the saved order (#443) */
  linear?: boolean;
  /** in a line: the frames of the places with more than one box (ADR 0335) */
  groups?: LevelGroup[] }
export const BOX = { w: 210, h: 128, gx: 60, gy: 84, ctxW: 160, ctxH: 70, pad: 32 } as const;
/** at most this many outside boxes side by side under a line, or in a row of the layered drawing */
export const ROW_MAX = 4;
/** in a line: the gap between two places, one under the other (room for the arrow and the split or join point) */
const VGAP = 64;
/** a group's frame: the gap between its boxes, its side padding, the room on top (its label and the split rail) and
 *  at the bottom (the join rail) */
const COL_GAP = 24, GPAD = 16, GTOP = 40, GBOT = 26;
/** the split and join rails sit this far from the boxes */
const RAIL = 13;
/** an arrow that goes further than the next place runs in a lane this far right of the widest place; it leaves and
 *  enters a box this far right of its middle (TAP), so it never lies on the arrow to the next place */
const LANE = 26, TAP = 30, GAP_Y = 22;

/** the header of a phase drawn open in the line of phases (ADR 0335): its name, its count and its bar */
export const FRAME_HEAD = 50;
/** an open phase is never narrower than this: its head holds the number, the name, the status and the count */
const FRAME_MIN = 340;

/** A level as a line (#443, ADR 0335): its pieces in the saved order, top to bottom, each in its own place; a piece
 *  marked `par` shares the place of the one before it, side by side inside a framed group. It never wraps. Between two
 *  places the line draws the arrow to the following step itself, unless a link already joins those boxes; into a
 *  group it splits from one point on the frame's top edge, out of it it joins on the bottom edge. A piece whose own
 *  steps are given (`open`: its level, drawn the same way) is drawn open, a frame with its steps inside (`frame`).
 *  The outside elements the level talks to (ctx) sit in rows under it. */
export function lineOf(own: readonly MapElement[], ctx: readonly string[], edges: Map<string, LevelEdge>, open: ReadonlyMap<string, Level> = new Map()): Level {
  const places: MapElement[][] = [];
  for (const e of own) { if (e.par && places.length) places[places.length - 1]!.push(e); else places.push([e]); }
  for (let i = 0; i + 1 < places.length; i++) for (const a of places[i]!) for (const b of places[i + 1]!) {
    if (edges.has(`${a.id}>${b.id}`) || edges.has(`${b.id}>${a.id}`)) continue;
    edges.set(`${a.id}>${b.id}`, { id: `seq:${a.id}>${b.id}`, from: a.id, to: b.id, label: '', status: 'ok', stale: false, count: 1, ids: [], kind: 'next' });
  }
  const at = new Map<string, number>();
  places.forEach((p, i) => p.forEach(e => at.set(e.id, i)));
  const sizeOf = (e: MapElement) => { const o = open.get(e.id); return o ? { w: Math.max(FRAME_MIN, o.width), h: FRAME_HEAD + o.height } : { w: BOX.w, h: BOX.h }; };
  const placeW = (p: MapElement[]) => (p.length > 1 ? p.reduce((s, e) => s + sizeOf(e).w, 0) + (p.length - 1) * COL_GAP + 2 * GPAD : sizeOf(p[0]!).w);
  const ctxRows = Array.from({ length: Math.ceil(ctx.length / ROW_MAX) }, (_, r) => ctx.slice(r * ROW_MAX, (r + 1) * ROW_MAX));
  const ctxW = (k: number) => k * BOX.ctxW + (k - 1) * COL_GAP;
  const widest = Math.max(BOX.w, ...places.map(placeW), ...ctxRows.map(r => ctxW(r.length)));
  const axis = BOX.pad + widest / 2;
  const nodes: LevelNode[] = [], groups: LevelGroup[] = [];
  /** each place: the top and bottom of its boxes (where the arrows touch them) and of the whole place */
  const rows: { top: number; bot: number; ptop: number; pbot: number }[] = [];
  let y = BOX.pad;
  places.forEach((p, i) => {
    const n = i + 1;
    if (p.length === 1) {
      const s = sizeOf(p[0]!);
      nodes.push({ id: p[0]!.id, x: axis - s.w / 2, y, w: s.w, h: s.h, ctx: false, n, ...(open.has(p[0]!.id) ? { frame: true } : {}) });
      rows.push({ top: y, bot: y + s.h, ptop: y, pbot: y + s.h });
      y += s.h;
    } else {
      const w = placeW(p), x = axis - w / 2, tall = Math.max(...p.map(e => sizeOf(e).h)), h = GTOP + tall + GBOT;
      let xx = x + GPAD;
      for (const e of p) { const s = sizeOf(e); nodes.push({ id: e.id, x: xx, y: y + GTOP, w: s.w, h: s.h, ctx: false, n, par: true, ...(open.has(e.id) ? { frame: true } : {}) }); xx += s.w + COL_GAP; }
      groups.push({ ids: p.map(e => e.id), n, x, y, w, h, split: [axis, y], join: [axis, y + h] });
      rows.push({ top: y + GTOP, bot: y + GTOP + tall, ptop: y, pbot: y + h });
      y += h;
    }
    if (i < places.length - 1) y += VGAP;
  });
  for (const row of ctxRows) {
    y += BOX.gy;
    const x0 = axis - ctxW(row.length) / 2;
    row.forEach((id, c) => nodes.push({ id, x: x0 + c * (BOX.ctxW + COL_GAP), y, w: BOX.ctxW, h: BOX.ctxH, ctx: true }));
    y += BOX.ctxH;
  }
  const box = new Map(nodes.map(b => [b.id, b]));
  const cx = (b: LevelNode) => b.x + b.w / 2;
  const laneX0 = BOX.pad + widest + LANE;
  let lanes = 0, far = false;
  const stagger = new Map<string, number>();
  const off = (key: string) => { const k = stagger.get(key) ?? 0; stagger.set(key, k + 1); return (k % 4) * 6; };
  for (const e of edges.values()) {
    const a = box.get(e.from), b = box.get(e.to), pa = at.get(e.from), pb = at.get(e.to);
    if (!a || !b || (pa === undefined && pb === undefined)) continue;
    if (pa !== undefined && pa === pb) {
      // two boxes of one group: next to each other the plain arrow; further, under the boxes in the frame's bottom room
      const ia = places[pa]!.findIndex(x => x.id === a.id), ib = places[pa]!.findIndex(x => x.id === b.id);
      if (Math.abs(ia - ib) === 1) { e.side = true; continue; }
      const yy = rows[pa]!.bot + 8 + off(`g${pa}`);
      e.route = [[cx(a) + TAP, a.y + a.h], [cx(a) + TAP, yy], [cx(b) + TAP, yy], [cx(b) + TAP, b.y + b.h]];
      continue;
    }
    if (pa !== undefined && pb === pa + 1) {
      // to the next place: down the axis, through the split and join points of a group
      const ga = places[pa]!.length > 1, gb = places[pb]!.length > 1;
      const r: [number, number][] = [[cx(a), a.y + a.h]];
      if (ga) r.push([cx(a), rows[pa]!.bot + RAIL], [axis, rows[pa]!.bot + RAIL], [axis, rows[pa]!.pbot]);
      if (gb) r.push([axis, rows[pb]!.ptop], [axis, rows[pb]!.top - RAIL], [cx(b), rows[pb]!.top - RAIL]);
      r.push([cx(b), b.y]);
      // drop the corners that do not turn (a straight stretch)
      e.route = r.filter((c, i) => i === 0 || i === r.length - 1 || !((r[i - 1]![0] === c[0] && r[i + 1]![0] === c[0]) || (r[i - 1]![1] === c[1] && r[i + 1]![1] === c[1])));
      if ((ga || gb) && e.kind === 'next') e.fan = true;
      continue;
    }
    // any other arrow: out of a box's bottom (top, going up) a little right of its middle, into the gap beside it,
    // along the lane right of the drawing, and into the other box from the gap on its side
    far = true;
    const down = b.y > a.y;
    const lane = laneX0 + off('lane');
    lanes = Math.max(lanes, lane - laneX0);
    const ya = down ? (pa !== undefined ? rows[pa]!.bot : a.y + a.h) + GAP_Y + off(`a${e.from}`) : (pa !== undefined ? rows[pa]!.top : a.y) - GAP_Y - off(`a${e.from}`);
    const yb = down ? (pb !== undefined ? rows[pb]!.top : b.y) - GAP_Y + 8 - off(`b${e.to}`) : (pb !== undefined ? rows[pb]!.bot : b.y + b.h) + GAP_Y - 8 + off(`b${e.to}`);
    const xa = cx(a) + (pa !== undefined ? TAP : 0), xb = cx(b) + (pb !== undefined ? TAP : 0);
    e.route = [[xa, down ? a.y + a.h : a.y], [xa, ya], [lane, ya], [lane, yb], [xb, yb], [xb, down ? b.y : b.y + b.h]];
  }
  const all = [...edges.values()];
  // the steps of each open piece, inside its frame under the header, with their own arrows and groups
  for (const f of nodes.filter(n => n.frame)) {
    const o = open.get(f.id)!, dx = f.x + (f.w - o.width) / 2, dy = f.y + FRAME_HEAD;
    const mv = ([x, yy]: [number, number]): [number, number] => [x + dx, yy + dy];
    for (const n of o.nodes) nodes.push({ ...n, x: n.x + dx, y: n.y + dy, in: f.id });
    for (const e of o.edges) all.push({ ...e, ...(e.route ? { route: e.route.map(mv) } : {}) });
    for (const g of o.groups ?? []) groups.push({ ...g, x: g.x + dx, y: g.y + dy, split: mv(g.split), join: mv(g.join), in: f.id });
  }
  const width = BOX.pad * 2 + widest + (far ? LANE + lanes + 12 : 0);
  return { nodes, edges: all, width, height: y + BOX.pad, linear: true, ...(groups.length ? { groups } : {}) };
}
