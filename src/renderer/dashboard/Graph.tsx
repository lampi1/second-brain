// SVG network with searchable, keyboard-accessible nodes and a focused inspector supplied by Dashboard.
// Data coordinates are stable between live updates; the CSS pulse represents observed recent messages only.
// The map's own commands live inside its frame (owner, 18/10: «i comandi devono stare dentro la mappa»): an optional
// floating toolbar on top (search, overview, 3D: supplied by Dashboard) and a footer with the legend and the zoom group.
// The drawing is measured (ResizeObserver) and drawn 1 SVG unit = 1 CSS pixel: the layout is fitted to the panel's own
// size and aspect (fitLayout), so the map fills the panel centred at any width, and labels are placed at their real size
// inside it (minor ones that find no free spot are hidden, never overlapped). "Adatta" drops zoom and selection and
// re-measures, so the whole map is fitted again (issue #77).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../i18n';
import { fitLayout, layout, placeLabels } from './data';
import { labelCandidates, nodeStyle } from './graph-style';

export interface GraphNode { id: string; label: string; detail: string; kind?: string; layer?: string; active?: boolean; central?: boolean }
export interface GraphEdge { from: string; to: string; active?: boolean }
export function Graph({ nodes, edges, selected, onSelect, label, toolbar, legend, empty, testId }: {
  nodes: GraphNode[]; edges: GraphEdge[]; selected: string | null; onSelect: (id: string) => void; label: string;
  /** commands drawn on the map's top edge, inside its frame */ toolbar?: ReactNode;
  /** the key drawn on the map's bottom-left corner */ legend?: ReactNode;
  /** shown in place of the drawing when there are no nodes (the toolbar stays, e.g. to clear a search) */ empty?: ReactNode; testId?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const select = (id: string) => { setZoom(1); onSelect(id); };
  // the drawing area's size in CSS pixels; 800x520 until the first measure (and in a non-DOM render)
  const canvas = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const measure = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
    if (w > 0 && h > 0) setSize(old => old.w === w && old.h === h ? old : { w, h });
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, nodes.length > 0]);
  const identity = nodes.map(n => n.id).join('|');
  const topology = edges.map(e => `${e.from}|${e.to}`).join(';');
  const raw = useMemo(() => layout(nodes, edges, nodes.find(n => n.central)?.id), [identity, topology]);
  const dense = nodes.length > 14;
  // a crowded small panel draws smaller halos and allows closer dots (spacing = the panel's area per node)
  const spacing = Math.sqrt(size.w * size.h / Math.max(1, nodes.length));
  const halo = dense ? Math.min(11, Math.max(6, spacing * .22)) : 20;
  const radius = (n: GraphNode) => n.central ? 38 : halo;
  // room around the nodes for halos and the labels of the outermost ones (labels move inward when they would not fit)
  const pad = dense ? { x: 44, y: 34 } : { x: 90, y: 56 };
  const points = useMemo(() => fitLayout(raw, size.w, size.h, pad, dense ? Math.min(26, spacing * .55) : 48), [raw, size.w, size.h, dense, spacing]);
  const focus = selected ? points.get(selected) : undefined;
  const near = useMemo(() => new Set(selected ? edges.flatMap(e => e.from === selected ? [e.to] : e.to === selected ? [e.from] : []) : []), [selected, topology]);
  // Visible labels sit on a top layer with a backdrop, each on a free side of its node: selected first, then neighbours.
  const spots = useMemo(() => {
    const shown = labelCandidates(nodes, edges, selected);
    const order = [...shown].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(!!b.central) - Number(!!a.central));
    const at = (n: GraphNode) => ({ ...points.get(n.id)!, r: radius(n) });
    return placeLabels(order.map(n => ({ id: n.id, ...at(n), text: n.label })), nodes.map(n => ({ ...points.get(n.id)!, r: n.central ? 23 : n.kind ? nodeStyle(n.kind, n.layer).radius + 2 : dense ? 6 : radius(n) * .6 })), 14,
      focus ?? points.get(nodes.find(n => n.central)?.id ?? '') ?? { x: size.w / 2, y: size.h / 2 },
      { bounds: { x0: 10, y0: 8, x1: size.w - 10, y1: size.h - 8 }, required: new Set(selected ? [selected] : []) });
  }, [points, selected, near, dense, nodes, size.w, size.h]);
  // Zoom narrows the panel-sized view around the selected node (or the centre), never past the map's edges.
  const box = { x: 0, y: 0, w: size.w, h: size.h };
  const width = box.w / zoom, height = box.h / zoom;
  const x = Math.max(box.x, Math.min(box.x + box.w - width, (focus?.x ?? box.x + box.w / 2) - width / 2));
  const y = Math.max(box.y, Math.min(box.y + box.h - height, (focus?.y ?? box.y + box.h / 2) - height / 2));
  return <div className={`dash-graph ${dense ? 'dense' : ''} ${selected ? 'focused' : ''}`} data-testid={testId}>
    {toolbar && <div className="dash-map-toolbar" data-testid="dash-map-toolbar" role="toolbar" aria-label={t('brainText.graph.commands')}>{toolbar}</div>}
    {nodes.length ? <div className="dash-graph-canvas" ref={canvas}><svg viewBox={`${x} ${y} ${width} ${height}`} role="group" aria-label={label} data-size={`${size.w}x${size.h}`}>
      <defs><radialGradient id="dash-aura"><stop stopColor="var(--blue)" stopOpacity=".13" /><stop offset="1" stopColor="var(--blue)" stopOpacity="0" /></radialGradient></defs>
      <circle cx={size.w / 2} cy={size.h / 2} r={Math.min(size.w, size.h) * .48} fill="url(#dash-aura)" />
      <g aria-hidden="true">{edges.map((edge, i) => {
        const a = points.get(edge.from), b = points.get(edge.to);
        return a && b ? <path key={`${edge.from}-${edge.to}-${i}`} d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 + 18} ${(a.y + b.y) / 2 - 18} ${b.x} ${b.y}`} className={`dash-edge ${edge.active ? 'flow' : ''} ${selected && (edge.from === selected || edge.to === selected) ? 'lit' : ''}`} /> : null;
      })}</g>
      {nodes.map((node, i) => {
        const p = points.get(node.id)!;
        return <g key={node.id} transform={`translate(${p.x} ${p.y})`} className={`dash-node ${node.central ? 'central' : ''} ${node.active ? 'working' : ''} ${selected === node.id ? 'selected' : ''} ${near.has(node.id) ? 'near' : ''}`}
          style={{ '--node-color': nodeStyle(node.kind, node.layer).color } as CSSProperties} role="button" tabIndex={0} aria-label={`${node.label}: ${node.detail}`} aria-pressed={selected === node.id}
          onClick={() => select(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); } }}>
          <g className="dash-node-in" style={{ animationDelay: `${Math.min(i, 40) * 18}ms` }}>
          <title>{node.label}: {node.detail}</title>
          <circle className="dash-node-halo" r={radius(node)} />
          <circle className="dash-node-dot" r={node.central ? 23 : node.kind ? nodeStyle(node.kind, node.layer).radius : dense ? 4.5 : 8} />
          {node.central && <text className="dash-node-mark" y="5">O</text>}
          </g>
        </g>;
      })}
      <g className="dash-labels" aria-hidden="true">{nodes.map(node => {
        const spot = spots.get(node.id);
        if (!spot) return null;
        const x0 = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - spot.w : spot.x - spot.w / 2;
        return <g key={node.id} className={`dash-label ${selected === node.id ? 'selected' : ''}`}>
          <line x1={points.get(node.id)!.x} y1={points.get(node.id)!.y} x2={Math.max(x0, Math.min(x0 + spot.w, points.get(node.id)!.x))} y2={spot.y} stroke="var(--border-2)" />
          <rect x={x0} y={spot.y - spot.h / 2} width={spot.w} height={spot.h} rx={spot.h / 2} />
          <text x={spot.anchor === 'start' ? spot.x + 6 : spot.anchor === 'end' ? spot.x - 6 : spot.x} y={spot.y} textAnchor={spot.anchor} dominantBaseline="central">{node.label}</text>
        </g>;
      })}</g>
    </svg></div> : <div className="dash-graph-empty">{empty}</div>}
    <div className="dash-graph-foot">
      {legend ?? <span />}
      <div className="dash-zoom" role="group" aria-label="Zoom">
        <button type="button" className="dash-zoom-fit" title={t('brainText.graph.fitTip')} onClick={() => { setZoom(1); onSelect(''); measure(); }}><span aria-hidden="true">⤢</span>{t('brainText.graph.fit')}</button>
        <button type="button" aria-label={t('brainText.graph.zoomOut')} title={t('brainText.graph.zoomOut')} onClick={() => setZoom(z => Math.max(1, z - .5))} disabled={zoom === 1}>−</button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={t('brainText.graph.zoomIn')} title={t('brainText.graph.zoomIn')} onClick={() => setZoom(z => Math.min(3, z + .5))} disabled={zoom === 3}>+</button>
      </div>
    </div>
  </div>;
}
