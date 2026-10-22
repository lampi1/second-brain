// The 3D map's data logic, without three.js: which view to draw (essential = the brain's own simplified graph, full =
// every file and arrow), layer colors of the night world, which arrow kinds are on by default, node sizes, the central
// person, weak points (computed by the brain, never written by hand) and the members a group stands for. Pure; used by
// map/BrainMap.tsx and its 2D fallback; unit-tested in test/unit/brain-ui/map.test.ts.
import type { Flow, MapData, MapEdge, MapNode } from '../types';
import { t } from '../../i18n';

/** The night world: fixed colors, readable on the dark background whatever the app theme. */
export const NIGHT = { bg: '#090b11', ink: '#eef0f6', dim: '#5d6578', muted: '#9aa3b8', accent: '#ff7a45', link: 'rgba(160,172,196,0.32)' };
export const LAYER_COLOR: Record<string, string> = { persone: '#f0b44c', chat: '#6aa2ff', agenti: '#b28cff', tool: '#3cd6d0', memoria: '#72d98f', regole: '#ff7a93', esterni: '#a7b2c2' };
export const layerColor = (layer: string): string => LAYER_COLOR[layer] ?? '#8b93a7';
/** The arrow kinds and their names; getters, so each read is in the current language. */
export const EDGE_KINDS: Record<string, string> = {
  get flusso() { return t('brainText.mapLib.edge.flusso'); }, get hook() { return t('brainText.mapLib.edge.hook'); }, get posta() { return t('brainText.mapLib.edge.posta'); },
  get legge() { return t('brainText.mapLib.edge.legge'); }, get contesto() { return t('brainText.mapLib.edge.contesto'); }, get esterno() { return t('brainText.mapLib.edge.esterno'); },
  get istanza() { return t('brainText.mapLib.edge.istanza'); }, get usa() { return t('brainText.mapLib.edge.usa'); }, get cita() { return t('brainText.mapLib.edge.cita'); },
};
const ON_ESSENTIAL = ['flusso', 'hook', 'posta', 'legge', 'contesto'];
const ON_FULL = [...ON_ESSENTIAL, 'esterno', 'istanza'];
export const defaultKinds = (essential: boolean): Record<string, boolean> => Object.fromEntries(Object.keys(EDGE_KINDS).map(k => [k, (essential ? ON_ESSENTIAL : ON_FULL).includes(k)]));
/** Where each layer sits in the essential view: lobes side by side, seen from the front, shallow depth. */
export const ANCHOR_ESSENTIAL: Record<string, [number, number, number]> = { persone: [0, 20, 0], chat: [0, 210, 0], agenti: [-560, 80, 0], tool: [0, -240, 0], memoria: [560, 80, 0], regole: [-340, 340, 0], esterni: [0, -540, 0] };
export const ANCHOR_FULL: Record<string, [number, number, number]> = { persone: [0, 10, 170], chat: [0, 30, 80], agenti: [-160, 50, -10], tool: [10, -30, -50], memoria: [160, 40, -30], regole: [0, 160, -70], esterni: [0, -180, -40] };

export interface MapView { essential: boolean; nodes: MapNode[]; edges: MapEdge[]; flows: Flow[]; layers: MapData['layers']; total: number }
/** The view to draw: the essential one when the brain has it (and it was asked), else the full graph. */
export function pickView(m: MapData, essential: boolean): MapView {
  const e = essential && !!m.simple?.nodes.length;
  const src = e && m.simple ? m.simple : m;
  return { essential: e, nodes: src.nodes, edges: src.edges, flows: src.flows.length ? src.flows : m.flows, layers: m.layers, total: m.nodes.length };
}

/** The person the map is about: the most connected node of the people layer. */
export function centerId(nodes: MapNode[]): string | null {
  const people = nodes.filter(n => n.layer === 'persone');
  return [...people].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))[0]?.id ?? null;
}
export function nodeSize(n: MapNode, essential: boolean, center: string | null): number {
  if (essential) return n.id === center ? 60 : n.kind === 'gruppo' ? 30 + (n.members?.length ?? 0) : 20 + (n.degree ?? 0) * 1.5;
  return n.id === center ? 9 : 2.2 + Math.sqrt(n.degree ?? 0) * 1.3;
}

/** Weak points: the brain's own list plus its problems (to verify), each with the pieces it is about. */
export function weakPoints(m: MapData): { kind: string; text: string; ids: string[] }[] {
  return [...m.weak, ...m.problems.map(p => ({ kind: 'da verificare', text: p, ids: [] as string[] }))];
}

/** member id → the group node that stands for it in the essential view */
export function groupIndex(nodes: MapNode[]): Map<string, string> {
  const g = new Map<string, string>();
  for (const n of nodes) for (const m of n.members ?? []) g.set(m.id, n.id);
  return g;
}

/** Mix two #rrggbb colors (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const h = (x: string) => (x.match(/[0-9a-f]{2}/gi) ?? ['0', '0', '0']).map(v => parseInt(v, 16));
  const p = h(a), q = h(b);
  return `rgb(${p.map((v, i) => Math.round(v * (1 - t) + (q[i] ?? 0) * t)).join(',')})`;
}

/** A node's file relative to the brain root (null when it lives elsewhere, e.g. in the user's home). */
export function relFile(file: string | undefined, root: string): string | null {
  if (!file || !root) return null;
  const f = file.replace(/\\/g, '/'), r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return f.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? f.slice(r.length + 1) : null;
}

/** What a piece is called technically, shown small under its speaking label: its file relative to the brain, else the
 *  brain's `name` (an agent, a /skill, a file in the user's home); null when it says nothing more than the label. */
export function fileName(n: Pick<MapNode, 'label' | 'name' | 'file' | 'short'>, root: string): string | null {
  const t = relFile(n.file, root) ?? n.name ?? null;
  if (!t) return null;
  const same = (s: string | undefined) => !!s && s.trim().toLowerCase() === t.toLowerCase();
  return same(n.label) || same(n.short) ? null : t;
}

/** Search a piece by its label or its technical name (file, agent, /skill): exact match first, then partial. */
export function findNode(nodes: MapNode[], q: string): MapNode | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  const names = (n: MapNode) => [n.label, n.name ?? ''].map(s => s.toLowerCase());
  return nodes.find(n => names(n).includes(t)) ?? nodes.find(n => names(n).some(s => s.includes(t))) ?? null;
}

/** Nodes of the view by layer, for the 2D list (fallback without WebGL). */
export function byLayer(v: MapView): { id: string; label: string; hint: string; nodes: MapNode[] }[] {
  return v.layers.map(l => ({ ...l, nodes: v.nodes.filter(n => n.layer === l.id).sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0)) })).filter(l => l.nodes.length);
}

export const edgeKey = (from: string, to: string, kind: string): string => `${from}|${to}|${kind}`;
