// The 3D engine of the brain map: 3d-force-graph + three-spritetext from npm (bundled, lazy-loaded on first open: the
// CSP forbids CDNs), wrapped behind a small interface so the React overlay never touches three.js. Layers pull their
// nodes towards fixed anchors (essential view: lobes side by side, seen from the front), labels are sprites (name +
// one-line sentence in the essential view). webglAvailable() is checked first; any failure makes the overlay fall back
// to the 2D list. Used by map/BrainMap.tsx. Decisions: ADR 0039.
// Look: each piece is a neuron (a soft soma with a lighter core and a rim of light, a few short tapered dendrites, one
// low-poly geometry per variant shared by all), each link an axon (a camera-facing ribbon bent slightly, thinner
// towards its target, drawn by a shader from two endpoints: one shared geometry, nothing rebuilt when the layout moves).
// A lit path and a live call send a soft signal along their axons; a piece at work breathes inside a halo of light.
// Cost: neurons (one batch per variant), halos and axons are each one instanced draw call, every piece and link a slot
// of instance attributes; the library's scene keeps per object only what the picking and the labels need. Values at
// rest are not repainted, and the hover picking answers again only when the pointer, the camera or the layout moved.
// Motion: one requestAnimationFrame loop owned here draws at display rate while anything moves (the layout settling, a
// camera flight, the user's hand, a value easing to its target, a signal or a breath of a call at work) and stops
// completely when nothing does, when the window is hidden or minimized, or when the map is closed; without focus it
// draws at most ~30 frames a second. Every change of look (highlight, live light, newcomers) eases over a few hundred
// ms through uniforms and opacities: nothing is rebuilt per frame and nothing is allocated per frame. Live fades are
// carried between the app's snapshots (lib/map-motion.ts). A settled layout and its camera are remembered per view, so
// reopening the map shows the same picture at once, without a warm-up or a camera flight.
import type * as T3 from 'three';
import type { MapEdge, MapNode } from '../types';
import { ANCHOR_ESSENTIAL, ANCHOR_FULL, edgeKey, fileName, layerColor, NIGHT, nodeSize } from '../lib/map';
import { FADE_MS } from '../lib/live';
import { approach, axonBend, breath, dendrites, liveTarget, neuronShape, pulseHead, tauFor } from '../lib/map-motion';

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
  /** the brain folder: the hover card shows a piece's file relative to it */
  root?: string;
}
export interface LiveLook { glow: Map<string, { level: number; running: boolean }>; links: Map<string, { level: number; running: boolean }> }
export interface Engine {
  setHighlight(nodes: Set<string>, links: Set<string>): void;
  setData(nodes: MapNode[], edges: MapEdge[]): void;
  /** the live map's lit nodes and links (null = off) */
  setLive(l: LiveLook | null): void;
  lookAt(id: string, distance: number): void;
  frame(ids: string[], minDistance: number): void;
  fit(): void;
  destroy(): void;
}

/** Load the 3D libraries ahead of the first open (the app calls it when idle): the map then opens without the wait. */
export function preloadEngine(): void {
  void Promise.all([import('3d-force-graph'), import('three-spritetext'), import('three')]).catch(() => { /* the map retries on open */ });
}

/** The settled positions of a view (same nodes), kept for this app run: the next open starts from them. */
const layouts = new Map<string, Map<string, [number, number, number]>>();
/** where the camera was when the view closed (same key): the next open starts there, no flight */
const cameras = new Map<string, { p: [number, number, number]; t: [number, number, number] }>();
/** live nodes (chats, files, environments of the live map) come and go: they never make a layout new */
const isLive = (id: string) => id.startsWith('live:');
const baseIds = (nodes: { id: string }[]) => nodes.filter(n => !isLive(n.id)).map(n => n.id);
const layoutKey = (essential: boolean, nodes: { id: string }[]) => `${essential}|${baseIds(nodes).sort().join(',')}`;
const LIVE = { halo: '#ffe9a8', link: '#ffd166' };
const dataSig = (nodes: MapNode[], edges: MapEdge[]) => `${nodes.map(n => n.id).join(',')}#${edges.map(e => edgeKey(e.from, e.to, e.kind)).join(',')}`;
/** what an arrow says (label, proof, count) and a piece shows (label, sentence): a change is applied without a new layout */
const detailSig = (nodes: MapNode[], edges: MapEdge[]) => JSON.stringify([nodes.map(n => [n.label, n.short ?? '']), edges.map(e => [e.label, e.source?.text ?? '', e.source?.file ?? '', e.count ?? 0])]);
/** neuron variants (dendrite arrangements) shared by all pieces */
const VARIANTS = 5;
/** segments along an axon (the shader bends them; the picking samples the same curve) */
const AXON_SEG = 16;
/** how long a lit path keeps sending signals before the picture rests (the path stays lit) */
const PATH_PULSE_MS = 6000;
/** while the window has no focus (the map seen beside another app) and no hand is on it: a frame every other display
 *  frame at most (about 30 a second) */
const UNFOCUSED_MS = 25;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** the hover card of a piece: its speaking name, its sentence, its file (small, muted) when it has one */
const nodeCard = (n: Pick<MapNode, 'label' | 'name' | 'file' | 'short'>, root: string): string => {
  const f = fileName(n, root);
  return `<div style="font:13px/1.4 Segoe UI,system-ui;padding:6px 8px;background:#151925;border:1px solid #2a3040;border-radius:8px;color:#eef0f6"><b>${esc(n.label)}</b><br>${esc(n.short ?? '')}${f ? `<div style="margin-top:3px;font:11px/1.3 Consolas,ui-monospace,monospace;color:#8e97ab">${esc(f)}</div>` : ''}</div>`;
};
const short = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
type GNode = MapNode & { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number };
type GLink = Omit<MapEdge, 'source'> & { proof?: MapEdge['source']; source: string | GNode; target: string | GNode };
const endId = (v: string | GNode) => (typeof v === 'string' ? v : v.id);

