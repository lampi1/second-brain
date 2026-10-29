// The layout of a mermaid flowchart, read from the SVG mermaid drew (ADR 0188): where each node, arrow, arrow label and
// group sits, so Impara's board (components/impara/LessonStage.tsx) draws the picture itself and can move a camera,
// light one arrow and send a light along it. Mermaid's markup is untrusted and is only parsed here, in an inert
// document (DOMParser: no script runs, nothing loads, nothing joins the page); what comes out is numbers and the plain
// text of the labels, drawn by React as text. Node ids are the ones the model wrote (mermaid's element ids are
// <svgId>-flowchart-<id>-<n>); an arrow's ends come from its data-id L_<from>_<to>_<n>, split against the known ids.
// Only translate() transforms exist in mermaid's flowcharts, so positions add up along the parents.

export interface FlowNode { id: string; x: number; y: number; w: number; h: number; shape: 'rect' | 'round' | 'diamond' | 'circle'; lines: string[] }
export interface FlowEdge { id: string; from: string; to: string; d: string; ox: number; oy: number; dashed: boolean; arrow: boolean; label?: { x: number; y: number; w: number; h: number; text: string } }
export interface FlowCluster { x: number; y: number; w: number; h: number; label: string }
export interface FlowLayout { width: number; height: number; nodes: FlowNode[]; edges: FlowEdge[]; clusters: FlowCluster[] }

const num = (v: string | null | undefined): number => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : 0; };

/** translate(a, b) / translate(a b) / translate(a) of an element, else 0,0 */
function shift(el: Element): [number, number] {
  const m = /translate\(\s*(-?[\d.e+-]+)(?:[\s,]+(-?[\d.e+-]+))?\s*\)/.exec(el.getAttribute('transform') ?? '');
  return m ? [num(m[1]), num(m[2])] : [0, 0];
}

/** The sum of the translates of an element's parents, up to the svg (its own not included). */
function offset(el: Element): [number, number] {
  let x = 0, y = 0;
  for (let p = el.parentElement; p && p.tagName.toLowerCase() !== 'svg'; p = p.parentElement) { const [a, b] = shift(p); x += a; y += b; }
  return [x, y];
}

/** All the coordinate pairs of a shape, in its node's frame (its own translate added). */
function points(shape: Element): [number, number][] {
  const [sx, sy] = shift(shape);
  const tag = shape.tagName.toLowerCase();
  if (tag === 'rect') {
    const x = num(shape.getAttribute('x')), y = num(shape.getAttribute('y')), w = num(shape.getAttribute('width')), h = num(shape.getAttribute('height'));
    return [[x + sx, y + sy], [x + w + sx, y + h + sy]];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = num(shape.getAttribute('cx')), cy = num(shape.getAttribute('cy'));
    const rx = num(shape.getAttribute('r') ?? shape.getAttribute('rx')), ry = num(shape.getAttribute('r') ?? shape.getAttribute('ry'));
    return [[cx - rx + sx, cy - ry + sy], [cx + rx + sx, cy + ry + sy]];
  }
  const raw = tag === 'polygon' ? shape.getAttribute('points') ?? '' : shape.getAttribute('d') ?? '';
  const nums = (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]! + sx, nums[i + 1]! + sy]);
  return out;
}

