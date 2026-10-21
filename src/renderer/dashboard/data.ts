// Pure dashboard projections: preserve source coverage and unknowns, derive only observed activity.
// Used by Dashboard and its unit tests; no bridge calls or invented telemetry.
import type { ChatItem, ChatSummary, FeedEvent } from '@shared/contract';
import { isLongChat } from '@shared/context';
import type { MapEdge, MapNode } from '../brain/types';

export interface Connection { from: string; to: string; at: number | null }
export function connections(chats: ChatSummary[], items: Readonly<Record<string, readonly ChatItem[]>>): Connection[] {
  const edges = new Map<string, Connection>();
  const add = (from: string, to: string, at: number | null) => {
    if (from === to) return;
    const key = [from, to].sort().join('|');
    const old = edges.get(key);
    edges.set(key, { from, to, at: Math.max(old?.at ?? 0, at ?? 0) || null });
  };
  const resolve = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const exact = chats.find(c => c.id === value);
    if (exact) return exact;
    const titles = chats.filter(c => c.title === value);
    return titles.length === 1 ? titles[0] : undefined;
  };
  const owner = chats.find(c => c.isOrchestrator && !c.closedAt)?.id;
  for (const c of chats) {
    if (owner && c.id !== owner) add(owner, c.id, null);
    for (const item of items[c.id] ?? []) {
      if (item.kind === 'user' && item.from) {
        const sender = resolve(item.from);
        if (sender) add(sender.id, c.id, item.at);
      }
      if (item.kind !== 'tool' || item.status !== 'ok' || !/(?:^|__)\w*send_to_chat$/.test(item.name)) continue;
      const input = item.input && typeof item.input === 'object' ? item.input as Record<string, unknown> : {};
      const target = resolve(input.chatId ?? input.to);
      if (target) add(c.id, target.id, item.at);
    }
  }
  return [...edges.values()];
}

export interface ObservedError { id: string; at: number; title: string; detail: string; source: string;
  /** the chat it happened in, its role (agent) and the skills its run started with, when known */
  chat?: string; role?: string; skills?: string[];
  /** a tool call that failed / a turn that ended with an error (the Errori view's cause when the text says nothing) */
  tool?: boolean; turn?: boolean }
/** One calm summary, with unique diagnostics retained behind the details control. */
export function brainChecks(map: { warnings: string[]; problems: string[] } | null | undefined): string[] {
  return [...new Set([...(map?.warnings ?? []), ...(map?.problems ?? [])].filter(line => line.trim()))];
}
export function observedErrors(chats: ChatSummary[], items: Readonly<Record<string, readonly ChatItem[]>>, feed: readonly FeedEvent[], turnError = 'Turn ended with an error'): ObservedError[] {
  const where = (c: ChatSummary | undefined) => (c ? { chat: chatName(c), ...(c.agent?.name ? { role: c.agent.name } : {}), ...(c.run?.tags?.skills.length ? { skills: [...c.run.tags.skills] } : {}) } : {});
  const rows: ObservedError[] = feed.filter(e => e.kind === 'error').map(e => ({ id: `feed:${e.id}`, at: e.at, title: e.title, detail: e.detail, source: 'feed', ...where(chats.find(c => c.id === e.chatId)) }));
  for (const c of chats) for (const item of items[c.id] ?? []) {
    const tool = item.kind === 'tool' && item.status === 'error', turn = item.kind === 'result' && item.isError && !item.interrupted;
    const detail = item.kind === 'system' && item.level === 'error' ? item.text
      : item.kind === 'tool' && item.status === 'error' ? `${item.name}: ${item.summary}`
        : turn ? turnError : null;
    if (detail) rows.push({ id: `${c.id}:${item.id}`, at: item.at, title: chatName(c), detail, source: c.harness, ...where(c), ...(tool ? { tool: true } : {}), ...(turn ? { turn: true } : {}) });
  }
  return rows.sort((a, b) => b.at - a.at);
}

export interface Point { x: number; y: number }
/** Stable force layout (Fruchterman-Reingold with cooling) in unit-free space, centred on 0,0: the ideal distance
 *  between two nodes is 1 whatever the node count, so the map spreads with its size instead of clumping in a fixed
 *  800x520 box; a gentle gravity keeps disconnected notes near the rest. Deterministic (golden-angle start, no
 *  randomness) and keyed only on the topology, so live telemetry never moves a node. fitLayout maps it onto the panel. */
