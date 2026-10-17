// Full-screen personal map: direct exploration, unobtrusive filters and real observed activity; no step player.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import{t}from'../../i18n';
import { normFiles, normMap, type MapEdge, type MapNode } from '../types';
import { useBrain } from '../api';
import { byLayer, centerId, defaultKinds, EDGE_KINDS, edgeKey, fileName, findNode, groupIndex, layerColor, pickView, relFile } from '../lib/map';
import { fmt } from '../lib/format';
import { short } from '../lib/text';
import { IconClose, IconSearch, useEsc } from '../components/ui';
import { createEngine, webglAvailable, type Engine } from './engine';
import { liveGraph, liveMoving, type LiveGraph, type LiveSnapshot, type LiveSource } from '../lib/live';

type Sel = { kind: 'node'; id: string } | { kind: 'link'; edge: MapEdge } | null;

export function BrainMapView({ onClose, onNavigate, full = false, focus, mode, live: source, onOpenChat }: {
  onClose: () => void;
  onNavigate?: (target: string) => void;
  /** what the app's chats are doing now (the live map); without it the map is the brain's structure only */
  live?: LiveSource;
  /** open a chat of the app (a click on a lit neuron or in the legend) */
  onOpenChat?: (chatId: string) => void;
  /** start in the full view ("mappa/tutto") */
  full?: boolean;
  /** a piece to fly to at start */
  focus?: string;
  /** force the 2D list (tests, or no WebGL) */
  mode?: '3d' | 'flat';
}) {
  const m = useBrain('/api/map', normMap, { maxAgeMs: 10 * 60e3 });
  const files = useBrain('/api/files', normFiles, { maxAgeMs: 60e3 });
  const [essential, setEssential] = useState(!full);
  const [flat, setFlat] = useState(mode === 'flat');
  const [gl, setGl] = useState<'checking' | 'ok' | 'fail'>(mode === 'flat' ? 'fail' : 'checking');
  const [glError, setGlError] = useState<string | null>(mode === 'flat' ? null : null);
  const layerOn: Record<string, boolean> = {};
  const [kindOn, setKindOn] = useState<Record<string, boolean>>(() => defaultKinds(!full));
  const [hi, setHi] = useState<{ nodes: Set<string>; links: Set<string> }>({ nodes: new Set(), links: new Set() });
  const [sel, setSel] = useState<Sel>(null);
  const [q, setQ] = useState('');
  const [liveOn, setLiveOn] = useState(() => { try { return localStorage.getItem('sb.map.live') !== '0'; } catch { return true; } });
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const pieceClose=useRef<HTMLButtonElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const rememberFocus=()=>{const active=document.activeElement;if(active instanceof HTMLElement&&root.current?.contains(active)&&!active.closest('[data-testid="bx-map-piece"]'))returnFocus.current=active;};
  const root = useRef<HTMLDivElement>(null);

  const data = m.data;
  const view = useMemo(() => (data ? pickView(data, essential) : null), [data, essential]);
  // the engine is rebuilt only when the view really changes (not for every refetch of the same map)
  const viewKey = view ? `${view.essential}|${view.nodes.map(n => n.id).join(',')}` : '';
  const fileSet = useMemo(() => new Set(files.data ?? []), [files.data]);
  const byId = useMemo(() => new Map((view?.nodes ?? []).map(n => [n.id, n])), [view]);
  // the live layer: recomputed from the app's snapshot (at most every 400 ms while chats work, every second while a glow fades)
  const lg = useMemo<LiveGraph | null>(() => (snap && view && data ? liveGraph(snap, view.nodes, data.nodes, data.root) : null), [snap, view, data]);
  const lgRef = useRef<LiveGraph | null>(null);
  lgRef.current = lg;
  useEffect(() => {
    if (!source || !liveOn) { setSnap(null); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pull = () => { timer = null; setSnap(source.get()); };
    pull();
    const off = source.subscribe(() => { if (!timer) timer = setTimeout(pull, 400); });
    const fade = setInterval(() => { const g = lgRef.current; if (g && liveMoving(g) && !document.hidden) pull(); }, 1000);
    return () => { off(); clearInterval(fade); if (timer) clearTimeout(timer); };
  }, [source, liveOn]);
  const allById = useMemo(() => new Map([...(data?.nodes ?? []), ...(view?.nodes ?? []), ...(lg?.nodes ?? [])].map(n => [n.id, n])), [data, view, lg]);
  const groups = useMemo(() => groupIndex(view?.nodes ?? []), [view]);
  const shownId = useCallback((id: string) => (byId.has(id) ? id : groups.get(id) ?? null), [byId, groups]);
  const center = useMemo(() => centerId(view?.nodes ?? []), [view]);
  const visible = useMemo(() => {
    if (!view) return { nodes: [] as MapNode[], edges: [] as MapEdge[] };
    const nodes = view.nodes.filter(n => layerOn[n.layer] !== false);
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: view.edges.filter(e => kindOn[e.kind] && ids.has(e.from) && ids.has(e.to)) };
  }, [view, layerOn, kindOn]);
  // what the engine draws: the visible map plus the live neurons and links (in the layers that are on)
  const drawn = useMemo(() => {
    if (!lg) return visible;
    const nodes = [...visible.nodes, ...lg.nodes.filter(n => layerOn[n.layer] !== false)];
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: [...visible.edges, ...lg.edges.filter(e => ids.has(e.from) && ids.has(e.to))] };
  }, [visible, lg, layerOn]);
  const labelOf = (id: string) => allById.get(id)?.label ?? id;

  // Esc closes the map (one level at a time: full screen, the contextual detail, then the map)
  useEsc(true, () => { if (document.fullscreenElement===root.current) void document.exitFullscreen(); else if (sel) setSel(null); else onClose(); });
  useEffect(() => { root.current?.focus(); }, []);
  useEffect(()=>{if(sel)pieceClose.current?.focus();else if(returnFocus.current?.isConnected)returnFocus.current.focus();},[sel]);
  useEffect(() => { if (mode !== 'flat') setGl(webglAvailable() ? 'ok' : 'fail'); }, [mode]);

  // the latest handlers and state for callbacks that outlive a render (engine events)
  const live = useRef({ pick: (_id: string) => {}, showLink: (_e: MapEdge) => {}, visible: drawn, lg: null as LiveGraph | null, center, focusId: null as string | null,  hi: { nodes: new Set<string>(), links: new Set<string>() } });
  // the 3D engine: created per view (essential/full), destroyed on close or when the list is shown
  useEffect(() => {
    if (flat || gl !== 'ok' || !view || !canvas.current) return;
    let dead = false, e: Engine | null = null;
    const L = live.current;
    createEngine(canvas.current, {
      essential: view.essential, nodes: L.visible.nodes, edges: L.visible.edges, center: L.center, focus: L.focusId,
      onNode: id => live.current.pick(id), onLink: edge => live.current.showLink(edge),
      onBackground: () => { setHi({ nodes: new Set(), links: new Set() }); setSel(null); },
      insets: () => ({ left: 0, right: 0 }), root: data?.root ?? '',
    }).then(x => {
      if (dead) { x.destroy(); return; }
      e = x; engine.current = x;
      x.setData(live.current.visible.nodes, live.current.visible.edges);
      x.setHighlight(live.current.hi.nodes, live.current.hi.links); // a recreated engine keeps the lit flow step / piece
      x.setLive(live.current.lg);
    }, err => { if (!dead) { setGl('fail'); setGlError(err instanceof Error ? err.message : String(err)); } });
    return () => { dead = true; e?.destroy(); engine.current = null; };
  }, [flat, gl, viewKey]);
  useEffect(() => { engine.current?.setData(drawn.nodes, drawn.edges); }, [drawn]);
  useEffect(() => { engine.current?.setLive(lg); }, [lg]);
  // a live piece that faded out while chosen: its panel and the dimming go with it
  useEffect(() => { if (sel?.kind === 'node' && !allById.has(sel.id)) { setSel(null); setHi({ nodes: new Set(), links: new Set() }); } }, [allById, sel]);
  useEffect(() => { engine.current?.setHighlight(hi.nodes, hi.links); if (flat && hi.nodes.size) document.querySelector('.bx-map-flat button.lit')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [hi, flat]);

  function pick(id: string) {
    rememberFocus();
    const n = allById.get(id);
    if (!n) return;
    // a live chat's neuron stands for the chat itself: the click opens it
    const chat = id.startsWith('live:chat:') ? lg?.chatOf.get(id) : undefined;
    if (chat && onOpenChat) { onOpenChat(chat); return; }
    const sid = shownId(id) ?? id;
    const out = (view?.edges ?? []).filter(e => e.from === sid && kindOn[e.kind]), inn = (view?.edges ?? []).filter(e => e.to === sid && kindOn[e.kind]);
    setHi({ nodes: new Set([sid, ...out.map(e => e.to), ...inn.map(e => e.from)]), links: new Set([...out, ...inn].map(e => edgeKey(e.from, e.to, e.kind))) });
    setSel({ kind: 'node', id: sid });
    engine.current?.lookAt(sid, view?.essential ? 620 : 220);
  }
  function showLink(edge: MapEdge) {
    rememberFocus();
    setSel({ kind: 'link', edge });
    setHi({ nodes: new Set([edge.from, edge.to]), links: new Set([edgeKey(edge.from, edge.to, edge.kind)]) });
  }
  live.current = { pick, showLink, visible: drawn, lg, center, focusId: focus ? shownId(focus) : null, hi };
  const openFile = (f: string) => { if (onNavigate) { onNavigate(`esplora/${f}`); onClose(); } };
  const fileLink = (f: string | undefined) => {
    if (!f) return null;
    const rel = relFile(f, data?.root ?? '') ?? f;
    return fileSet.has(rel) && onNavigate ? <button type="button" className="bx-go" onClick={() => openFile(rel)} title="Apri in Esplora">{rel}</button> : <span className="mono">{rel}</span>;
  };
  const search = () => { const n = findNode([...(view?.nodes ?? []), ...(data?.nodes ?? [])], q); if (n) pick(n.id); };

  const node = sel?.kind === 'node' ? allById.get(sel.id) ?? null : null;
  const glow = node ? lg?.glow.get(node.id) : undefined;
  const titleOf = (chatId: string) => snap?.chats.find(c => c.id === chatId)?.title ?? 'chat';
  const toggleLive = () => setLiveOn(v => { try { localStorage.setItem('sb.map.live', v ? '0' : '1'); } catch { /* per-viewer convenience only */ } return !v; });
  const out = node ? (view?.edges ?? []).filter(e => e.from === node.id && kindOn[e.kind]) : [];
  const inn = node ? (view?.edges ?? []).filter(e => e.to === node.id && kindOn[e.kind]) : [];
  const showFlat = flat || gl === 'fail';
  // the live map's legend: over the canvas at the bottom right, or at the top of the 2D list
  const legend = data && source ? (
    <details className={`bx-map-live${showFlat?' inline':''}`} data-testid="bx-map-live">
      <summary><i className={`bx-live-dot${lg?.working.some(w=>w.running)?' run':''}`} aria-hidden="true"/>Attività osservata</summary>
      <button type="button" className="bx-btn ghost s" aria-pressed={liveOn} onClick={toggleLive} data-testid="bx-map-live-toggle">{liveOn?'Nascondi attività':'Mostra attività'}</button>
      {liveOn&&lg?.working.length?<ul>{lg.working.slice(0,5).map(w=><li key={w.id}><button type="button" onClick={()=>onOpenChat?.(w.id)} disabled={!onOpenChat} data-testid="bx-map-live-chat"><span className="grow"><span>{w.title}</span><small>{w.running?'In corso':w.doing==='aspetta te'?'In attesa di te':'Attività recente'} · {short(w.doing,60)}</small></span></button></li>)}</ul>:<p className="counts">{liveOn?'Nessuna attività osservata.':'Attività nascosta.'}</p>}
    </details>
  ) : null;

  return (
    <div ref={root} className="bx bx-map" role="dialog" aria-modal="true" aria-label="Mappa del cervello" tabIndex={-1} data-testid="brain-map">
      <div className="bx-map-bar">
        <h2>Il tuo spazio</h2>
        <form className="bx-search" onSubmit={e => { e.preventDefault(); search(); }} role="search">
          <IconSearch />
          <input className="bx-input" list="bx-map-nodes" type="search" placeholder="Cerca nella mappa…" aria-label="Cerca un pezzo" value={q} onChange={e => setQ(e.target.value)} onBlur={() => q && search()} />
          <datalist id="bx-map-nodes">{(view?.nodes ?? []).map(n => <option key={n.id} value={n.label} />)}</datalist>
        </form>
        <span className="sp" />
        <button type="button" className="bx-btn" onClick={()=>{if(document.fullscreenElement===root.current)void document.exitFullscreen();else void root.current?.requestFullscreen().catch(()=>{});}} title="Schermo intero, Esc per tornare">Espandi</button>
        <button type="button" className="bx-btn" aria-pressed={!essential} title={essential ? 'Mostra ogni file e ogni freccia' : 'Torna ai pezzi principali'} onClick={() => { setEssential(e => !e); setKindOn(defaultKinds(!essential)); setSel(null); }} data-testid="bx-map-view">{essential ? 'Vista completa' : 'Vista essenziale'}</button>
        {!showFlat && <button type="button" className="bx-btn" onClick={() => engine.current?.fit()}>Reset vista</button>}
        {gl === 'ok' && <button type="button" className="bx-btn" aria-pressed={flat} onClick={() => setFlat(f => !f)} title="La mappa come elenco, per strato">{flat ? 'Mappa 3D' : 'Elenco'}</button>}
        <button type="button" className="bx-btn close" aria-label="Chiudi la mappa" title="Chiudi (Esc)" onClick={onClose} data-testid="bx-map-close"><IconClose /></button>
      </div>
      <div className="bx-map-body">
        {!data ? (
          <div className="bx-map-msg"><div>{m.error ? <><b style={{ color: '#ff9a8a' }}>La mappa non si carica</b><span>{m.error}</span><button type="button" className="bx-btn" onClick={() => m.reload()}>Riprova</button></> : <><b>Disegno la mappa…</b><span>La prima volta il cervello la calcola dai file (fino a 20 secondi).</span></>}</div></div>
        ) : showFlat ? (
          <div className="bx-map-flat bx-scroll" data-testid="bx-map-flat" style={{ padding: '80px 18px 18px' }}>
            {gl === 'fail' && !flat && mode !== 'flat' && <p className="bx-warnline" style={{ marginBottom: 12, background: 'rgba(242,182,76,0.08)' }}>La grafica 3D non parte su questo PC{glError ? ` (${glError})` : ' (WebGL non disponibile)'}: ecco la stessa mappa come elenco, per strato.</p>}
            {legend}
            <div className="layers">
              {view && byLayer({ ...view, nodes: drawn.nodes }).map(l => (
                <section key={l.id} className="layer" aria-label={l.label}>
                  <h3><span className="sw" style={{ background: layerColor(l.id) }} />{l.label}<span className="muted small" style={{ marginLeft: 'auto' }}>{l.nodes.length}</span></h3>
                  {l.nodes.map(n => (
                    <button key={n.id} type="button" className={`${sel?.kind === 'node' && sel.id === n.id ? 'on' : ''} ${hi.nodes.has(n.id) ? 'lit' : ''} ${lg?.glow.has(n.id) ? 'live' : ''}`} onClick={() => pick(n.id)}>
                      <span>{lg?.glow.has(n.id) && <i className={`bx-live-dot${lg.glow.get(n.id)!.running ? ' run' : ''}`} aria-label="al lavoro adesso" />}{n.label}{n.members?.length ? <span className="muted"> · {n.members.length}</span> : null}</span>
                      {(n.short || n.what) && <small>{short(n.short || n.what, 90)}</small>}
                      {fileName(n, data?.root ?? '') && <small className="mono bx-map-file">{fileName(n, data?.root ?? '')}</small>}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div ref={canvas} className="bx-map-canvas" data-testid="bx-map-canvas" tabIndex={0} onPointerDown={event=>event.currentTarget.focus({preventScroll:true})} role="group" aria-label="Mappa interattiva. Frecce per ruotare, più e meno per zoom, Home per ripristinare." onKeyDown={event=>{if(event.target!==event.currentTarget)return;const keys:Record<string,[number,number,number]>={ArrowLeft:[-1,0,1],ArrowRight:[1,0,1],ArrowUp:[0,-1,1],ArrowDown:[0,1,1],'+':[0,0,0.85],'=':[0,0,0.85],'-':[0,0,1.18]};if(event.key==='Home'){event.preventDefault();engine.current?.fit();}else if(keys[event.key]){event.preventDefault();engine.current?.nudge(...keys[event.key]!);}}} />
            <div className="bx-map-hint">Trascina per esplorare · rotella per avvicinarti · seleziona un nodo</div>
            {legend}
          </>
        )}


        {sel && data && (
          <aside className="bx-map-context" aria-label="Pezzo scelto" data-testid="bx-map-piece">
            <div className="bx-row" style={{ padding: '8px 8px 0 12px' }}><span className="small muted">{sel.kind === 'node' ? (data.layers.find(l => l.id === node?.layer)?.label ?? '') : (EDGE_KINDS[sel.edge.kind] ?? sel.edge.kind)}</span><span className="sp" /><button type="button" ref={pieceClose} className="bx-btn ghost s" aria-label="Chiudi la scheda" onClick={() => setSel(null)}><IconClose /></button></div>
            <div className="pbody bx-scroll">
              {sel.kind === 'link' ? (
                <div className="bx-map-piece">
                  <div className="title"><h3>{labelOf(sel.edge.from)} → {labelOf(sel.edge.to)}</h3></div>
                  <p className="short">{sel.edge.label}</p>
                  {sel.edge.source && <p className="what">«{sel.edge.source.text}» · {fileLink(sel.edge.source.file)}</p>}
                </div>
              ) : node && (
                <div className="bx-map-piece">
                  <div className="title"><span className="sw" style={{ background: layerColor(node.layer) }} /><h3>{node.label}</h3></div>
                  {glow && (
                    <div className="bx-map-now" data-testid="bx-map-now">
                      <h4><i className={`bx-live-dot${glow.running ? ' run' : ''}`} aria-hidden="true" />{glow.running?'In corso':'Attività recente o in attesa'}</h4>
                      <ul>{glow.doing.slice(0, 6).map((d, i) => <li key={i}>{short(d, 90)}</li>)}</ul>
                      {onOpenChat && glow.chats.map(c => <button key={c} type="button" className="bx-btn s" onClick={() => onOpenChat(c)}>Apri «{short(titleOf(c), 40)}»</button>)}
                    </div>
                  )}
                  <details className="bx-map-source"><summary>{t('ui.mapDetails')}</summary>
                  {node.what && node.kind !== 'gruppo' && node.what.trim()!==node.label.trim() && <p className="what">{short(node.what, 500)}</p>}
                  <dl className="bx-kv">
                    {node.file && <><dt>File</dt><dd>{fileLink(node.file)}</dd></>}
                    {node.modified && <><dt>Cambiato</dt><dd>{fmt.ago(node.modified)}</dd></>}
                    {node.uses != null && <><dt>Usato</dt><dd>{node.uses} volte in 30 giorni</dd></>}
                    {node.reads != null && <><dt>Letto</dt><dd>{node.reads} volte in 30 giorni</dd></>}
                    {node.events?.length ? <><dt>Scatta su</dt><dd>{node.events.join(', ')}</dd></> : null}
                    {node.fields?.model && <><dt>Modello</dt><dd>{node.fields.model}{node.fields.effort ? ` · impegno ${node.fields.effort}` : ''}</dd></>}
                    {node.playbook && <><dt>Taccuino</dt><dd>{node.playbook.punti} punti</dd></>}
                  </dl>
                  {node.members?.length ? <><h4>{node.kind === 'gruppo' ? `Dentro · ${node.members.length}` : `Insieme a lui · ${node.members.length}`}</h4><ul>{node.members.map(x => <li key={x.id}><b style={{ color: '#fff' }}>{x.label}</b>{x.name && x.name !== x.label ? <span className="muted mono"> {x.name}</span> : null}{x.what ? ` · ${short(x.what, 90)}` : ''}{x.uses != null ? <span className="muted"> · {x.uses} usi</span> : null}</li>)}</ul></> : null}
                  </details>
                  {out.length > 0 && <><h4>Verso · {out.length}</h4><ul>{out.slice(0, 30).map((e, i) => <li key={i}>→ <button type="button" onClick={() => pick(e.to)}>{labelOf(e.to)}</button> <span className="muted">{e.label}</span></li>)}</ul></>}
                  {inn.length > 0 && <><h4>Da · {inn.length}</h4><ul>{inn.slice(0, 30).map((e, i) => <li key={i}>← <button type="button" onClick={() => pick(e.from)}>{labelOf(e.from)}</button> <span className="muted">{e.label}</span></li>)}</ul></>}
                </div>
              )}
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}
