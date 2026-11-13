// Impara's board, animated (ADR 0188; owner, 2026-10-29: «schema con animazioni tipo guarda qui … di base a tutto
// schermo»): the lesson's flowchart laid out by mermaid (lib/viz/flow-layout.ts) and drawn here, so the picture can
// move. At each beat of a piece (the sentence being said) the camera glides to that beat's nodes, a ring and the «Guarda
// qui» note mark them, the arrow it names lights up and a light runs along it from one node to the other (Mayer:
// signaling, temporal contiguity). Nodes of the pieces seen stay calm, the ones still to come are faint, so the picture
// grows piece by piece; «Tutto lo schema» (or a double click) shows it whole. The camera fits the drawing to the board
// whatever its shape: the whole drawing when its labels read well, else close to the beat; labels never oversized. A drawing mermaid cannot lay out falls back
// to the still image (LessonDiagram.tsx). Motion is off for reduced-motion users. With `onPick` the nodes are buttons (a double click picks once):
// a review card asks to click the part that answers it (ImparaReview.tsx, ADR 0189; in a lesson a click asks the tutor
// about that part, ADR 0190), `marks` then shows the right one and
// a wrong pick. Used by ImparaPlayer.tsx and ImparaReview.tsx; styles impara.css (.st-*).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { FlowEdge, FlowLayout, FlowNode } from '../../lib/viz/flow-layout';
import { ui } from '../../store/ui';
import { t } from '../../i18n';

/** the drawing's type size: the same as the labels mermaid measured */
const DRAW = { fontSize: 16, nodeSpacing: 46, rankSpacing: 56 };
const LINE = 20;
const PAD = 36;
/** a label never shows bigger than this many times its drawn size (big labels were the owner's complaint) */
const MAX_ZOOM = 1.2;
/** the whole drawing stays on the board while its labels read at least this size: the camera only marks the beat;
 *  below it, the camera goes close to the beat's nodes, up to the drawn size */
const READABLE = 0.8;

