// SVG network with searchable, keyboard-accessible nodes and a focused inspector supplied by Dashboard.
// Data coordinates are stable between live updates; the CSS pulse represents observed recent messages only.
import { useMemo, useState } from 'react';
import { lang } from '../i18n';
import { layout, placeLabels } from './data';

export interface GraphNode { id: string; label: string; detail: string; active?: boolean; central?: boolean }
export interface GraphEdge { from: string; to: string; active?: boolean }
export function Graph({ nodes, edges, selected, onSelect, label }: {
  nodes: GraphNode[]; edges: GraphEdge[]; selected: string | null; onSelect: (id: string) => void; label: string;
}) {
  const [zoom, setZoom] = useState(1);
  const identity = nodes.map(n => n.id).join('|');
  const topology = edges.map(e => `${e.from}|${e.to}`).join(';');
  const points = useMemo(() => layout(nodes, edges, nodes.find(n => n.central)?.id), [identity, topology]);
  const focus = selected ? points.get(selected) : undefined;
  const near = useMemo(() => new Set(selected ? edges.flatMap(e => e.from === selected ? [e.to] : e.to === selected ? [e.from] : []) : []), [selected, topology]);
  const dense = nodes.length > 14;
  const radius = (n: GraphNode) => n.central ? 38 : dense ? 11 : 20;
  const short = (text: string) => text.length > 24 ? `${text.slice(0, 22)}…` : text;
  // Visible labels sit on a top layer with a backdrop, each on a free side of its node: selected first, then neighbours.
  const spots = useMemo(() => {
    const shown = dense ? nodes.filter(n => n.id === selected || near.has(n.id)) : nodes;
    const order = [...shown].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(!!b.central) - Number(!!a.central));
    const at = (n: GraphNode) => ({ ...points.get(n.id)!, r: radius(n) });
    return placeLabels(order.map(n => ({ id: n.id, ...at(n), text: short(n.label) })), nodes.map(n => ({ ...points.get(n.id)!, r: n.central ? 23 : dense ? 6 : radius(n) * .6 })), dense ? 14 : 11, focus ?? points.get(nodes.find(n => n.central)?.id ?? ''));
  }, [points, selected, near, dense, nodes]);
  // Fit the drawn nodes (plus room for labels), keeping the panel's 800:520 aspect; zoom narrows inside that box.
  const box = useMemo(() => {
    // Sparse maps always show every label, so their pills count too (a long name on the edge must not be clipped).
    const extents = [...points.values()].map(p => ({ x0: p.x, x1: p.x, y0: p.y, y1: p.y }));
    if (!dense) for (const s of spots.values()) { const left = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - s.w : s.x - s.w / 2; extents.push({ x0: left, x1: left + s.w, y0: s.y - s.h / 2, y1: s.y + s.h / 2 }); }
    const x0 = Math.min(...extents.map(e => e.x0)) - 70, x1 = Math.max(...extents.map(e => e.x1)) + 70, y0 = Math.min(...extents.map(e => e.y0)) - 55, y1 = Math.max(...extents.map(e => e.y1)) + 65;
    const w = Math.max(360, x1 - x0, (y1 - y0) * 800 / 520), h = w * 520 / 800;
    return { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
  }, [points, spots, dense]);
  const width = box.w / zoom, height = box.h / zoom;
  const x = Math.max(box.x, Math.min(box.x + box.w - width, (focus?.x ?? box.x + box.w / 2) - width / 2));
  const y = Math.max(box.y, Math.min(box.y + box.h - height, (focus?.y ?? box.y + box.h / 2) - height / 2));
  return <div className={`dash-graph ${dense ? 'dense' : ''} ${selected ? 'focused' : ''}`}>
    <svg viewBox={`${x} ${y} ${width} ${height}`} role="group" aria-label={label}>
      <defs><radialGradient id="dash-aura"><stop stopColor="var(--blue)" stopOpacity=".13" /><stop offset="1" stopColor="var(--blue)" stopOpacity="0" /></radialGradient></defs>
      <circle cx="400" cy="260" r="250" fill="url(#dash-aura)" />
      <g aria-hidden="true">{edges.map((edge, i) => {
        const a = points.get(edge.from), b = points.get(edge.to);
        return a && b ? <path key={`${edge.from}-${edge.to}-${i}`} d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 + 18} ${(a.y + b.y) / 2 - 18} ${b.x} ${b.y}`} className={`dash-edge ${edge.active ? 'flow' : ''} ${selected && (edge.from === selected || edge.to === selected) ? 'lit' : ''}`} /> : null;
      })}</g>
      {nodes.map((node, i) => {
        const p = points.get(node.id)!;
        return <g key={node.id} transform={`translate(${p.x} ${p.y})`} className={`dash-node ${node.central ? 'central' : ''} ${node.active ? 'working' : ''} ${selected === node.id ? 'selected' : ''} ${near.has(node.id) ? 'near' : ''}`}
          role="button" tabIndex={0} aria-label={`${node.label}: ${node.detail}`} aria-pressed={selected === node.id}
          onClick={() => onSelect(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}>
          <g className="dash-node-in" style={{ animationDelay: `${Math.min(i, 40) * 18}ms` }}>
          <title>{node.label}: {node.detail}</title>
          <circle className="dash-node-halo" r={node.central ? 38 : dense ? 11 : 20} />
          <circle className="dash-node-dot" r={node.central ? 23 : dense ? 4.5 : 8} />
          {node.central && <text className="dash-node-mark" y="5">O</text>}
          {!spots.has(node.id) && <text y={dense ? 22 : 28} className="dash-node-label">{short(node.label)}</text>}
          </g>
        </g>;
      })}
      <g className="dash-labels" aria-hidden="true">{nodes.map(node => {
        const spot = spots.get(node.id);
        if (!spot) return null;
        const x0 = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - spot.w : spot.x - spot.w / 2;
        return <g key={node.id} className={`dash-label ${selected === node.id ? 'selected' : ''}`}>
          <rect x={x0} y={spot.y - spot.h / 2} width={spot.w} height={spot.h} rx={spot.h / 2} />
          <text x={spot.anchor === 'start' ? spot.x + 6 : spot.anchor === 'end' ? spot.x - 6 : spot.x} y={spot.y} textAnchor={spot.anchor} dominantBaseline="central">{short(node.label)}</text>
        </g>;
      })}</g>
    </svg>
    <div className="dash-graph-controls"><button className="btn btn-ghost btn-s" type="button" aria-label={lang() === 'en' ? 'Zoom out' : 'Riduci'} onClick={() => setZoom(z => Math.max(1, z - .5))} disabled={zoom === 1}>−</button><span>{Math.round(zoom * 100)}%</span><button className="btn btn-ghost btn-s" type="button" aria-label={lang() === 'en' ? 'Zoom in' : 'Ingrandisci'} onClick={() => setZoom(z => Math.min(3, z + .5))} disabled={zoom === 3}>+</button></div>
  </div>;
}