const rowsOf = (el: Element | null): string[] => (el ? [...el.querySelectorAll('tspan.row')].map(r => (r.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean) : []);

/** The ends of an arrow from its data-id (L_from_to_n), split where both halves are known node ids. */
export function edgeEnds(dataId: string, ids: ReadonlySet<string>): { from: string; to: string } | null {
  const core = dataId.replace(/^L_/, '').replace(/_\d+$/, '');
  for (let i = core.indexOf('_'); i > 0; i = core.indexOf('_', i + 1)) {
    const from = core.slice(0, i), to = core.slice(i + 1);
    if (ids.has(from) && ids.has(to)) return { from, to };
  }
  return null;
}

/** The layout of the flowchart in `svg` (mermaid's markup for the render id `svgId`), with (0,0) at the top left of
 *  its viewBox; null when it holds no node (not a flowchart, or nothing drawn). */
export function parseFlowLayout(svg: string, svgId: string): FlowLayout | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root || doc.querySelector('parsererror')) return null;
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const [vx, vy, width, height] = vb.length === 4 && vb.every(Number.isFinite) ? vb as [number, number, number, number] : [0, 0, 0, 0];
  if (!(width > 0 && height > 0)) return null;
  const prefix = `${svgId}-flowchart-`;
  const nodes: FlowNode[] = [];
  for (const g of root.querySelectorAll('g.node')) {
    const raw = g.getAttribute('id') ?? '';
    if (!raw.startsWith(prefix)) continue;
    const id = raw.slice(prefix.length).replace(/-\d+$/, '');
    const shape = [...g.children].find(c => /^(rect|polygon|path|circle|ellipse)$/i.test(c.tagName) || c.classList.contains('label-container'));
    const el = shape && shape.tagName.toLowerCase() === 'g' ? shape.querySelector('path, rect, polygon, circle, ellipse') : shape;
    if (!el) continue;
    const pts = points(el);
    if (!pts.length) continue;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [ox, oy] = offset(g), [nx, ny] = shift(g);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const tag = el.tagName.toLowerCase();
    const kind: FlowNode['shape'] = tag === 'polygon' && pts.length === 4 ? 'diamond' : tag === 'circle' ? 'circle' : tag === 'path' ? 'round' : 'rect';
    nodes.push({ id, x: ox + nx + (minX + maxX) / 2 - vx, y: oy + ny + (minY + maxY) / 2 - vy, w: maxX - minX, h: maxY - minY, shape: kind, lines: rowsOf(g.querySelector('g.label')) });
  }
  if (!nodes.length) return null;
  const ids = new Set(nodes.map(n => n.id));
  const labels = new Map<string, NonNullable<FlowEdge['label']>>();
  for (const g of root.querySelectorAll('g.edgeLabel')) {
    const inner = g.querySelector('g.label[data-id]');
    const text = rowsOf(g).join(' ');
    if (!inner || !text) continue;
    const bg = inner.querySelector('rect.background') ?? inner.querySelector('rect');
    const [ox, oy] = offset(g), [ex, ey] = shift(g), [ix, iy] = shift(inner);
    const w = num(bg?.getAttribute('width')), h = num(bg?.getAttribute('height'));
    const x = num(bg?.getAttribute('x')), y = num(bg?.getAttribute('y'));
    labels.set(inner.getAttribute('data-id')!, { x: ox + ex + ix + x + w / 2 - vx, y: oy + ey + iy + y + h / 2 - vy, w, h, text });
  }
  const edges: FlowEdge[] = [];
  for (const p of root.querySelectorAll('path.flowchart-link')) {
    const dataId = p.getAttribute('data-id') ?? (p.getAttribute('id') ?? '').replace(`${svgId}-`, '');
    const ends = edgeEnds(dataId, ids), d = p.getAttribute('d') ?? '';
    if (!ends || !d || !/^[MLCQZHVSTA\d\s.,eE+-]+$/i.test(d)) continue;
    const [ox, oy] = offset(p), cls = p.getAttribute('class') ?? '';
    const label = labels.get(dataId);
    edges.push({ id: dataId, ...ends, d, ox: ox - vx, oy: oy - vy, dashed: /edge-pattern-(dotted|dashed)/.test(cls), arrow: !!p.getAttribute('marker-end'), ...(label ? { label } : {}) });
  }
  const clusters: FlowCluster[] = [];
  for (const g of root.querySelectorAll('g.cluster')) {
    const r = g.querySelector(':scope > rect');
    if (!r) continue;
    const [ox, oy] = offset(r);
    clusters.push({ x: ox + num(r.getAttribute('x')) - vx, y: oy + num(r.getAttribute('y')) - vy, w: num(r.getAttribute('width')), h: num(r.getAttribute('height')), label: rowsOf(g.querySelector('.cluster-label')).join(' ') });
  }
  return { width, height, nodes, edges, clusters };
}
