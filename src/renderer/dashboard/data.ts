// Pure dashboard projections: preserve source coverage and unknowns, derive only observed activity.
// Used by Dashboard and its unit tests; no bridge calls or invented telemetry.
import type { ChatItem, ChatSummary, FeedEvent } from '@shared/contract';
import { regiaOfChat } from '@shared/regia';
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
  for (const c of chats) {
    const owner = regiaOfChat(c, chats);
    if (owner) add(owner, c.id, null);
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

export interface ObservedError { id: string; at: number; title: string; detail: string; source: string }
/** One calm summary, with unique diagnostics retained behind the details control. */
export function brainChecks(map: { warnings: string[]; problems: string[] } | null | undefined): string[] {
  return [...new Set([...(map?.warnings ?? []), ...(map?.problems ?? [])].filter(line => line.trim()))];
}
export function observedErrors(chats: ChatSummary[], items: Readonly<Record<string, readonly ChatItem[]>>, feed: readonly FeedEvent[], turnError = 'Turn ended with an error'): ObservedError[] {
  const rows: ObservedError[] = feed.filter(e => e.kind === 'error').map(e => ({ id: `feed:${e.id}`, at: e.at, title: e.title, detail: e.detail, source: 'feed' }));
  for (const c of chats) for (const item of items[c.id] ?? []) {
    const detail = item.kind === 'system' && item.level === 'error' ? item.text
      : item.kind === 'tool' && item.status === 'error' ? `${item.name}: ${item.summary}`
        : item.kind === 'result' && item.isError && !item.interrupted ? turnError : null;
    if (detail) rows.push({ id: `${c.id}:${item.id}`, at: item.at, title: chatName(c), detail, source: c.harness });
  }
  return rows.sort((a, b) => b.at - a.at);
}

export interface Point { x: number; y: number }
/** Stable, bounded force layout for a selected neighbourhood; never changes just because telemetry ticks. */
export function layout(nodes: Pick<MapNode, 'id'>[], edges: Pick<MapEdge, 'from' | 'to'>[], center?: string): Map<string, Point> {
  const points = new Map<string, Point>();
  nodes.forEach((node, i) => {
    const angle = i * 2.399963;
    const radius = 70 + 155 * Math.sqrt(i / Math.max(1, nodes.length));
    points.set(node.id, { x: 400 + Math.cos(angle) * radius, y: 260 + Math.sin(angle) * radius });
  });
  for (let step = 0; step < 90; step++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = points.get(nodes[i]!.id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = points.get(nodes[j]!.id)!;
        const dx = a.x - b.x, dy = a.y - b.y, distance = Math.max(30, Math.hypot(dx, dy));
        const force = Math.min(8, 2200 / (distance * distance));
        a.x += dx / distance * force; a.y += dy / distance * force;
        b.x -= dx / distance * force; b.y -= dy / distance * force;
      }
    }
    for (const edge of edges) {
      const a = points.get(edge.from), b = points.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      a.x += dx * .006; a.y += dy * .006; b.x -= dx * .006; b.y -= dy * .006;
    }
    for (const [id, p] of points) {
      p.x = Math.max(65, Math.min(735, p.x)); p.y = Math.max(55, Math.min(465, p.y));
      if (id === center) { p.x = 400; p.y = 260; }
    }
  }
  return points;
}

export interface LabelSpot { x: number; y: number; w: number; h: number; anchor: 'start' | 'middle' | 'end' }
/** Places each label on the free side of its node (below, above, right, left; outward from the focus first), so no
 *  label covers another label or a node dot. Greedy in input order: pass the most important labels first. When no
 *  side is free the side with the least overlap wins. Sizes are estimates in SVG units (about .58em per character). */
export function placeLabels(items: { id: string; x: number; y: number; r: number; text: string }[], obstacles: { x: number; y: number; r: number }[], size: number, focus?: Point): Map<string, LabelSpot> {
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = obstacles.map(o => ({ x0: o.x - o.r, y0: o.y - o.r, x1: o.x + o.r, y1: o.y + o.r }));
  const overlap = (a: typeof taken[number]) => taken.reduce((sum, b) => sum + Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), 0);
  const spots = new Map<string, LabelSpot>();
  for (const item of items) {
    const w = item.text.length * size * .58 + 12, h = size + 8, gap = item.r + 4;
    const below = { x: item.x, y: item.y + gap + h / 2, anchor: 'middle' as const }, above = { x: item.x, y: item.y - gap - h / 2, anchor: 'middle' as const };
    const right = { x: item.x + gap + 4, y: item.y, anchor: 'start' as const }, left = { x: item.x - gap - 4, y: item.y, anchor: 'end' as const };
    const outward = focus && item.y < focus.y ? [above, below] : [below, above];
    const sides = focus && item.x !== focus.x && Math.abs(item.x - focus.x) > Math.abs(item.y - focus.y) ? item.x > focus.x ? [right, ...outward, left] : [left, ...outward, right] : [...outward, right, left];
    let best: { spot: LabelSpot; box: typeof taken[number]; cost: number } | null = null;
    for (const side of sides) {
      const x0 = side.anchor === 'start' ? side.x : side.anchor === 'end' ? side.x - w : side.x - w / 2;
      const box = { x0, y0: side.y - h / 2, x1: x0 + w, y1: side.y + h / 2 };
      const cost = overlap(box);
      if (!best || cost < best.cost) best = { spot: { ...side, w, h }, box, cost };
      if (cost === 0) break;
    }
    if (best) { spots.set(item.id, best.spot); taken.push(best.box); }
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

/** Cursor export coverage, judged like usage.ts: by the Rome day the export was downloaded (lastRow is only the last
 *  usage row, which can be old even for a fresh export). null = no export or no readable date. */
export function cursorCoverage(cursor: { downloaded?: string }, periodEnd: string): boolean | null {
  const at = cursor.downloaded ? Date.parse(cursor.downloaded) : NaN;
  return Number.isFinite(at) && /^\d{4}-\d{2}-\d{2}/.test(periodEnd) ? ROME_DAY.format(new Date(at)) >= periodEnd.slice(0, 10) : null;
}
const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Orchestrator's visible name, whatever its chat is titled (SPEC point 8). */
export const chatName = (c: { isRegia?: boolean; title: string }): string => c.isRegia ? 'Orchestrator' : c.title;

export function contextRatio(chat: ChatSummary): number | null {
  return chat.contextTokens !== undefined && chat.contextMaxTokens && chat.contextMaxTokens > 0
    ? chat.contextTokens / chat.contextMaxTokens : null;
}