export function layout(nodes: Pick<MapNode, 'id'>[], edges: Pick<MapEdge, 'from' | 'to'>[], center?: string): Map<string, Point> {
  const n = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n), ys = new Float64Array(n), fx = new Float64Array(n), fy = new Float64Array(n);
  for (let i = 0; i < n; i++) { const angle = i * 2.399963, r = Math.sqrt(i + .5) * .9; xs[i] = Math.cos(angle) * r; ys[i] = Math.sin(angle) * r; }
  const pinned = center === undefined ? undefined : index.get(center);
  if (pinned !== undefined) { xs[pinned] = 0; ys[pinned] = 0; }
  const links: [number, number][] = [];
  for (const e of edges) { const a = index.get(e.from), b = index.get(e.to); if (a !== undefined && b !== undefined && a !== b) links.push([a, b]); }
  const steps = n > 160 ? 140 : 300, gravity = 1;
  let heat = Math.max(1, Math.sqrt(n) * .3);
  for (let step = 0; step < steps; step++) {
    fx.fill(0); fy.fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = xs[i]! - xs[j]!, dy = ys[i]! - ys[j]!, d2 = Math.max(.0025, dx * dx + dy * dy), f = 1 / d2;
      fx[i]! += dx * f; fy[i]! += dy * f; fx[j]! -= dx * f; fy[j]! -= dy * f;
    }
    for (const [a, b] of links) {
      const dx = xs[b]! - xs[a]!, dy = ys[b]! - ys[a]!, d = Math.hypot(dx, dy);
      fx[a]! += dx * d; fy[a]! += dy * d; fx[b]! -= dx * d; fy[b]! -= dy * d;
    }
    for (let i = 0; i < n; i++) {
      fx[i]! -= xs[i]! * gravity * Math.hypot(xs[i]!, ys[i]!); fy[i]! -= ys[i]! * gravity * Math.hypot(xs[i]!, ys[i]!);
      if (i === pinned) continue;
      const f = Math.hypot(fx[i]!, fy[i]!) || 1, move = Math.min(f, heat);
      xs[i]! += fx[i]! / f * move; ys[i]! += fy[i]! / f * move;
    }
    heat = Math.max(.02, heat * .985);
  }
  const points = new Map<string, Point>();
  nodes.forEach((node, i) => points.set(node.id, { x: xs[i]!, y: ys[i]! }));
  return points;
}

/** Maps a layout onto a width x height panel (SVG units = CSS pixels): the nodes' bounding box fills the panel inside
 *  `pad`, centred, each axis scaled on its own (the panel's aspect wins over the layout's, up to 3.5x of stretch, so a
 *  wide panel is filled without turning a ring into a line). Then pushes apart dots closer than `gap`, so no two
 *  halos overlap however crowded a hub is. */
export function fitLayout(points: Map<string, Point>, width: number, height: number, pad: { x: number; y: number }, gap = 0): Map<string, Point> {
  const all = [...points.values()];
  const out = new Map<string, Point>();
  if (!all.length) return out;
  const x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x)), y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  const w = Math.max(1, width - 2 * pad.x), h = Math.max(1, height - 2 * pad.y);
  const spanX = x1 - x0, spanY = y1 - y0;
  let sx = spanX > 1e-6 ? w / spanX : Infinity, sy = spanY > 1e-6 ? h / spanY : Infinity;
  if (!Number.isFinite(sx) && !Number.isFinite(sy)) sx = sy = 0;
  else if (!Number.isFinite(sx)) sx = 0; else if (!Number.isFinite(sy)) sy = 0;
  else { const MAX = 3.5; if (sx > sy * MAX) sx = sy * MAX; if (sy > sx * MAX) sy = sx * MAX; }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (const [id, p] of points) out.set(id, { x: width / 2 + (p.x - mx) * sx, y: height / 2 + (p.y - my) * sy });
  if (gap > 0) {
    const list = [...out.values()];
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const push = (gap - d) / 2 + .01;
        a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
        moved = true;
      }
      for (const p of list) { p.x = Math.max(pad.x / 2, Math.min(width - pad.x / 2, p.x)); p.y = Math.max(pad.y / 2, Math.min(height - pad.y / 2, p.y)); }
      if (!moved) break;
    }
  }
  return out;
}

export interface LabelSpot { x: number; y: number; w: number; h: number; anchor: 'start' | 'middle' | 'end' }
/** Places each label on the free side of its node (below, above, right, left; outward from the focus first), so no
 *  label covers another label or a node dot. Greedy in input order: pass the most important labels first. Crowded
 *  labels search farther out before falling back to least overlap. Sizes are estimates in SVG units (.58em/char).
 *  With `bounds`, a label must also stay inside that box; with `required`, a label that finds no free spot is dropped
 *  unless its id is required (the selected node's name is always shown; a minor one is hidden, never overlapped). */