export interface StageBeat { focus: readonly string[]; flow?: { from: string; to: string }; note?: string }

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (ns: readonly FlowNode[]): Box | null => {
  if (!ns.length) return null;
  const x1 = Math.min(...ns.map(n => n.x - n.w / 2)), x2 = Math.max(...ns.map(n => n.x + n.w / 2));
  const y1 = Math.min(...ns.map(n => n.y - n.h / 2)), y2 = Math.max(...ns.map(n => n.y + n.h / 2));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/** The camera: scale and shift for a board of cw × ch. The whole drawing when it reads well at that size (nothing cut,
 *  nothing oversized); a big drawing goes close to the beat's nodes (`box`), keeping some of their surroundings, never
 *  past the drawn size, its edges kept on the board. */
export function camera(l: Pick<FlowLayout, 'width' | 'height'>, cw: number, ch: number, box: Box | null): { s: number; x: number; y: number } {
  const s0 = Math.max(0.05, Math.min((cw - 2 * PAD) / l.width, (ch - 2 * PAD) / l.height, MAX_ZOOM));
  if (!box || s0 >= READABLE) return { s: s0, x: (cw - l.width * s0) / 2, y: (ch - l.height * s0) / 2 };
  const want = Math.min((cw - 2 * PAD) / Math.max(box.w, 1), (ch - 2 * PAD) / Math.max(box.h, 1)) * 0.7;
  const s = Math.max(s0, Math.min(want, 1));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const clamp = (v: number, size: number, board: number) => (size * s <= board ? (board - size * s) / 2 : Math.min(PAD, Math.max(board - size * s - PAD, v)));
  return { s, x: clamp(cw / 2 - cx * s, l.width, cw), y: clamp(ch / 2 - cy * s, l.height, ch) };
}

function Shape({ n }: { n: FlowNode }) {
  const w = n.w, h = n.h;
  if (n.shape === 'diamond') return <polygon className="st-shape" points={`0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`} />;
  if (n.shape === 'circle') return <circle className="st-shape" r={Math.max(w, h) / 2} />;
  return <rect className="st-shape" x={-w / 2} y={-h / 2} width={w} height={h} rx={n.shape === 'round' ? h / 2 : 10} />;
}

export function LessonStage({ code, beat, done, whole, onWhole, caption, beatKey, onPick, marks }: {
  code: string; beat: StageBeat; done: readonly string[]; whole: boolean; onWhole: () => void; caption: string;
  /** changes at each beat: the note and the light start again */
  beatKey: string;
  /** the nodes are buttons (a review card's «click the part that…») */
  onPick?: (id: string, label: string) => void;
  marks?: Readonly<Record<string, 'right' | 'wrong'>>;
}) {
  const theme = ui.use(s => s.prefs.theme);
  const [layout, setLayout] = useState<FlowLayout | null | 'broken'>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!code.trim()) return;
    let alive = true;
    import('../../lib/viz/mermaid').then(m => m.layoutMermaid(code, DRAW)).then(l => { if (alive) setLayout(l ?? 'broken'); }, () => { if (alive) setLayout('broken'); });
    return () => { alive = false; };
  }, [code, theme]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const L = layout && layout !== 'broken' ? layout : null;
  const byId = useMemo(() => new Map((L?.nodes ?? []).map(n => [n.id, n])), [L]);
  const lit = new Set([...beat.focus, ...(beat.flow ? [beat.flow.from, beat.flow.to] : [])].filter(id => byId.has(id)));
  const seen = new Set(done.filter(id => byId.has(id)));
  const focusBox = whole ? null : boxOf([...lit].map(id => byId.get(id)!));
  const cam = L && size.w > 0 ? camera(L, size.w, size.h, focusBox) : null;
  // the arrow the beat names, either way round (a light runs from `from` to `to`)
  const flowEdge = beat.flow && L ? L.edges.find(e => (e.from === beat.flow!.from && e.to === beat.flow!.to) || (e.from === beat.flow!.to && e.to === beat.flow!.from)) ?? null : null;
  const reversed = !!flowEdge && flowEdge.from !== beat.flow!.from;
  const stateOf = (id: string) => (whole ? 'base' : lit.has(id) ? 'now' : seen.has(id) ? 'done' : 'dim');
  const edgeState = (e: FlowEdge) => (whole ? 'base' : e === flowEdge ? 'flow' : (lit.has(e.from) || seen.has(e.from)) && (lit.has(e.to) || seen.has(e.to)) ? 'done' : 'dim');
  // the note sits under the beat's nodes, on the board, where the camera puts them
  const note = !whole && beat.note && cam && focusBox ? (() => {
    const x = (focusBox.x + focusBox.w / 2) * cam.s + cam.x, y = (focusBox.y + focusBox.h) * cam.s + cam.y + 16;
    return { left: Math.min(Math.max(x, 150), size.w - 150), top: Math.min(y, size.h - 64) };
  })() : null;

  return (
    <div ref={box} className="st-board" data-testid="impara-diagram" data-focus={[...lit].join(',')} data-flow={flowEdge ? `${beat.flow!.from}>${beat.flow!.to}` : ''}
      data-nodes={L?.nodes.length ?? 0} data-whole={whole ? 'true' : 'false'} onDoubleClick={onWhole}>
      {layout === 'broken' && <pre className="ip-diagram-code" data-testid="impara-diagram-code">{code}</pre>}
      {L && cam && (
        <svg className="st-svg" width={size.w} height={size.h} role="img" aria-label={caption}>
          <defs>
            <marker id="st-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="st-arrowhead" /></marker>
            <marker id="st-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="st-arrowhead lit" /></marker>
          </defs>
          <g className="st-cam" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})` }}>
            {L.clusters.map((c, i) => (
              <g key={`c${i}`} className="st-cluster">
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={14} />
                {c.label && <text x={c.x + 12} y={c.y + 20}>{c.label}</text>}
              </g>
            ))}
            {L.edges.map(e => {
              const st = edgeState(e);
              return (
                <g key={e.id} className={`st-edge ${st} ${e.dashed ? 'dashed' : ''}`} transform={`translate(${e.ox} ${e.oy})`}>
                  <path d={e.d} markerEnd={e.arrow ? `url(#${st === 'flow' ? 'st-arrow-lit' : 'st-arrow'})` : undefined} />
                  {st === 'flow' && <path key={beatKey} className="st-run" d={e.d} />}
                  {st === 'flow' && (
                    <circle key={`p${beatKey}`} className="st-packet" r={6}>
                      <animateMotion dur="1.6s" repeatCount="indefinite" path={e.d} {...(reversed ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})} />
                    </circle>
                  )}
                </g>
              );
            })}
            {L.edges.filter(e => e.label).map(e => {
              const lb = e.label!;
              return (
                <g key={`l${e.id}`} className={`st-elabel ${edgeState(e)}`} transform={`translate(${lb.x} ${lb.y})`}>
                  <rect x={-lb.w / 2 - 4} y={-lb.h / 2} width={lb.w + 8} height={lb.h} rx={lb.h / 2} />
                  <text textAnchor="middle" dominantBaseline="central">{lb.text}</text>
                </g>
              );
            })}
            {focusBox && <rect key={`r${beatKey}`} className="st-ring" x={focusBox.x - 10} y={focusBox.y - 10} width={focusBox.w + 20} height={focusBox.h + 20} rx={16} />}
            {L.nodes.map(n => (
              <g key={n.id} className={`st-node ${stateOf(n.id)} ${marks?.[n.id] ?? ''} ${onPick ? 'pick' : ''}`} transform={`translate(${n.x} ${n.y})`} data-node={n.id}
                {...(onPick ? { role: 'button', tabIndex: 0, 'aria-label': n.lines.join(' '), onClick: (e: MouseEvent) => { if (e.detail <= 1) onPick(n.id, n.lines.join(' ')); }, onKeyDown: (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onPick(n.id, n.lines.join(' ')); } } } : {})}>
                <Shape n={n} />
                <text textAnchor="middle" dominantBaseline="central">
                  {n.lines.map((line, i) => <tspan key={i} x={0} y={(i - (n.lines.length - 1) / 2) * LINE}>{line}</tspan>)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
      {note && <div key={beatKey} className="st-note" style={note} data-testid="impara-note"><b>{t('impara.here')}</b> {beat.note}</div>}
    </div>
  );
}