// ── shaders ──
// all neurons of a variant are instances of its geometry: iPos = (center, size; size 0 = a free slot, out of the view),
// iQuat = how it is turned, iCol = (color, live light), iBreath = its breath
const NEURON_VS = /* glsl */`
attribute vec4 iPos; attribute vec4 iQuat; attribute vec4 iCol; attribute float iBreath;
varying vec3 vN; varying vec3 vV; varying float vR; varying vec3 vColor; varying float vLit; varying float vBreath;
vec3 turn(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vR = length(position); vColor = iCol.rgb; vLit = iCol.a; vBreath = iBreath; vN = vec3(0.0, 0.0, 1.0); vV = vN;
  if (iPos.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vN = normalize(normalMatrix * turn(iQuat, normal));
  vec4 mv = modelViewMatrix * vec4(iPos.xyz + turn(iQuat, position) * iPos.w, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// a soft soma: darker body, a lighter core facing the eye, a rim of its own color; the live light rises from the core;
// dendrites fade into the night towards their tips
const NEURON_FS = /* glsl */`
uniform vec3 uGlow; uniform vec3 uBg;
varying vec3 vN; varying vec3 vV; varying float vR; varying vec3 vColor; varying float vLit; varying float vBreath;
void main() {
  vec3 uColor = vColor; float uLit = vLit, uBreath = vBreath;
  vec3 n = normalize(vN), v = normalize(vV);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float dend = smoothstep(1.0, 1.12, vR); // on a dendrite, not the soma
  float rim = pow(1.0 - facing, 2.2) * (1.0 - dend), core = pow(facing, 3.0) * (1.0 - dend);
  float lit = uLit * (0.78 + 0.22 * uBreath) * (1.0 - 0.8 * dend);
  vec3 col = uColor * (0.5 + 0.45 * core) + uColor * rim * 0.35;
  col = mix(col, uGlow, lit * (0.12 + 0.2 * core)); // the layer color stays readable under the live light
  col += uGlow * rim * lit * 0.45;
  col = mix(col, uBg, smoothstep(1.0, 2.1, vR) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
// the axon: a ribbon facing the camera along a quadratic curve from iA to iB, bent sideways by its bend × its length,
// w0 wide at the source and w1 at the target (never under minPx on screen); position.x = t along it, .y = side. All
// axons are instances of one ribbon: iShape = (w0, w1, minPx, bend), iCol = (color, alpha), iPul = (signal color, its
// strength), iHead = where the signal is; alpha 0 = a free or hidden slot, moved out of the view
const AXON_VS = /* glsl */`
uniform float uViewH;
attribute vec3 iA; attribute vec3 iB; attribute vec4 iShape; attribute vec4 iCol; attribute vec4 iPul; attribute float iHead;
varying float vT; varying float vS; varying float vPx; varying vec4 vCol; varying vec4 vPul; varying float vHead;
void main() {
  vCol = iCol; vPul = iPul; vHead = iHead; vT = position.x; vS = position.y; vPx = 0.0;
  if (iCol.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 uA = iA, uB = iB; float uW0 = iShape.x, uW1 = iShape.y, uMinPx = iShape.z, uBend = iShape.w;
  float t = position.x;
  vec3 d = uB - uA; float L = length(d);
  vec3 ref = abs(d.z) < 0.9 * L ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 nrm = cross(d, ref); float nl = length(nrm);
  nrm = nl > 1e-5 ? nrm / nl : vec3(0.0);
  vec3 c = 0.5 * (uA + uB) + nrm * uBend * L;
  float u = 1.0 - t;
  vec3 p = u * u * uA + 2.0 * u * t * c + t * t * uB;
  vec3 tg = 2.0 * u * (c - uA) + 2.0 * t * (uB - c);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tv = mat3(modelViewMatrix) * tg;
  vec3 side = cross(tv, mv.xyz); float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(0.0, 1.0, 0.0);
  float pxPerUnit = projectionMatrix[1][1] * uViewH * 0.5 / max(1.0, -mv.z);
  float w = max(mix(uW0, uW1, t), mix(uMinPx * 1.6, uMinPx * 0.6, t) / pxPerUnit); // tapered even at the minimum
  vPx = w * pxPerUnit;
  mv.xyz += side * (0.5 * w * position.y);
  gl_Position = projectionMatrix * mv;
}`;
// edges feathered over about one pixel whatever the width (a thin axon stays continuous, not dashed); the signal is a
// bright bump at the head travelling along t
const AXON_FS = /* glsl */`
varying float vT; varying float vS; varying float vPx; varying vec4 vCol; varying vec4 vPul; varying float vHead;
void main() {
  float edge = clamp((1.0 - abs(vS)) * 0.5 * vPx + 0.25, 0.0, 1.0);
  float x = (vT - vHead) / 0.09;
  float bump = vPul.a * exp(-x * x);
  vec3 col = mix(vCol.rgb, vPul.rgb, min(1.0, bump));
  // brighter at the source: the direction reads without the signal (reduced motion, a path after its signals)
  gl_FragColor = vec4(col, min(1.0, vCol.a * mix(1.0, 0.55, vT) + bump * 0.85) * edge);
  #include <colorspace_fragment>
}`;
// the halo of a neuron: a camera-facing quad of soft light (additive), iPos = (center, size), iCol = (color, opacity)
const HALO_VS = /* glsl */`
attribute vec4 iPos; attribute vec4 iCol;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vUv = position.xy; vCol = iCol;
  if (iPos.w <= 0.0 || iCol.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  mv.xy += position.xy * iPos.w;
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FS = /* glsl */`
varying vec2 vUv; varying vec4 vCol;
void main() {
  float d = length(vUv) * 2.0;
  float a = d < 0.25 ? mix(1.0, 0.5, d / 0.25) : mix(0.5, 0.0, clamp((d - 0.25) / 0.75, 0.0, 1.0));
  gl_FragColor = vec4(vCol.rgb, a * vCol.a);
  #include <colorspace_fragment>
}`;

export async function createEngine(el: HTMLElement, o: EngineOptions): Promise<Engine> {
  const [{ default: ForceGraph3D }, { default: SpriteText }, THREE] = await Promise.all([import('3d-force-graph'), import('three-spritetext'), import('three')]);
  let hi = new Set<string>(), hiL = new Set<string>();
  const ess = o.essential;
  const REL = ess ? 7 : 4;
  const size = (n: GNode) => nodeSize(n, ess, o.center);
  const radius = (n: GNode) => Math.cbrt(size(n)) * REL;
  const lk = (l: GLink) => edgeKey(endId(l.source), endId(l.target), l.kind);
  let lv: LiveLook = { glow: new Map(), links: new Map() };
  /** when the live look last changed (its fading levels are carried forward from there) */
  let lvAt = 0, lvSig = '';
  /** until when a lit path sends signals */
  let pathPulseUntil = 0;
  // with reduced motion asked by the system the live map lights up without breathing or travelling signals
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = () => performance.now();

  // ── shared resources: the library disposes the objects it removes; these outlive them (disposed in destroy) ──
  const shared: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => { const real = x.dispose.bind(x); x.dispose = () => { /* shared */ }; shared.push({ dispose: real }); return x; };
  /** one geometry per variant: a soma of radius 1 and 3-4 tapered, gently curved dendrite stubs, merged (one draw per neuron) */
  const neuronGeo = Array.from({ length: VARIANTS }, (_, v) => {
    const parts: T3.BufferGeometry[] = [new THREE.IcosahedronGeometry(1, 3)];
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), dir = new THREE.Vector3();
    for (const [i, d] of dendrites(v, 3 + (v % 2)).entries()) {
      // a stub growing out of the soma: wide where it leaves it, a fine tip, gently curved
      const h = 0.55 + 0.75 * d.len, c = new THREE.CylinderGeometry(0.025, 0.3, h, 6, 4, true);
      c.translate(0, h / 2, 0);
      const p = c.getAttribute('position'), bend = (i % 2 ? 1 : -1) * 0.35;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k) / h; p.setX(k, p.getX(k) + bend * y * y * h * 0.4); }
      c.computeVertexNormals();
      c.translate(0, 0.62, 0);
      c.applyQuaternion(q.setFromUnitVectors(up, dir.set(...d.dir)));
      parts.push(c.toNonIndexed());
      c.dispose();
    }
    const n = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let at = 0;
    for (const g of parts) { pos.set(g.getAttribute('position').array as Float32Array, at); nor.set(g.getAttribute('normal').array as Float32Array, at); at += g.getAttribute('position').count * 3; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    return keep(geo);
  });
  /** the screen height the axons' minimum width is measured in */
  const viewH = { value: el.clientHeight || 800 };
  const BG = new THREE.Color(NIGHT.bg), GLOW = new THREE.Color(LIVE.halo), ACCENT = new THREE.Color(NIGHT.accent);
  const LINK_DIM = new THREE.Color('#1b2030'), LINK_BASE = new THREE.Color('#a0acc4'), LINK_FLOW = new THREE.Color('#ff7a45'), LINK_LIVE = new THREE.Color(LIVE.link);
  const PULSE_PATH = new THREE.Color('#ffd9c2');

  // ── batches: what is drawn many times (neurons, halos, axons) is one instanced draw call each, every object in a slot
  // of the instance attributes (slots of removed objects are reused, hidden by zeroing `hide`, a component the shader
  // reads as "not drawn"); the library's scene keeps per object only what the picking and the labels need ──
  function makeBatch<K extends string>(base: T3.BufferGeometry, mat: T3.Material, sizes: Record<K, number>, hide: [NoInfer<K>, number], hint: number) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.getIndex());
    for (const [k, a] of Object.entries(base.attributes)) geo.setAttribute(k, a as T3.BufferAttribute);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; // the shaders place the vertices: three's bounds would be wrong
    mesh.raycast = () => { /* each object picks itself */ };
    shared.push(geo, mat);
    const at = {} as Record<K, T3.InstancedBufferAttribute>, free: number[] = [];
    let cap = 0, top = 0;
    const grow = (n: number) => {
      let c = Math.max(64, cap);
      while (c < n) c *= 2;
      if (c === cap) return;
      geo.dispose(); // the old buffers go; three uploads the new ones at the next draw
      for (const k of Object.keys(sizes) as K[]) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(c * sizes[k]), sizes[k]);
        a.setUsage(THREE.DynamicDrawUsage);
        if (at[k]) (a.array as Float32Array).set(at[k].array as Float32Array);
        at[k] = a;
        geo.setAttribute(k, a);
      }
      cap = c;
    };
    grow(hint);
    return {
      mesh, at,
      take(): number { const x = free.pop() ?? top++; if (x >= cap) grow(x + 1); geo.instanceCount = top; return x; },
      drop(x: number) { const a = at[hide[0]]; a.array[x * a.itemSize + hide[1]] = 0; a.needsUpdate = true; free.push(x); },
    };
  }
  /** the axons: the ribbon ((t, side) pairs) bent by the shader */
  const axonB = (() => {
    const pos = new Float32Array((AXON_SEG + 1) * 2 * 3), idx: number[] = [];
    for (let i = 0; i <= AXON_SEG; i++) {
      pos.set([i / AXON_SEG, -1, 0, i / AXON_SEG, 1, 0], i * 6);
      if (i < AXON_SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ vertexShader: AXON_VS, fragmentShader: AXON_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uViewH: viewH } });
    return makeBatch(g, mat, { iA: 3, iB: 3, iShape: 4, iCol: 4, iPul: 4, iHead: 1 }, ['iCol', 3], o.edges.length);
  })();
  /** the neurons: one batch per variant, one material */
  const neuronMat = new THREE.ShaderMaterial({ vertexShader: NEURON_VS, fragmentShader: NEURON_FS, uniforms: { uGlow: { value: GLOW }, uBg: { value: BG } } });
  const neuronB = neuronGeo.map(g => makeBatch(g, neuronMat, { iPos: 4, iQuat: 4, iCol: 4, iBreath: 1 }, ['iPos', 3], (2 * o.nodes.length) / VARIANTS));
  const haloB = makeBatch(new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    { iPos: 4, iCol: 4 }, ['iPos', 3], o.nodes.length);
  haloB.mesh.renderOrder = -1; // light under everything
  /** the neuron in the library's scene: never drawn (its batch draws it), what the picking hits */
  const pickOnly = keep(new THREE.MeshBasicMaterial({ visible: false }));

  // ── a neuron: soma + dendrites, a halo (a faint glow of its color at rest, the live light at work), its labels ──
  interface NodeView {
    id: string; n: GNode; r: number; phase: number; variant: number; quat: T3.Quaternion; slotN: number; slotH: number; neuron: T3.Mesh;
    labels: T3.Group; name: InstanceType<typeof SpriteText>; what: InstanceType<typeof SpriteText> | null;
    base: T3.Color; dimC: T3.Color; layer: T3.Color;
    lit: number; run: number; dim: number; focus: number; grow: number;
    /** breathing: painted every frame even with its values at rest */
    busy: boolean;
  }
  const nodeViews = new WeakMap<object, NodeView>();
  const font = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
  // ── hover picking: the library asks every 50 ms while frames run; it is answered again only when what is under the
  // pointer can have changed (the pointer, the camera or the layout moved), otherwise from the last answer ──
  let pickFresh = true, picked = false, pickMoved = true;
  const pickHits = new WeakMap<object, T3.Intersection[]>();
  function gate(obj: T3.Object3D, real: (rc: T3.Raycaster, hits: T3.Intersection[]) => void) {
    obj.raycast = (rc, hits) => {
      if (!pickFresh) { const h = pickHits.get(obj); if (h) hits.push(...h); return; }
      picked = true;
      const n = hits.length;
      real.call(obj, rc, hits);
      if (hits.length > n) pickHits.set(obj, hits.slice(n)); else pickHits.delete(obj);
    };
  }
  /** the first objects of a remembered layout appear at full size; later newcomers grow in */
  let growIn = false;
  const makeNode = (n: GNode): T3.Object3D => {
    const r = radius(n), shape = neuronShape(n.id, VARIANTS), base = new THREE.Color(layerColor(n.layer));
    const neuron = new THREE.Mesh(neuronGeo[shape.variant], pickOnly);
    neuron.rotation.set(shape.rx, shape.ry, shape.rz);
    const g = new THREE.Group();
    g.add(neuron);
    const labels = new THREE.Group();
    const name = new SpriteText(short(n.label, 30));
    Object.assign(name, { textHeight: ess ? 23 : 3.6, color: NIGHT.ink, fontFace: font, fontWeight: '700', fontSize: 160 });
    name.position.y = r + (ess ? 18 : 4);
    name.renderOrder = 10; // after the axons and halos: the words stay on top
    labels.add(name);
    let what: InstanceType<typeof SpriteText> | null = null;
    if (ess && n.short) {
      what = new SpriteText(short(n.short, 46));
      Object.assign(what, { textHeight: 16, color: NIGHT.muted, fontFace: font, fontWeight: '500', fontSize: 140 });
      what.position.y = -r - 14;
      what.renderOrder = 10;
      labels.add(what);
    }
    g.add(labels);
    const old = nodeViews.get(n);
    const v: NodeView = {
      id: n.id, n, r, phase: shape.phase, variant: shape.variant, quat: new THREE.Quaternion().setFromEuler(neuron.rotation), slotN: -1, slotH: -1, neuron, labels, name, what,
      base, dimC: base.clone().lerp(BG, 0.8), layer: base,
      lit: old?.lit ?? 0, run: old?.run ?? 0, dim: old?.dim ?? 0, focus: old?.focus ?? 0, grow: old?.grow ?? (growIn ? 0 : 1), busy: false,
    };
    gate(neuron, neuron.raycast);
    gate(name, name.raycast);
    if (what) gate(what, what.raycast);
    // slots in the batches while the piece is in the scene
    g.addEventListener('added', () => {
      if (v.slotN >= 0) return;
      v.slotN = neuronB[v.variant]!.take(); v.slotH = haloB.take();
      const q = neuronB[v.variant]!.at.iQuat;
      q.array[v.slotN * 4] = v.quat.x; q.array[v.slotN * 4 + 1] = v.quat.y; q.array[v.slotN * 4 + 2] = v.quat.z; q.array[v.slotN * 4 + 3] = v.quat.w;
      q.needsUpdate = true;
      placeNode(v, v.n.x ?? 0, v.n.y ?? 0, v.n.z ?? 0);
      paintNode(v, frameNow);
    });
    g.addEventListener('removed', () => { if (v.slotN >= 0) { neuronB[v.variant]!.drop(v.slotN); haloB.drop(v.slotH); v.slotN = v.slotH = -1; } });
    nodeViews.set(n, v);
    paintNode(v, 0);
    return g;
  };
  /** the layout moved a piece: its neuron and halo follow */
  function placeNode(v: NodeView, x: number, y: number, z: number) {
    for (const [b, k] of [[neuronB[v.variant]!.at.iPos, v.slotN], [haloB.at.iPos, v.slotH]] as const) {
      if (k < 0) continue;
      b.array[k * 4] = x; b.array[k * 4 + 1] = y; b.array[k * 4 + 2] = z;
      b.needsUpdate = true;
    }
  }
  /** the words of a piece changed in place (same layout) */
  const retext = (n: GNode) => {
    const v = nodeViews.get(n);
    if (!v) return;
    const nm = short(n.label, 30);
    if (v.name.text !== nm) v.name.text = nm;
    if (v.what) { const w = short(n.short ?? '', 46); if (v.what.text !== w) v.what.text = w; }
  };

  // ── an axon: the shader draws the curve; the picking walks the same curve on the CPU ──
  interface LinkView {
    key: string; kind: string; obj: T3.Object3D; slot: number; A: T3.Vector3; B: T3.Vector3; pts: Float32Array; center: T3.Vector3; rad: number; ready: boolean;
    bend: number; offset: number; lvl: number; run: number; hi: number; dim: number; pulse: number; w: number;
    /** its signal travels: painted every frame even with its values at rest */
    busy: boolean;
  }
  const linkViews = new WeakMap<object, LinkView>();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _s = new THREE.Sphere();
  function axonRaycast(this: T3.Object3D, rc: T3.Raycaster, hits: T3.Intersection[]) {
    const v = this.userData.view as LinkView | undefined;
    if (!v?.ready || !this.visible || (v.kind === 'vivo' && v.lvl < 0.05)) return;
    const cam = rc.camera as T3.PerspectiveCamera | undefined;
    const perPx = cam?.isPerspectiveCamera ? (2 * Math.tan((cam.fov * Math.PI) / 360) * rc.ray.origin.distanceTo(v.center)) / Math.max(1, el.clientHeight) : 1;
    const thr = Math.max(v.w / 2, 4 * perPx);
    _s.center.copy(v.center); _s.radius = v.rad + thr;
    if (!rc.ray.intersectsSphere(_s)) return;
    let best = Infinity;
    for (let i = 0; i < AXON_SEG; i++) {
      _a.fromArray(v.pts, i * 3); _b.fromArray(v.pts, i * 3 + 3);
      if (rc.ray.distanceSqToSegment(_a, _b, undefined, _q) < thr * thr) { const d = rc.ray.origin.distanceTo(_q); if (d < best) { best = d; _p.copy(_q); } }
    }
    if (best < Infinity) hits.push({ distance: best, point: _p.clone(), object: this });
  }
  const writeEnds = (v: LinkView) => {
    if (v.slot < 0) return;
    const at = axonB.at, a = at.iA.array, b = at.iB.array, i = v.slot * 3;
    a[i] = v.A.x; a[i + 1] = v.A.y; a[i + 2] = v.A.z; b[i] = v.B.x; b[i + 1] = v.B.y; b[i + 2] = v.B.z;
    at.iA.needsUpdate = at.iB.needsUpdate = true;
  };
  const makeLink = (l: GLink): T3.Object3D => {
    const key = lk(l);
    const obj = new THREE.Object3D();
    obj.visible = false; // until the layout gives its ends
    const old = linkViews.get(l);
    const v: LinkView = {
      key, kind: l.kind, obj, slot: -1, A: new THREE.Vector3(), B: new THREE.Vector3(), pts: new Float32Array((AXON_SEG + 1) * 3), center: new THREE.Vector3(), rad: 0, ready: false,
      bend: axonBend(key), offset: (key.length * 0.137) % 1, lvl: old?.lvl ?? 0, run: old?.run ?? 0, hi: old?.hi ?? 0, dim: old?.dim ?? 0, pulse: 0, w: 1, busy: false,
    };
    obj.userData.view = v;
    gate(obj, axonRaycast);
    // a slot in the batch while the link is in the scene
    obj.addEventListener('added', () => { if (v.slot < 0) { v.slot = axonB.take(); writeEnds(v); paintLink(v, frameNow); } });
    obj.addEventListener('removed', () => { if (v.slot >= 0) { axonB.drop(v.slot); v.slot = -1; } });
    linkViews.set(l, v);
    paintLink(v, 0);
    return obj;
  };
  /** the layout moved the ends of an axon: new uniforms and the curve the picking walks (same math as the shader) */
  const placeLink = (obj: T3.Object3D, pos: { start: { x: number; y?: number; z?: number }; end: { x: number; y?: number; z?: number } }, l: GLink): boolean => {
    const v = linkViews.get(l);
    if (!v) return false;
    const A = v.A.set(pos.start.x, pos.start.y ?? 0, pos.start.z ?? 0);
    const B = v.B.set(pos.end.x, pos.end.y ?? 0, pos.end.z ?? 0);
    writeEnds(v);
    _a.subVectors(B, A);
    const L = _a.length();
    _b.set(0, 0, 1);
    if (!(Math.abs(_a.z) < 0.9 * L)) _b.set(0, 1, 0);
    _c.crossVectors(_a, _b);
    const nl = _c.length();
    if (nl > 1e-5) _c.multiplyScalar(1 / nl); else _c.set(0, 0, 0);
    _c.multiplyScalar(v.bend * L).add(_p.addVectors(A, B).multiplyScalar(0.5)); // the control point
    for (let i = 0; i <= AXON_SEG; i++) {
      const s = i / AXON_SEG, u = 1 - s;
      v.pts[i * 3] = u * u * A.x + 2 * u * s * _c.x + s * s * B.x;
      v.pts[i * 3 + 1] = u * u * A.y + 2 * u * s * _c.y + s * s * B.y;
      v.pts[i * 3 + 2] = u * u * A.z + 2 * u * s * _c.z + s * s * B.z;
    }
    v.center.copy(_c).add(A).add(B).multiplyScalar(1 / 3);
    v.rad = Math.max(v.center.distanceTo(A), v.center.distanceTo(B), v.center.distanceTo(_c));
    v.ready = true;
    obj.visible = true;
    paintLink(v, frameNow); // the signal keeps its place while the layout moves
    return true;
  };

  // ── each frame: every animated value eases towards its target; returns true while something still moves ──
  const W = ess ? { base: 0.4, flow: 1.1, hi: 3.2, liveRun: 2.6, liveIdle: 1.4 } : { base: 0.4, flow: 0.7, hi: 2.2, liveRun: 1.4, liveIdle: 0.8 };
  const _col = new THREE.Color();
  function paintNode(v: NodeView, now: number): boolean {
    const b = v.run > 0 && !still ? breath(now, v.phase) * v.run : 0;
    const s = v.r * (0.35 + 0.65 * v.grow);
    v.neuron.scale.setScalar(s);
    if (v.slotN >= 0) {
      const N = neuronB[v.variant]!.at, i = v.slotN * 4;
      _col.copy(v.base).lerp(v.dimC, v.dim);
      N.iPos.array[i + 3] = s;
      N.iCol.array[i] = _col.r; N.iCol.array[i + 1] = _col.g; N.iCol.array[i + 2] = _col.b; N.iCol.array[i + 3] = v.lit;
      N.iBreath.array[v.slotN] = b;
      N.iPos.needsUpdate = N.iCol.needsUpdate = N.iBreath.needsUpdate = true;
    }
    if (v.slotH >= 0) {
      // the halo: a faint glow of its own color at rest, the live light while at work (breathing while the call runs)
      const H = haloB.at, i = v.slotH * 4;
      _col.copy(v.layer).lerp(GLOW, Math.min(1, v.lit * 1.5));
      H.iCol.array[i] = _col.r; H.iCol.array[i + 1] = _col.g; H.iCol.array[i + 2] = _col.b;
      H.iCol.array[i + 3] = v.grow * (0.14 * (1 - 0.85 * v.dim) + v.lit * (0.45 + 0.25 * b));
      H.iPos.array[i + 3] = v.r * (2.5 + v.lit * (2.2 + 0.6 * b)) * v.grow;
      H.iPos.needsUpdate = H.iCol.needsUpdate = true;
    }
    // labels: the pieces out of a lit path step back, the ones on it step forward
    v.name.material.opacity = v.grow * (1 - 0.62 * v.dim);
    if (v.what) { v.what.material.opacity = v.grow * (1 - v.dim); v.what.visible = v.dim < 0.98; }
    v.labels.scale.setScalar(1 + 0.2 * v.focus);
    return v.run > 0 && !still; // breathing: keeps the loop going
  }
  function paintLink(v: LinkView, now: number): boolean {
    let alpha: number, w: number, minPx: number, pc: T3.Color, pulse: number, head: number;
    if (v.kind === 'vivo') {
      _col.copy(LINK_LIVE);
      alpha = (0.25 + 0.7 * v.lvl) * Math.min(1, v.lvl * 8);
      w = (W.liveIdle + (W.liveRun - W.liveIdle) * v.run) * (0.5 + 0.5 * v.lvl);
      minPx = 1.5 + v.run;
      pc = GLOW;
      pulse = still ? 0 : v.run * v.lvl;
      head = pulseHead(now, 1300, v.offset);
    } else {
      const flow = v.kind === 'flusso';
      _col.copy(flow ? LINK_FLOW : LINK_BASE).lerp(LINK_DIM, v.dim).lerp(ACCENT, v.hi);
      const a0 = flow ? 0.55 : 0.32;
      alpha = a0 + (0.6 - a0) * v.dim + (0.95 - a0) * v.hi - (0.6 - a0) * v.dim * v.hi;
      w = (flow ? W.flow : W.base) + (W.hi - (flow ? W.flow : W.base)) * v.hi;
      minPx = (flow ? 1.6 : 1.3) + 1.2 * v.hi;
      pc = PULSE_PATH;
      pulse = still ? 0 : v.pulse;
      head = pulseHead(now, 1700, v.offset);
    }
    v.w = w * 1.4;
    const shown = v.ready && alpha > 0.004;
    if (v.obj.visible !== shown) pickMoved = true; // an axon came or went: the hover picking must look again
    v.obj.visible = shown;
    const s = v.slot;
    if (s >= 0) {
      const at = axonB.at, sh = at.iShape.array, c = at.iCol.array, p = at.iPul.array, i = s * 4;
      sh[i] = w * 1.4; sh[i + 1] = w * 0.45; sh[i + 2] = minPx; sh[i + 3] = v.bend;
      c[i] = _col.r; c[i + 1] = _col.g; c[i + 2] = _col.b; c[i + 3] = shown ? alpha : 0;
      p[i] = pc.r; p[i + 1] = pc.g; p[i + 2] = pc.b; p[i + 3] = pulse;
      at.iHead.array[s] = head;
      at.iShape.needsUpdate = at.iCol.needsUpdate = at.iPul.needsUpdate = at.iHead.needsUpdate = true;
    }
    return pulse > 0.001 && shown;
  }
  function animate(now: number, dt: number): boolean {
    const gd = graph.graphData(), dimmed = hi.size > 0, since = now - lvAt, pathOn = now < pathPulseUntil;
    let moving = false;
    const nodes = gd.nodes as GNode[];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!, v = nodeViews.get(n);
      if (!v) continue;
      const g = lv.glow.get(n.id);
      const litT = g ? liveTarget(g.level, g.running, since, FADE_MS) : 0, runT = g?.running ? 1 : 0;
      const dimT = dimmed && !hi.has(n.id) ? 1 : 0, focusT = dimmed && hi.has(n.id) ? 1 : 0;
      // at rest (every value on its target, not breathing): nothing to paint
      if (!v.busy && v.lit === litT && v.run === runT && v.dim === dimT && v.focus === focusT && v.grow === 1) continue;
      v.lit = approach(v.lit, litT, dt, tauFor(v.lit, litT));
      v.run = approach(v.run, runT, dt, 300);
      v.dim = approach(v.dim, dimT, dt, 220);
      v.focus = approach(v.focus, focusT, dt, 220);
      v.grow = approach(v.grow, 1, dt, 260);
      v.busy = paintNode(v, now);
      if (v.busy || v.lit !== litT || v.dim !== dimT || v.focus !== focusT || v.grow !== 1 || v.run !== runT) moving = true;
    }
    const links = gd.links as GLink[];
    for (let i = 0; i < links.length; i++) {
      const l = links[i]!, v = linkViews.get(l);
      if (!v) continue;
      let lvlT = 0, runT = 0;
      if (v.kind === 'vivo') { const x = lv.links.get(v.key); if (x) { lvlT = liveTarget(x.level, x.running, since, FADE_MS); runT = x.running ? 1 : 0; } }
      const on = hiL.has(v.key), hiT = on ? 1 : 0, dimT = hiL.size && !on ? 1 : 0, pulseT = on && pathOn ? 1 : 0;
      // at rest (values on their targets, no signal travelling): its slot keeps what it has, nothing is uploaded
      if (!v.busy && v.lvl === lvlT && v.run === runT && v.hi === hiT && v.dim === dimT && v.pulse === pulseT) continue;
      v.lvl = approach(v.lvl, lvlT, dt, tauFor(v.lvl, lvlT));
      v.run = approach(v.run, runT, dt, 300);
      v.hi = approach(v.hi, hiT, dt, 220);
      v.dim = approach(v.dim, dimT, dt, 220);
      v.pulse = approach(v.pulse, pulseT, dt, 400);
      v.busy = paintLink(v, now);
      if (v.busy || v.lvl !== lvlT || v.run !== runT || v.hi !== hiT || v.dim !== dimT || v.pulse !== pulseT) moving = true;
    }
    return moving;
  }

  let fitted = false;
  const lkey = layoutKey(ess, o.nodes);
  const known = layouts.get(lkey);
  const seeded = !!known && baseIds(o.nodes).every(id => known.has(id));
  const cam = seeded ? cameras.get(lkey) : undefined;
  const anchors = ess ? ANCHOR_ESSENTIAL : ANCHOR_FULL;
  /** a node new to a laid-out map starts near its layer, not in the middle of everything */
  const near = (n: MapNode): GNode => {
    const a = anchors[n.layer] ?? [0, 0, 0], j = () => (Math.random() - 0.5) * (ess ? 160 : 40);
    return { ...n, x: a[0] + j(), y: a[1] + j(), z: a[2] + j() / 4 };
  };
  const seed = (n: MapNode): GNode => { const p = seeded ? known!.get(n.id) : undefined; return p ? { ...n, x: p[0], y: p[1], z: p[2] } : seeded ? near(n) : { ...n }; };
  const remember = () => {
    const pos = new Map<string, [number, number, number]>();
    for (const n of graph.graphData().nodes as GNode[]) if (n.x != null) pos.set(n.id, [n.x, n.y ?? 0, n.z ?? 0]);
    if (pos.size) layouts.set(layoutKey(ess, graph.graphData().nodes as GNode[]), pos);
  };
  let sig = dataSig(o.nodes, o.edges), details = detailSig(o.nodes, o.edges);

  // ── the render loop: ours, one frame per display frame while needed, nothing at rest ──
  let alive = true, settling = true, awakeUntil = 0, raf = 0, lastDraw = 0, lastInput = 0, inFrame = false, frameNow = 0;
  /** the map's own nodes held still while only live nodes find their place */
  let pinned: GNode[] = [];
  const pin = (ns: GNode[]) => { for (const n of ns) if (!isLive(n.id) && n.x != null) Object.assign(n, { fx: n.x, fy: n.y, fz: n.z }); pinned = ns.filter(n => !isLive(n.id)); };
  const unpin = () => { for (const n of pinned) { const f = n as { fx?: number; fy?: number; fz?: number }; delete f.fx; delete f.fy; delete f.fz; } pinned = []; };
  /** one frame of the library (layout tick, controls, camera tween, hover, draw), its own loop staying off */
  const step = () => { graph.resumeAnimation(); graph.pauseAnimation(); };
  const loop = () => {
    raf = 0;
    if (!alive || document.hidden) return;
    const now = t();
    if (now - lastDraw < UNFOCUSED_MS && now - lastInput > 1500 && !document.hasFocus()) { raf = requestAnimationFrame(loop); return; }
    const dt = Math.min(64, now - lastDraw);
    lastDraw = now;
    frameNow = now;
    const moving = animate(now, dt);
    // inside the frame the library calls back (controls 'change', onEngineStop): kick() must not start a second loop
    pickFresh = pickMoved || settling;
    inFrame = true;
    try { step(); } finally { inFrame = false; }
    if (picked) { picked = false; pickMoved = false; }
    if (!raf && (settling || moving || now < awakeUntil)) raf = requestAnimationFrame(loop);
  };
  /** make sure a frame comes (the loop then keeps going while something moves) */
  const kick = () => { if (!raf && !inFrame && alive && !document.hidden) { lastDraw = t() - 16; raf = requestAnimationFrame(loop); } };
  /** keep drawing for at least `ms` more (the loop stops by itself afterwards) */
  const wake = (ms: number) => { awakeUntil = Math.max(awakeUntil, t() + ms); kick(); };
  const before = new Set(el.children);
  const graph = new ForceGraph3D(el, { controlType: 'orbit' });
  graph.pauseAnimation(); // the library's own loop would draw 60 frames a second forever
  graph.scene().add(haloB.mesh, ...neuronB.map(b => b.mesh), axonB.mesh);
  // what this engine added to the container (canvas, tooltip, nav info): the only nodes destroy() removes, so a newer
  // engine already mounted in the same container is never wiped by an older one finishing late
  const mine = [...el.children].filter(c => !before.has(c));
  // the canvas never needs more than 1.5 device pixels per CSS pixel (the cost grows with the square)
  graph.renderer().setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  graph
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor('rgba(0,0,0,0)').showNavInfo(false).enableNodeDrag(false)
    // reopened: the remembered layout is pinned; only live newcomers need a short settle
    .warmupTicks(seeded ? 0 : ess ? 160 : 60).cooldownTicks(seeded ? (o.nodes.some(n => isLive(n.id)) ? 120 : 1) : ess ? 120 : 260).cooldownTime(seeded ? 2000 : 60000)
    .onEngineStop(() => {
      if (!settling) return;
      settling = false;
      unpin();
      // the short settle is only for the remembered layout: later changes (a layer back on) settle fully
      graph.cooldownTicks(ess ? 120 : 260).cooldownTime(60000);
      growIn = true;
      remember();
      if (fitted) { wake(300); return; }
      fitted = true;
      if (o.focus) api.lookAt(o.focus, ess ? 320 : 200); else view(graph.graphData().nodes as GNode[], 0, 900);
    })
    .nodeId('id')
    .nodeLabel(n => nodeCard(n as GNode, o.root ?? ''))
    .nodeThreeObject(n => makeNode(n as GNode)).nodeThreeObjectExtend(false)
    .linkThreeObject(l => makeLink(l as GLink)).linkThreeObjectExtend(false)
    .nodePositionUpdate((_obj, pos, n) => { const v = nodeViews.get(n); if (v) placeNode(v, pos.x, pos.y ?? 0, pos.z ?? 0); return false; })
    .linkPositionUpdate((obj, pos, l) => placeLink(obj, pos as Parameters<typeof placeLink>[1], l as GLink))
    .linkLabel(l => esc((l as GLink).label))
    .onNodeClick(n => o.onNode((n as GNode).id))
    .onLinkClick(l => { const g = l as GLink; o.onLink({ from: endId(g.source), to: endId(g.target), kind: g.kind, label: g.label, source: g.proof, count: g.count }); })
    .onBackgroundClick(() => o.onBackground())
    .graphData({ nodes: o.nodes.map(seed), links: toLinks(o.edges) });
  if (seeded) pin(graph.graphData().nodes as GNode[]); // the remembered layout holds still; only newcomers move
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
  if (cam) {
    // reopened: the same picture at once, no flight
    graph.cameraPosition({ x: cam.p[0], y: cam.p[1], z: cam.p[2] }, { x: cam.t[0], y: cam.t[1], z: cam.t[2] }, 0);
    fitted = true;
    if (o.focus) setTimeout(() => api.lookAt(o.focus!, ess ? 320 : 200), 0);
  } else graph.cameraPosition({ x: 0, y: -60, z: ess ? 1700 : 520 });
  // a first fit as soon as the warm-up layout is drawn, the final one when the layout stops moving
  const early = setTimeout(() => { if (!fitted && !o.focus) view(graph.graphData().nodes as GNode[], 0, 400); }, seeded ? 0 : 450);
  const ro = new ResizeObserver(() => { if (el.clientWidth && el.clientHeight) { viewH.value = el.clientHeight; graph.width(el.clientWidth).height(el.clientHeight); wake(300); } });
  ro.observe(el);

  // what moves the picture: the user (drag, wheel, hover for the tooltips), the orbit's damping, the window coming back
  const controls = graph.controls() as unknown as { addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };
  // the orbit's damping keeps sending tiny changes long after the hand left: they count only just after a real input
  const onDown = () => { lastInput = t(); wake(2000); }, onUp = () => { lastInput = t(); wake(1200); };
  const onHover = () => { pickMoved = true; if (!pointerOn) onEnter(); wake(700); };
  const onChange = () => { pickMoved = true; if (t() - lastInput < 1200) wake(500); };
  const onVis = () => { if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } } else wake(600); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('wheel', onDown, { passive: true });
  el.addEventListener('pointermove', onHover);
  el.addEventListener('pointerup', onUp);
  // hover picking only with the pointer on the map (the library raycasts every 50 ms while frames run)
  let pointerOn = false;
  function onEnter() { if (!pointerOn) { pointerOn = true; pickMoved = true; graph.enablePointerInteraction(true); } }
  const onLeave = () => { if (pointerOn) { pointerOn = false; graph.enablePointerInteraction(false); } };
  graph.enablePointerInteraction(false);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  controls.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onVis);
  // focus back: full rate again (a throttled loop picks it up at its next frame)
  window.addEventListener('focus', kick);
  // the GPU came back (sleep, driver reset) while the loop rests: nothing would redraw the restored canvas
  const glCanvas = graph.renderer().domElement;
  const onRestored = () => wake(600);
  glCanvas.addEventListener('webglcontextrestored', onRestored);
  wake(1500);

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
    const Wd = Math.max(200, el.clientWidth - ins.left - ins.right - 48), H = Math.max(200, el.clientHeight - 110);
    const fov = ((graph.camera() as unknown as { fov?: number }).fov ?? 40) * Math.PI / 180, tn = Math.tan(fov / 2);
    const zTop = Math.max(...zs), cz = (Math.min(...zs) + zTop) / 2;
    // distance at which h world units fill H px (and w fill W px), measured from the nearest nodes
    const d = Math.max(minDist, (h / 2 / tn) * (el.clientHeight / H), (w / 2 / tn) * (el.clientHeight / Wd)) + (zTop - cz);
    const perPx = (2 * d * tn) / el.clientHeight;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2 - ((ins.left - ins.right) / 2) * perPx, cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 10 * perPx;
    const dur = still ? 0 : ms; // reduced motion: the camera jumps, it does not fly
    graph.cameraPosition({ x: cx, y: cy, z: cz + d }, { x: cx, y: cy, z: cz }, dur);
    wake(dur + 200);
  }
  function toLinks(edges: MapEdge[]): GLink[] { return edges.map(({ source: proof, ...e }) => ({ ...e, proof, source: e.from, target: e.to })); }
  const api: Engine = {
    // a lit path sends signals along its axons for a few seconds, then the picture rests (the path stays lit)
    setHighlight(nodes, links) { hi = nodes; hiL = links; pathPulseUntil = links.size ? t() + PATH_PULSE_MS : 0; kick(); },
    setData(nodes, edges) {
      const next = dataSig(nodes, edges);
      const nextDetails = detailSig(nodes, edges);
      if (next === sig) {
        // the same graph again (a refetch, the first sync): no new layout; changed words are copied in place
        if (nextDetails === details) return;
        details = nextDetails;
        const byKey = new Map(edges.map(e => [edgeKey(e.from, e.to, e.kind), e]));
        for (const l of graph.graphData().links as GLink[]) { const e = byKey.get(lk(l)); if (e) Object.assign(l, { label: e.label, proof: e.source, count: e.count }); }
        const byId = new Map(nodes.map(n => [n.id, n]));
        for (const n of graph.graphData().nodes as GNode[]) { const x = byId.get(n.id); if (x) { Object.assign(n, x); retext(n); } }
        wake(100);
        return;
      }
      sig = next;
      details = nextDetails;
      const cur = graph.graphData().nodes as GNode[];
      const old = new Map(cur.map(n => [n.id, n]));
      // only live nodes came or went on a settled map: the rest holds still, the newcomers find their place
      if (!settling && baseIds(cur).join(',') === baseIds(nodes).join(',')) {
        unpin(); pin(cur);
        graph.cooldownTicks(60); // only the newcomers move: a short settle (restored when it stops)
      }
      // a link that stays keeps its object (the library keys objects by identity: its axon and material stay, the
      // shader program is never released and recompiled); only new links get a new object
      const prev = new Map((graph.graphData().links as GLink[]).map(l => [lk(l), l]));
      const links = toLinks(edges).map(l => { const p = prev.get(lk(l)); return p ? Object.assign(p, { label: l.label, proof: l.proof, count: l.count }) : l; });
      graph.graphData({ nodes: nodes.map(n => old.get(n.id) ?? (old.size ? near(n) : { ...n })), links });
      settling = true;
      kick();
    },
    setLive(l) {
      lv = l ?? { glow: new Map(), links: new Map() };
      lvAt = t();
      // a frame only when a target changed (a snapshot of chats that just wait changes nothing)
      const ls = [...lv.glow, ...lv.links].map(([k, g]) => `${k}:${g.running ? 'r' : g.level.toFixed(3)}`).join(',');
      if (ls !== lvSig) { lvSig = ls; kick(); }
    },
    lookAt(id, dist) { api.frame([id], dist); },
    frame(ids, minDist) { view((graph.graphData().nodes as GNode[]).filter(x => ids.includes(x.id)), minDist, 1100); },
    fit() { view(graph.graphData().nodes as GNode[], 0, 700); },
    destroy() {
      alive = false;
      if (!settling) remember();
      if (fitted && !settling) {
        const c = graph.camera().position, tg = (graph.controls() as unknown as { target: { x: number; y: number; z: number } }).target;
        cameras.set(layoutKey(ess, graph.graphData().nodes as GNode[]), { p: [c.x, c.y, c.z], t: [tg.x, tg.y, tg.z] });
      }
      clearTimeout(early);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('wheel', onDown);
      el.removeEventListener('pointermove', onHover);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', kick);
      glCanvas.removeEventListener('webglcontextrestored', onRestored);
      try { controls.removeEventListener('change', onChange); } catch { /* gone */ }
      try { graph.pauseAnimation(); graph._destructor(); } catch { /* already gone */ }
      for (const s of shared) s.dispose();
      try { graph.renderer().dispose(); graph.renderer().forceContextLoss(); } catch { /* none */ }
      for (const c of mine) c.remove();
    },
  };
  return api;
}