export function placeLabels(items: { id: string; x: number; y: number; r: number; text: string }[], obstacles: { x: number; y: number; r: number }[], size: number, focus?: Point,
  opts: { bounds?: { x0: number; y0: number; x1: number; y1: number }; required?: ReadonlySet<string> } = {}): Map<string, LabelSpot> {
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = obstacles.map(o => ({ x0: o.x - o.r, y0: o.y - o.r, x1: o.x + o.r, y1: o.y + o.r }));
  const area = (a: typeof taken[number], b: typeof taken[number]) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const { bounds, required } = opts;
  const outside = (a: typeof taken[number]) => bounds ? (a.x1 - a.x0) * (a.y1 - a.y0) - area(a, bounds) : 0;
  const overlap = (a: typeof taken[number]) => taken.reduce((sum, b) => sum + area(a, b), 0) + outside(a) * 4;
  const spots = new Map<string, LabelSpot>();
  for (const item of items) {
    const w = item.text.length * size * .58 + 12, h = size + 8, gap = item.r + 4;
    const below = { x: item.x, y: item.y + gap + h / 2, anchor: 'middle' as const }, above = { x: item.x, y: item.y - gap - h / 2, anchor: 'middle' as const };
    const right = { x: item.x + gap + 4, y: item.y, anchor: 'start' as const }, left = { x: item.x - gap - 4, y: item.y, anchor: 'end' as const };
    const outward = focus && item.y < focus.y ? [above, below] : [below, above];
    const sides = focus && item.x !== focus.x && Math.abs(item.x - focus.x) > Math.abs(item.y - focus.y) ? item.x > focus.x ? [right, ...outward, left] : [left, ...outward, right] : [...outward, right, left];
    let best: { spot: LabelSpot; box: typeof taken[number]; cost: number } | null = null;
    // Search outward when a hub is crowded: labels remain on top without covering dots or other names.
    const candidates = [...sides];
    for (const offset of [30, 60, 100, 150]) for (const side of sides) candidates.push({ ...side,
      x: side.x + (side.anchor === 'start' ? offset : side.anchor === 'end' ? -offset : 0),
      y: side.y + (side.anchor === 'middle' ? (side.y < item.y ? -offset : offset) : 0),
    });
    // then diagonals (a pill slid half its width to either side), for labels hemmed in on all four sides
    for (const side of sides) if (side.anchor === 'middle') for (const dx of [w / 2 + gap, -w / 2 - gap]) candidates.push({ ...side, x: side.x + dx });
    for (const side of candidates) {
      const x0 = side.anchor === 'start' ? side.x : side.anchor === 'end' ? side.x - w : side.x - w / 2;
      const box = { x0, y0: side.y - h / 2, x1: x0 + w, y1: side.y + h / 2 };
      const cost = overlap(box);
      if (!best || cost < best.cost) best = { spot: { ...side, w, h }, box, cost };
      if (cost === 0) break;
    }
    if (best && (best.cost === 0 || !required || required.has(item.id))) { spots.set(item.id, best.spot); taken.push(best.box); }
  }
  return spots;
}

/** Search includes direct neighbours; focus can navigate the full map without drawing unbounded graphs. */
export function neighbourhood(nodes: MapNode[], edges: MapEdge[], query: string, focus: string | null, limit = 100): MapNode[] {
  const q = query.trim().toLowerCase();
  const matches = nodes.filter(n => q ? `${n.label} ${n.file ?? ''}`.toLowerCase().includes(q) : n.id === focus);
  if (!q && !focus) return nodes.slice(0, limit);
  const ids = new Set(matches.map(n => n.id));
  const nearby = new Set<string>();
  for (const e of edges) { if (ids.has(e.from)) nearby.add(e.to); if (ids.has(e.to)) nearby.add(e.from); }
  return [...matches, ...nodes.filter(n => !ids.has(n.id) && nearby.has(n.id))].slice(0, limit);
}

/** An unreported context is unknown, never "below threshold". */
export function contextLevel(chat: ChatSummary, warnTokens: number): 'unknown' | 'above' | 'below' {
  return chat.contextTokens === undefined ? 'unknown' : isLongChat(chat, warnTokens) ? 'above' : 'below';
}

/** The Orchestrator's visible name, whatever its chat is titled (SPEC point 8). */
export const chatName = (c: { isOrchestrator?: boolean; title: string }): string => c.isOrchestrator ? 'Orchestrator' : c.title;

export function contextRatio(chat: ChatSummary): number | null {
  return chat.contextTokens !== undefined && chat.contextMaxTokens && chat.contextMaxTokens > 0
    ? chat.contextTokens / chat.contextMaxTokens : null;
}
