// The 3D engine of the brain map: 3d-force-graph + three-spritetext from npm (bundled, lazy-loaded on first open: the
// CSP forbids CDNs), wrapped behind a small interface so the React overlay never touches three.js. Layers pull their
// nodes towards fixed anchors (essential view: lobes side by side, seen from the front), labels are sprites (name +
// one-line sentence in the essential view), highlighted pieces and arrows glow in the accent color with particles.
// webglAvailable() is checked first; any failure makes the overlay fall back to the 2D list. Used by map/BrainMap.tsx.
import type { MapEdge, MapNode } from '../types';
import { ANCHOR_ESSENTIAL, ANCHOR_FULL, edgeKey, layerColor, mix, NIGHT, nodeSize } from '../lib/map';

export interface EngineOptions {
  essential: boolean;
  nodes: MapNode[];
  edges: MapEdge[];
  center: string | null;
  focus?: string | null;
  onNode: (id: string) => void;
  onLink: (e: MapEdge) => void;
  onBackground: () => void;
  /** px covered by the side panels, so a fit centers the map in the free part */
  insets?: () => { left: number; right: number };
}
export interface Engine {
  setHighlight(nodes: Set<string>, links: Set<string>): void;
  setData(nodes: MapNode[], edges: MapEdge[]): void;
  lookAt(id: string, distance: number): void;
  frame(ids: string[], minDistance: number): void;
  fit(): void;
  destroy(): void;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
type GNode = MapNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number };
type GLink = Omit<MapEdge, 'source'> & { proof?: MapEdge['source']; source: string | GNode; target: string | GNode };
const endId = (v: string | GNode) => (typeof v === 'string' ? v : v.id);

