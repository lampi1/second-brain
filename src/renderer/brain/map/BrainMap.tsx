// The brain map, full screen over the app (a night world of its own, whatever the theme). Top bar: counts, search a
// piece, essential/full view, fit, menu, 3D/list, close (Esc). Left menu: "Come funziona" (flows played step by step,
// each with the sentence of the file that proves it), "Strati" (layers and arrow kinds on/off), "Punti deboli"
// (computed by the brain). Right: the chosen piece (what it is, file, use, links in and out, members of a group).
// Bottom: the flow player. Without WebGL (or when asked) the same map is a 2D list by layer, with the same menu and
// player. Data: /api/map (essential view = its `simple` graph), /api/files (to open files in Esplora).
// Names: a piece reads by the brain's speaking label; its file (or agent, /skill) shows small under it in the list, in
// the 3D hover card and next to a group's members (lib/map.ts fileName); the search finds both.
// Live map (`live`, given by the app): the neurons at work now light up (chats with their engine, brain files read or
// written, tools, agents, the browser), their links pulse while in progress and fade out (lib/live.ts); the legend at
// the bottom right lists the chats at work (a click opens one) and turns the live map off. A click on a live chat's
// neuron opens the chat; any other lit piece shows "Adesso" in its panel, with the chats to open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normFiles, normMap, type MapEdge, type MapNode } from '../types';
import { useBrain } from '../api';
import { byLayer, centerId, defaultKinds, EDGE_KINDS, edgeKey, fileName, findNode, groupIndex, layerColor, NIGHT, pickView, relFile, weakPoints } from '../lib/map';
import { fmt } from '../lib/format';
import { short } from '../lib/text';
import { IconChevL, IconChevR, IconClose, IconPause, IconPlay, IconSearch, Tabs, useEsc } from '../components/ui';
import { createEngine, webglAvailable, type Engine } from './engine';
import { liveGraph, liveMoving, type LiveGraph, type LiveSnapshot, type LiveSource } from '../lib/live';

type Tab = 'flussi' | 'strati' | 'deboli';
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
  const [tab, setTab] = useState<Tab>('flussi');
  const [menu, setMenu] = useState(true);
  const [layerOn, setLayerOn] = useState<Record<string, boolean>>({});
  const [kindOn, setKindOn] = useState<Record<string, boolean>>(() => defaultKinds(!full));
  const [hi, setHi] = useState<{ nodes: Set<string>; links: Set<string> }>({ nodes: new Set(), links: new Set() });
  const [sel, setSel] = useState<Sel>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [q, setQ] = useState('');
  const [liveOn, setLiveOn] = useState(() => { try { return localStorage.getItem('sb.map.live') !== '0'; } catch { return true; } });
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
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
  const weak = useMemo(() => (data ? weakPoints(data) : []), [data]);
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
  const flow = view?.flows.find(f => f.id === flowId) ?? null;
  const cur = flow?.steps[step] ?? null;
  const labelOf = (id: string) => allById.get(id)?.label ?? id;

  // Esc closes the map (one level at a time: the piece, the flow, then the map)
  useEsc(true, () => { if (sel) setSel(null); else if (flowId) stopFlow(); else onClose(); });
  useEffect(() => { root.current?.focus(); }, []);
  useEffect(() => { if (mode !== 'flat') setGl(webglAvailable() ? 'ok' : 'fail'); }, [mode]);

  // the latest handlers and state for callbacks that outlive a render (engine events, the player's timer)
  const live = useRef({ pick: (_id: string) => {}, showLink: (_e: MapEdge) => {}, go: (_i: number) => {}, flowId: null as string | null, step: 0, len: 0, visible: drawn, lg: null as LiveGraph | null, center, focusId: null as string | null, menu: true, selOpen: false, hi: { nodes: new Set<string>(), links: new Set<string>() } });
  // the 3D engine: created per view (essential/full), destroyed on close or when the list is shown
  useEffect(() => {
    if (flat || gl !== 'ok' || !view || !canvas.current) return;
    let dead = false, e: Engine | null = null;
    const L = live.current;
    createEngine(canvas.current, {
      essential: view.essential, nodes: L.visible.nodes, edges: L.visible.edges, center: L.center, focus: L.focusId,
      onNode: id => live.current.pick(id), onLink: edge => live.current.showLink(edge),
      onBackground: () => { if (!live.current.flowId) { setHi({ nodes: new Set(), links: new Set() }); setSel(null); } },
      insets: () => ({ left: live.current.menu ? 344 : 0, right: live.current.selOpen ? 364 : 0 }), root: data?.root ?? '',
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
    const n = allById.get(id);
    if (!n) return;
    // a live chat's neuron stands for the chat itself: the click opens it
    const chat = id.startsWith('live:chat:') ? lg?.chatOf.get(id) : undefined;
    if (chat && onOpenChat) { onOpenChat(chat); return; }
    const sid = shownId(id) ?? id;
    if (n.layer && layerOn[n.layer] === false) setLayerOn(s => ({ ...s, [n.layer]: true }));
    const out = (view?.edges ?? []).filter(e => e.from === sid && kindOn[e.kind]), inn = (view?.edges ?? []).filter(e => e.to === sid && kindOn[e.kind]);
    if (!live.current.flowId) setHi({ nodes: new Set([sid, ...out.map(e => e.to), ...inn.map(e => e.from)]), links: new Set([...out, ...inn].map(e => edgeKey(e.from, e.to, e.kind))) });
    setSel({ kind: 'node', id: sid });
    live.current.selOpen = true; // the piece panel opens with this click: frame beside it
    engine.current?.lookAt(sid, view?.essential ? 620 : 220);
  }
  function showLink(edge: MapEdge) {
    setSel({ kind: 'link', edge });
    setHi({ nodes: new Set([edge.from, edge.to]), links: new Set([edgeKey(edge.from, edge.to, edge.kind)]) });
  }
  function go(i: number) {
    if (!flow) return;
    const n = Math.max(0, Math.min(flow.steps.length - 1, i));
    setStep(n);
    const s = flow.steps[n]!;
    setHi({ nodes: new Set([s.from, s.to]), links: new Set([edgeKey(s.from, s.to, 'flusso')]) });
    engine.current?.frame([s.from, s.to], view?.essential ? 520 : 240);
  }
  live.current = { pick, showLink, go, flowId, step, len: flow?.steps.length ?? 0, visible: drawn, lg, center, focusId: focus ? shownId(focus) : null, menu, selOpen: !!sel, hi };
  // a new flow starts at its first step; playing moves one step every 2.6 s and stops at the end
  useEffect(() => { if (flowId) live.current.go(0); }, [flowId]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => { const L = live.current; if (L.step >= L.len - 1) setPlaying(false); else L.go(L.step + 1); }, 2600);
    return () => clearInterval(t);
  }, [playing]);
  function pickFlow(id: string) { setFlowId(id); setStep(0); setPlaying(true); setTab('flussi'); setSel(null); }
  function stopFlow() { setPlaying(false); setFlowId(null); setHi({ nodes: new Set(), links: new Set() }); }
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
  const sub = view ? `${view.nodes.length} pezzi${view.essential ? ` (dei ${view.total} veri)` : ''} · ${view.flows.length} percorsi` : '';
  const showFlat = flat || gl === 'fail';
  // the live map's legend: over the canvas at the bottom right, or at the top of the 2D list
  const legend = data && source ? (
          <section className={`bx-map-live${showFlat ? ' inline' : sel ? ' shifted' : ''}`} aria-label="Al lavoro adesso" data-testid="bx-map-live">
            <div className="head">
              <i className={`bx-live-dot${lg?.working.some(w => w.running) ? ' run' : ''}`} aria-hidden="true" />
              <b>Al lavoro adesso</b>
              <span className="sp" />
              <button type="button" className="bx-btn ghost s" aria-pressed={liveOn} onClick={toggleLive} title={liveOn ? 'Spegni la mappa viva' : 'Accendi la mappa viva'} data-testid="bx-map-live-toggle">{liveOn ? 'Spegni' : 'Accendi'}</button>
            </div>
            {liveOn && lg && (
              <>
                <p className="counts">{lg.counts.chats} chat · {lg.counts.files} file · {lg.counts.tools} {lg.counts.tools === 1 ? 'strumento' : 'strumenti'}</p>
                {lg.working.length ? (
                  <ul>
                    {lg.working.slice(0, 5).map(w => (
                      <li key={w.id}>
                        <button type="button" onClick={() => onOpenChat?.(w.id)} disabled={!onOpenChat} title="Apri la chat" data-testid="bx-map-live-chat">
                          <i className={`bx-live-dot${w.running ? ' run' : ''}`} style={{ opacity: 0.35 + 0.65 * w.level }} aria-hidden="true" />
                          <span className="grow"><span>{w.title}</span><small>{w.harness === 'cursor' ? 'Cursor' : 'Claude'} · {short(w.doing, 60)}</small></span>
                        </button>
                      </li>
                    ))}
                    {lg.working.length > 5 && <li className="more">e altre {lg.working.length - 5}</li>}
                  </ul>
                ) : <p className="counts">Nessuna chat al lavoro: la mappa è a riposo.</p>}
                <p className="key"><span><i className="halo" />neurone al lavoro</span><span><i className="wire" />connessione in corso, poi si spegne</span></p>
              </>
            )}
            {!liveOn && <p className="counts">Spenta: la mappa mostra solo com'è fatto il cervello.</p>}
          </section>
  ) : null;

  return (
    <div ref={root} className="bx bx-map" role="dialog" aria-modal="true" aria-label="Mappa del cervello" tabIndex={-1} data-testid="brain-map">
      <div className="bx-map-bar">
        <h2>Mappa del cervello {sub && <small>{sub}</small>}</h2>
        <form className="bx-search" onSubmit={e => { e.preventDefault(); search(); }} role="search">
          <IconSearch />
          <input className="bx-input" list="bx-map-nodes" type="search" placeholder="Cerca un pezzo…" aria-label="Cerca un pezzo" value={q} onChange={e => setQ(e.target.value)} onBlur={() => q && search()} />
          <datalist id="bx-map-nodes">{(view?.nodes ?? []).map(n => <option key={n.id} value={n.label} />)}</datalist>
        </form>
        <span className="sp" />
        <button type="button" className="bx-btn" aria-pressed={!essential} title={essential ? 'Mostra ogni file e ogni freccia' : 'Torna ai pezzi principali'} onClick={() => { setEssential(e => !e); setKindOn(defaultKinds(!essential)); setSel(null); stopFlow(); }} data-testid="bx-map-view">{essential ? 'Vista completa' : 'Vista essenziale'}</button>
        {!showFlat && <button type="button" className="bx-btn" onClick={() => engine.current?.fit()}>⤢ Inquadra</button>}
        <button type="button" className="bx-btn" aria-pressed={menu} onClick={() => setMenu(x => !x)} title="Mostra o nascondi il menu">☰ Menu</button>
        {gl === 'ok' && <button type="button" className="bx-btn" aria-pressed={flat} onClick={() => setFlat(f => !f)} title="La mappa come elenco, per strato">{flat ? 'Mappa 3D' : 'Elenco'}</button>}
        <button type="button" className="bx-btn close" aria-label="Chiudi la mappa" title="Chiudi (Esc)" onClick={onClose} data-testid="bx-map-close"><IconClose /></button>
      </div>
      <div className="bx-map-body">
        {!data ? (
          <div className="bx-map-msg"><div>{m.error ? <><b style={{ color: '#ff9a8a' }}>La mappa non si carica</b><span>{m.error}</span><button type="button" className="bx-btn" onClick={() => m.reload()}>Riprova</button></> : <><b>Disegno la mappa…</b><span>La prima volta il cervello la calcola dai file (fino a 20 secondi).</span></>}</div></div>
        ) : showFlat ? (
          <div className="bx-map-flat bx-scroll" data-testid="bx-map-flat" style={{ paddingLeft: menu ? undefined : 18 }}>
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
            <div ref={canvas} className="bx-map-canvas" data-testid="bx-map-canvas" />
            <div className="bx-map-hint">Trascina per ruotare · rotella per lo zoom · clic su un pezzo</div>
            {legend}
          </>
        )}


        {data && view && menu && (
          <aside className="bx-map-panel left" aria-label="Menu della mappa" data-testid="bx-map-menu">
            <Tabs label="Menu della mappa" value={tab} onChange={setTab} items={[{ id: 'flussi', label: 'Come funziona' }, { id: 'strati', label: 'Strati' }, { id: 'deboli', label: 'Punti deboli', n: weak.length }]} />
            <div className="pbody bx-scroll">
              {tab === 'flussi' && (
                <>
                  <p className="hint">Scegli un percorso: la mappa lo accende passo per passo, con la frase del file che lo prova.</p>
                  {view.flows.map(f => (
                    <div key={f.id} style={{ display: 'grid', gap: 4 }}>
                      <button type="button" className="bx-mapitem" aria-pressed={flowId === f.id} onClick={() => (flowId === f.id ? stopFlow() : pickFlow(f.id))}>
                        <span className="grow"><span>{f.title}</span><small>{f.steps.length} passi{f.steps.some(s => !s.verified) ? ' · uno da verificare' : ''}</small></span>
                        {f.steps.some(s => !s.verified) && <span title="Un passo non è provato da un file" aria-label="da verificare">⚠</span>}
                      </button>
                      {flowId === f.id && (
                        <ol className="bx-steps">
                          {f.steps.map((s, i) => (
                            <li key={i} className={i === step ? 'on' : ''} onClick={() => { setPlaying(false); go(i); }}>
                              <span><b>{s.fromLabel ?? labelOf(s.from)} → {s.toLabel ?? labelOf(s.to)}</b>: {s.label}{s.verified ? '' : ' ⚠'}</span>
                              <span className="src">«{s.source.text}» · {fileLink(s.source.file)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ))}
                </>
              )}
              {tab === 'strati' && (
                <>
                  {view.layers.map(l => {
                    const on = layerOn[l.id] !== false, n = view.nodes.filter(x => x.layer === l.id).length;
                    return (
                      <button key={l.id} type="button" className="bx-mapitem toggle" aria-pressed={on} onClick={() => setLayerOn(s => ({ ...s, [l.id]: !on }))}>
                        <span className="sw" style={{ background: layerColor(l.id) }} /><span className="grow"><span>{l.label}</span><small>{l.hint}</small></span><span className="n">{n}</span>
                      </button>
                    );
                  })}
                  <h4>Frecce</h4>
                  {Object.entries(EDGE_KINDS).filter(([k]) => view.edges.some(e => e.kind === k)).map(([k, lbl]) => (
                    <button key={k} type="button" className="bx-mapitem toggle" aria-pressed={!!kindOn[k]} onClick={() => setKindOn(s => ({ ...s, [k]: !s[k] }))}>
                      <span className="sw line" style={{ background: k === 'flusso' ? NIGHT.accent : '#7f8aa3' }} /><span className="grow">{lbl}</span><span className="n">{view.edges.filter(e => e.kind === k).length}</span>
                    </button>
                  ))}
                </>
              )}
              {tab === 'deboli' && (
                <>
                  <p className="hint">Calcolati dai file e dagli script, mai scritti a mano. Clic per vederli sulla mappa.</p>
                  {data.warnings.length > 0 && <p className="hint">{data.warnings.length} avvisi della mappa: {data.warnings.slice(0, 2).join(' · ')}</p>}
                  <ul className="bx-weak">
                    {weak.map((w, i) => (
                      <li key={i}><button type="button" onClick={() => { stopFlow(); const ids = new Set(w.ids.map(shownId).filter((x): x is string => !!x)); setHi({ nodes: ids, links: new Set() }); const first = [...ids][0]; if (first) { setSel({ kind: 'node', id: first }); engine.current?.frame([...ids], 560); } }}>
                        <b>{w.kind}</b><span>{w.text}</span>
                      </button></li>
                    ))}
                  </ul>
                  {!weak.length && <p className="hint">Nessun punto debole trovato.</p>}
                </>
              )}
            </div>
          </aside>
        )}

        {sel && data && (
          <aside className="bx-map-panel right" aria-label="Pezzo scelto" data-testid="bx-map-piece">
            <div className="bx-row" style={{ padding: '8px 8px 0 12px' }}><span className="small muted">{sel.kind === 'node' ? (data.layers.find(l => l.id === node?.layer)?.label ?? '') : (EDGE_KINDS[sel.edge.kind] ?? sel.edge.kind)}</span><span className="sp" /><button type="button" className="bx-btn ghost s" aria-label="Chiudi la scheda" onClick={() => setSel(null)}><IconClose /></button></div>
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
                  {node.short && <p className="short">{node.short}</p>}
                  {glow && (
                    <div className="bx-map-now" data-testid="bx-map-now">
                      <h4><i className={`bx-live-dot${glow.running ? ' run' : ''}`} aria-hidden="true" />Adesso</h4>
                      <ul>{glow.doing.slice(0, 6).map((d, i) => <li key={i}>{short(d, 90)}</li>)}</ul>
                      {onOpenChat && glow.chats.map(c => <button key={c} type="button" className="bx-btn s" onClick={() => onOpenChat(c)}>Apri «{short(titleOf(c), 40)}»</button>)}
                    </div>
                  )}
                  {node.what && node.kind !== 'gruppo' && <p className="what">{short(node.what, 500)}</p>}
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
                  {out.length > 0 && <><h4>Verso · {out.length}</h4><ul>{out.slice(0, 30).map((e, i) => <li key={i}>→ <button type="button" onClick={() => pick(e.to)}>{labelOf(e.to)}</button> <span className="muted">{e.label}</span></li>)}</ul></>}
                  {inn.length > 0 && <><h4>Da · {inn.length}</h4><ul>{inn.slice(0, 30).map((e, i) => <li key={i}>← <button type="button" onClick={() => pick(e.from)}>{labelOf(e.from)}</button> <span className="muted">{e.label}</span></li>)}</ul></>}
                </div>
              )}
            </div>
          </aside>
        )}

        {flow && cur && (
          <div className="bx-map-player" role="region" aria-label="Percorso" data-testid="bx-map-player">
            <button type="button" className="bx-btn" aria-label="Passo precedente" disabled={step === 0} onClick={() => { setPlaying(false); go(step - 1); }}><IconChevL /></button>
            <button type="button" className="bx-btn" aria-label={playing ? 'Pausa' : 'Riproduci'} onClick={() => { if (!playing && step >= flow.steps.length - 1) go(0); setPlaying(p => !p); }}>{playing ? <IconPause /> : <IconPlay />}</button>
            <button type="button" className="bx-btn" aria-label="Passo successivo" disabled={step >= flow.steps.length - 1} onClick={() => { setPlaying(false); go(step + 1); }}><IconChevR /></button>
            <div className="txt" aria-live="polite">
              <b>{step + 1}/{flow.steps.length} · {cur.fromLabel ?? labelOf(cur.from)} → {cur.toLabel ?? labelOf(cur.to)}: {cur.label}</b>
              <span>«{cur.source.text}» · {relFile(cur.source.file, data?.root ?? '') ?? cur.source.file}{cur.verified ? '' : ' · da verificare'}</span>
            </div>
            <button type="button" className="bx-btn" aria-label="Chiudi il percorso" onClick={stopFlow}><IconClose /></button>
            <span className="bar"><i style={{ width: `${((step + 1) / flow.steps.length) * 100}%` }} /></span>
          </div>
        )}
      </div>
    </div>
  );
}