export async function createEngine(el: HTMLElement, o: EngineOptions): Promise<Engine> {
  const [{ default: ForceGraph3D }, { default: SpriteText }, THREE] = await Promise.all([import('3d-force-graph'), import('three-spritetext'), import('three')]);
  let hi = new Set<string>(), hiL = new Set<string>();
  const ess = o.essential;
  const REL = ess ? 7 : 4;
  const size = (n: GNode) => nodeSize(n, ess, o.center);
  const radius = (n: GNode) => Math.cbrt(size(n)) * REL;
  const dimmed = () => hi.size > 0;
  const nodeColor = (n: GNode) => (dimmed() && !hi.has(n.id) ? mix(layerColor(n.layer), NIGHT.bg, 0.8) : layerColor(n.layer));
  const lk = (l: GLink) => edgeKey(endId(l.source), endId(l.target), l.kind);
  const linkColor = (l: GLink) => (hiL.size ? (hiL.has(lk(l)) ? NIGHT.accent : '#1b2030') : l.kind === 'flusso' ? 'rgba(255,122,69,0.55)' : NIGHT.link);
  const font = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
  const label = (n: GNode) => {
    const on = !dimmed() || hi.has(n.id);
    const g = new THREE.Group();
    const name = new SpriteText(short(n.label, 30));
    Object.assign(name, { textHeight: (ess ? 23 : 3.6) * (on && dimmed() ? 1.2 : 1), color: on ? NIGHT.ink : NIGHT.dim, fontFace: font, fontWeight: '700', fontSize: 160 });
    name.position.y = radius(n) + (ess ? 18 : 4);
    g.add(name);
    if (ess && n.short && on) {
      const what = new SpriteText(short(n.short, 46));
      Object.assign(what, { textHeight: 16, color: on ? NIGHT.muted : NIGHT.dim, fontFace: font, fontWeight: '500', fontSize: 140 });
      what.position.y = -radius(n) - 14;
      g.add(what);
    }
    return g;
  };
  const toLinks = (edges: MapEdge[]): GLink[] => edges.map(({ source: proof, ...e }) => ({ ...e, proof, source: e.from, target: e.to }));

  let fitted = false;
  const before = new Set(el.children);
  const graph = new ForceGraph3D(el, { controlType: 'orbit' });
  // what this engine added to the container (canvas, tooltip, nav info): the only nodes destroy() removes, so a newer
  // engine already mounted in the same container is never wiped by an older one finishing late
  const mine = [...el.children].filter(c => !before.has(c));
  graph
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor('rgba(0,0,0,0)').showNavInfo(false).enableNodeDrag(false)
    .warmupTicks(ess ? 160 : 60).cooldownTicks(ess ? 120 : 260).cooldownTime(60000)
    .onEngineStop(() => { if (fitted) return; fitted = true; if (o.focus) api.lookAt(o.focus, ess ? 320 : 200); else view(graph.graphData().nodes as GNode[], 0, 900); })
    .nodeId('id').nodeRelSize(REL).nodeVal(n => size(n as GNode)).nodeColor(n => nodeColor(n as GNode)).nodeOpacity(0.97).nodeResolution(24)
    .nodeLabel(n => `<div style="font:13px/1.4 Segoe UI,system-ui;padding:6px 8px;background:#151925;border:1px solid #2a3040;border-radius:8px;color:#eef0f6"><b>${esc((n as GNode).label)}</b><br>${esc((n as GNode).short ?? '')}</div>`)
    .nodeThreeObject(n => label(n as GNode)).nodeThreeObjectExtend(true)
    .linkColor(l => linkColor(l as GLink)).linkOpacity(0.9)
    .linkWidth(l => (hiL.has(lk(l as GLink)) ? (ess ? 3.2 : 2.2) : (l as GLink).kind === 'flusso' ? (ess ? 1.1 : 0.7) : 0.4))
    .linkDirectionalArrowLength(l => (hiL.has(lk(l as GLink)) ? 7 : 0)).linkDirectionalArrowRelPos(0.88)
    .linkDirectionalParticles(l => (hiL.has(lk(l as GLink)) ? 5 : (l as GLink).kind === 'posta' ? 2 : 0)).linkDirectionalParticleWidth(ess ? 3.4 : 2.2).linkDirectionalParticleSpeed(0.007).linkDirectionalParticleColor(() => NIGHT.accent)
    .linkLabel(l => esc((l as GLink).label))
    .onNodeClick(n => o.onNode((n as GNode).id))
    .onLinkClick(l => { const g = l as GLink; o.onLink({ from: endId(g.source), to: endId(g.target), kind: g.kind, label: g.label, source: g.proof, count: g.count }); })
    .onBackgroundClick(() => o.onBackground())
    .graphData({ nodes: o.nodes.map(n => ({ ...n })), links: toLinks(o.edges) });
  const anchors = ess ? ANCHOR_ESSENTIAL : ANCHOR_FULL;
  graph.d3Force('layer', ((alpha: number) => {
    for (const n of graph.graphData().nodes as GNode[]) {
      const a = anchors[n.layer] ?? [0, 0, 0], k = ess ? 0.12 : 0.25;
      n.vx = (n.vx ?? 0) + (a[0] - (n.x ?? 0)) * k * alpha;
      n.vy = (n.vy ?? 0) + (a[1] - (n.y ?? 0)) * k * alpha;
      n.vz = (n.vz ?? 0) + (a[2] - (n.z ?? 0)) * (ess ? 0.6 : 0.25) * alpha;
    }
  }) as never);
  (graph.d3Force('charge') as unknown as { strength: (v: number) => void } | undefined)?.strength(ess ? -1100 : -45);
  (graph.d3Force('link') as unknown as { distance: (f: () => number) => { strength: (f: (l: GLink) => number) => void } } | undefined)
    ?.distance(() => (ess ? 180 : 55)).strength(l => (l.kind === 'usa' || l.kind === 'cita' ? 0.005 : ess ? 0.006 : 0.03));
  Object.assign(graph.controls() as object, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.6, zoomSpeed: 0.7, panSpeed: 0.6 });
  graph.cameraPosition({ x: 0, y: -60, z: ess ? 1700 : 520 });
  // a first fit as soon as the warm-up layout is drawn, the final one when the layout stops moving
  const early = setTimeout(() => { if (!fitted && !o.focus) view(graph.graphData().nodes as GNode[], 0, 400); }, 450);
  const ro = new ResizeObserver(() => { if (el.clientWidth && el.clientHeight) graph.width(el.clientWidth).height(el.clientHeight); });
  ro.observe(el);

  // Camera from the front (the essential layout is nearly flat: a radial camera would see it edge-on), far enough for
  // the pieces' box (labels included) to fit the free part of the canvas, i.e. without the side panels: the library's
  // zoomToFit fits the widest axis into the height and leaves a wide layout small in the middle.
  function view(ns: GNode[], minDist: number, ms: number) {
    const pts = ns.filter(n => n.x != null && n.y != null);
    if (!pts.length || !el.clientWidth || !el.clientHeight) return;
    const xs = pts.map(n => n.x!), ys = pts.map(n => n.y!), zs = pts.map(n => n.z ?? 0);
    const m = ess ? 70 : 10; // room for the labels around the nodes
    const w = Math.max(...xs) - Math.min(...xs) + 2 * m * 1.6, h = Math.max(...ys) - Math.min(...ys) + 2 * m;
    const ins = o.insets?.() ?? { left: 0, right: 0 };
    const W = Math.max(200, el.clientWidth - ins.left - ins.right - 48), H = Math.max(200, el.clientHeight - 110);
    const fov = ((graph.camera() as unknown as { fov?: number }).fov ?? 40) * Math.PI / 180, t = Math.tan(fov / 2);
    const zTop = Math.max(...zs), cz = (Math.min(...zs) + zTop) / 2;
    // distance at which h world units fill H px (and w fill W px), measured from the nearest nodes
    const d = Math.max(minDist, (h / 2 / t) * (el.clientHeight / H), (w / 2 / t) * (el.clientHeight / W)) + (zTop - cz);
    const perPx = (2 * d * t) / el.clientHeight;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - ((ins.left - ins.right) / 2) * perPx, cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 10 * perPx;
    graph.cameraPosition({ x: cx, y: cy, z: cz + d }, { x: cx, y: cy, z: cz }, ms);
  }
  const refreshLook = () => {
    graph.nodeColor(graph.nodeColor()).linkColor(graph.linkColor()).nodeThreeObject(graph.nodeThreeObject())
      .linkWidth(graph.linkWidth()).linkDirectionalParticles(graph.linkDirectionalParticles()).linkDirectionalArrowLength(graph.linkDirectionalArrowLength());
  };
  const api: Engine = {
    setHighlight(nodes, links) { hi = nodes; hiL = links; refreshLook(); },
    setData(nodes, edges) {
      const old = new Map((graph.graphData().nodes as GNode[]).map(n => [n.id, n]));
      graph.graphData({ nodes: nodes.map(n => old.get(n.id) ?? { ...n }), links: toLinks(edges) });
    },
    lookAt(id, dist) { api.frame([id], dist); },
    frame(ids, minDist) { view((graph.graphData().nodes as GNode[]).filter(x => ids.includes(x.id)), minDist, 1100); },
    fit() { view(graph.graphData().nodes as GNode[], 0, 700); },
    destroy() {
      clearTimeout(early);
      ro.disconnect();
      try { graph.pauseAnimation(); graph._destructor(); } catch { /* already gone */ }
      try { graph.renderer().dispose(); graph.renderer().forceContextLoss(); } catch { /* none */ }
      for (const c of mine) c.remove();
    },
  };
  return api;
}
