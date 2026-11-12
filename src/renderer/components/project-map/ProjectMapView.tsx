// "Mappa → Progetti" (issue #385, ADR 0271): a project drawn in place of its code, in the C4 style. The owner
// (2026-11-12): «qualcosa da vedere al posto del codice … la struttura di un progetto nei vari sistemi connessione utenti
// … e l'avanzamento di ogni agente con un colpo d'occhio», «entrare dentro un sistema e vedere anche altri sistemi»,
// «sempre aggiornato, navigabile dall'inizio alla fine».
// - The drawing: one level at a time (shared/project-map.ts levelOf), people on top, environments and documents at the
//   bottom; a system with parts opens on click (breadcrumbs go back), and around it the outside elements it talks to.
//   Each box and arrow shows its status; one nobody confirmed lately, or whose files changed since, is dashed «da
//   verificare»; «Tu» marks what waits for the user.
// - The agents column: the chats bound to the map (projectmap/service.ts), who waits for the user first, with their
//   steps; a card lights its boxes on the map and opens its chat.
// - The history slider plays every version from the first drawing to now. Live: 'projectmap:changed' reloads it.
// Rendered by brain-model/MapPage.tsx (view «Progetti», pageArg progetti/<project>/<system>).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BOX, levelOf, pathTo, shownStatus, type Level, type LevelEdge, type LevelNode, type MapAgent, type MapElement, type MapState, type ProjectMapInfo, type ProjectMapView as View } from '@shared/project-map';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { useApp } from '../../store/store';
import { AgentAvatar } from '../AgentAvatar';
import './project-map.css';

type Shown = MapState | 'stale';
const shown = (s: { status: MapState; stale: boolean }): Shown => (s.stale ? 'stale' : s.status);
const DONE_MARKS = new Set(['done', 'idle']);
/** «4 min fa», or «ora» alone */
const since = (ts: number, now: number) => { const a = ago(ts, now); return a === t('appText.format.now') ? a : t('pm.ago', { at: a }); };

/** Where an arrow leaves a box and where it enters the next: bottom → top between rows, side → side on one row; drawn
 *  as a curve that leaves and enters straight (c1, c2 its control points). */
interface Ends { x1: number; y1: number; x2: number; y2: number; c1: [number, number]; c2: [number, number] }
function ends(a: LevelNode, b: LevelNode): Ends {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  if (Math.abs(ay - by) < 20) {
    const [x1, x2] = ax < bx ? [a.x + a.w, b.x] : [a.x, b.x + b.w], mx = (x1 + x2) / 2;
    return { x1, y1: ay, x2, y2: by, c1: [mx, ay], c2: [mx, by] };
  }
  const [y1, y2] = ay < by ? [a.y + a.h, b.y] : [a.y, b.y + b.h], my = (y1 + y2) / 2;
  return { x1: ax, y1, x2: bx, y2, c1: [ax, my], c2: [bx, my] };
}
const curve = (p: Ends) => `M${p.x1},${p.y1} C${p.c1[0]},${p.c1[1]} ${p.c2[0]},${p.c2[1]} ${p.x2},${p.y2}`;
/** the point at f (0..1) along the curve */
function along(p: Ends, f: number): { left: number; top: number } {
  const g = 1 - f, k = [g * g * g, 3 * g * g * f, 3 * g * f * f, f * f * f] as const;
  return { left: k[0] * p.x1 + k[1] * p.c1[0] + k[2] * p.c2[0] + k[3] * p.x2, top: k[0] * p.y1 + k[1] * p.c1[1] + k[2] * p.c2[1] + k[3] * p.y2 };
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 15, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return <svg className="pm-ring" viewBox="0 0 38 38" width={34} height={34} aria-label={t('pm.steps', { done, total })}>
    <circle cx={19} cy={19} r={r} className="pm-ring-bg" />
    <circle cx={19} cy={19} r={r} className="pm-ring-fg" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 19 19)" />
    <text x={19} y={23} textAnchor="middle">{done}/{total}</text>
  </svg>;
}

function AgentCard({ a, names, on, onPick }: { a: MapAgent; names: string; on: boolean; onPick: () => void }) {
  const avatar = useApp(s => s.chats[a.chatId]?.agent?.avatar);
  return <div className={`pm-agent${on ? ' on' : ''}`} data-mark={a.mark} data-testid="pm-agent" role="button" tabIndex={0} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter') onPick(); }}>
    <div className="pm-agent-head">
      <AgentAvatar avatar={avatar} name={a.role ?? a.title} size={30} />
      <div className="pm-agent-name"><b>{a.title}</b><span>{t('pm.on')} {names}</span></div>
      {a.total > 0 && <Ring done={a.done} total={a.total} />}
    </div>
    {a.total > 0 && <div className="pm-steps" aria-hidden>{Array.from({ length: a.total }, (_, i) => <i key={i} data-s={i < a.done ? 'done' : i === a.done && !DONE_MARKS.has(a.mark) ? 'now' : 'todo'} />)}</div>}
    {a.ask && <p className="pm-agent-ask"><b>{t('pm.asks')}</b> {a.ask}</p>}
    {!a.ask && a.now && <p><b>{t('pm.now')}</b> {a.now}</p>}
    <button type="button" className="btn btn-ghost btn-s" onClick={e => { e.stopPropagation(); openChatRef(a.chatId); }}>{t('pm.openChat')}</button>
  </div>;
}

/** Where each arrow's label sits: nearer the end with fewer arrows (the labels around a busy box do not pile up); for
 *  an arrow across more than one gap, in the first gap beside the box it leaves (never on a box); a label that would
 *  cover one placed before moves along its arrow's direction, a row at a time. */
function placeLabels(lv: Level): { e: LevelEdge; left: number; top: number; flat: boolean }[] {
  const deg = new Map<string, number>();
  for (const e of lv.edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1);
  const placed: { x: number; y: number; w: number }[] = [];
  return lv.edges.flatMap(e => {
    const a = lv.nodes.find(n => n.id === e.from), b = lv.nodes.find(n => n.id === e.to);
    if (!a || !b) return [];
    const p = ends(a, b), flat = p.y1 === p.y2, long = Math.abs(p.y2 - p.y1) > BOX.gy + 20;
    const da = deg.get(e.from) ?? 1, db = deg.get(e.to) ?? 1, f = Math.min(0.7, Math.max(0.3, da / (da + db)));
    const at = long ? { left: p.x1, top: p.y1 + Math.sign(p.y2 - p.y1) * BOX.gy / 2 } : along(p, f);
    const left = at.left;
    let top = at.top;
    const w = Math.min(220, e.label.length * 6.6 + 30), dir = Math.sign(p.y2 - p.y1) || 1;
    for (let i = 0; i < 3 && placed.some(q => Math.abs(q.x - left) < (q.w + w) / 2 && Math.abs(q.y - top) < 24); i++) top += 26 * dir;
    placed.push({ x: left, y: top, w });
    return [{ e, left, top, flat }];
  });
}

export function ProjectMapView({ arg, onArg }: { arg: string | null; onArg: (arg: string | null) => void }) {
  const now = useNow(30_000);
  const [maps, setMaps] = useState<ProjectMapInfo[] | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [version, setVersion] = useState<number | null>(null); // null = now
  const [picked, setPicked] = useState<string | null>(null);
  const [agentOn, setAgentOn] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const [argProject, argLevel] = (arg ?? '').split('/');
  const project = argProject || maps?.[0]?.project || null;
  const level = argLevel || null;

  const loadList = useCallback(() => { void window.sb.invoke('projectmap:list', undefined).then(setMaps, () => setMaps([])); }, []);
  const load = useCallback(() => {
    if (!project) { setView(null); return; }
    void window.sb.invoke('projectmap:view', { project, ...(version !== null ? { version } : {}) }).then(setView, () => setView(null));
  }, [project, version]);
  useEffect(loadList, [loadList]);
  useEffect(load, [load]);
  useEffect(() => window.sb.on('projectmap:changed', p => { loadList(); if (p.project === project && version === null) load(); }), [project, version, load, loadList]);
  useEffect(() => { setVersion(null); setPicked(null); setAgentOn(null); }, [project]);
  useEffect(() => { setPicked(null); setZoom(1); }, [level]);

  const map = view?.map ?? null;
  const live = version === null;
  // the level drawn: the system named in the place, or, for an element with nothing inside, the level that holds it
  // (app_project_map open can name any element: it is then picked)
  const shownLevel = useMemo(() => {
    const e = map?.elements.find(x => x.id === level);
    if (!map || !e) return null;
    return map.elements.some(x => x.parent === e.id) ? e.id : e.parent ?? null;
  }, [map, level]);
  const lv = useMemo(() => (map ? levelOf(map, shownLevel, now) : null), [map, shownLevel, now]);
  // once per place (not on every live reload, which would undo what the user picked since)
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!map || pickedFor.current === level) return;
    pickedFor.current = level;
    if (level && shownLevel !== level && map.elements.some(e => e.id === level)) setPicked(level);
  }, [level, shownLevel, map]);
  useEffect(() => {
    const el = box.current;
    if (!el || !lv) return;
    const measure = () => setFit(Math.min(1, Math.max(0.35, (el.clientWidth - 24) / lv.width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lv]);

  if (maps === null) return <div className="dash-empty">{t('bm.loading')}</div>;
  if (!maps.length || !project) return <section className="dash-panel pm-empty" data-testid="pm-empty"><h3>{t('pm.emptyTitle')}</h3><p>{t('pm.emptyLead')}</p><p className="pm-example">{t('pm.emptyExample')}</p></section>;
  if (!map || !lv) return <div className="dash-empty">{t('bm.loading')}</div>;

  const byId = new Map(map.elements.map(e => [e.id, e]));
  const kids = (id: string) => map.elements.filter(e => e.parent === id).length;
  const agents = live ? view!.agents : [];
  const of = (id: string) => agents.filter(a => a.elements.some(x => x === id || pathTo(map, x).some(p => p.id === id)));
  const lit = new Set(agentOn ? agents.find(a => a.chatId === agentOn)?.elements.flatMap(x => pathTo(map, x).map(p => p.id)) ?? [] : []);
  const st = (e: MapElement) => shown(shownStatus(e, now, view!.changed[e.id]));
  const waiting = [...map.elements, ...map.links].filter(x => x.status === 'blocked' && x.actor === 'user').length;
  const scale = fit * zoom;
  const trail = pathTo(map, shownLevel);
  const hist = view!.history;
  const at = version === null ? hist.length - 1 : hist.findIndex(h => h.version === version);
  const go = (lvl: string | null) => onArg(`${project}${lvl ? `/${lvl}` : ''}`);
  const click = (n: LevelNode) => {
    // a box from outside: its own place (inside it if it has parts, else picked on its level)
    if (n.ctx || kids(n.id)) go(n.id); else setPicked(p => (p === n.id ? null : n.id));
  };
  const sel = picked ? byId.get(picked) : undefined;
  const groups: ['wait' | 'work' | 'done', MapAgent[]][] = [['wait', agents.filter(a => a.mark === 'wait')], ['work', agents.filter(a => !DONE_MARKS.has(a.mark) && a.mark !== 'wait')], ['done', agents.filter(a => DONE_MARKS.has(a.mark))]];
  const names = (a: MapAgent) => a.elements.map(id => byId.get(id)?.name ?? id).join(', ');

  return <div className="pm" data-testid="pm-view">
    <header className="pm-bar">
      {maps.length > 1
        ? <select className="pm-pick" value={project} onChange={e => onArg(e.target.value)} aria-label={t('pm.project')}>{maps.map(m => <option key={m.project} value={m.project}>{m.title}</option>)}</select>
        : <h3>{map.title}</h3>}
      {trail.length > 0 && <nav className="pm-trail" aria-label={t('pm.trail')}>
        <button type="button" onClick={() => go(null)} aria-current={!level || undefined}>{t('pm.top')}</button>
        {trail.map(e => <span key={e.id}>›<button type="button" onClick={() => go(e.id)} aria-current={e.id === shownLevel || undefined}>{e.name}</button></span>)}
      </nav>}
      <span className="sp" />
      {live && waiting > 0 && <span className="pm-waiting" data-testid="pm-waiting">{t('pm.waiting', { n: waiting })}</span>}
      <span className="pm-updated">{t('pm.updated', { at: since(map.updatedAt, now) })}</span>
    </header>
    {!live && <div className="pm-past" data-testid="pm-past">{t('pm.past', { v: map.version, at: since(map.updatedAt, now), by: map.by })} · {map.summary}<button type="button" className="btn btn-s" onClick={() => setVersion(null)}>{t('pm.backNow')}</button></div>}
    <div className="pm-body">
      <div className="pm-canvas" ref={box}>
        <div className="pm-stage" style={{ width: lv.width * scale, height: lv.height * scale }}>
          <div className="pm-plane" style={{ width: lv.width, height: lv.height, transform: `scale(${scale})` }}>
            <svg className="pm-edges" width={lv.width} height={lv.height} aria-hidden>
              <defs>{(['ok', 'work', 'blocked', 'unknown', 'stale'] as const).map(s => <marker key={s} id={`pm-arrow-${s}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`pm-arrow s-${s}`} /></marker>)}</defs>
              {lv.edges.map(e => {
                const a = lv.nodes.find(n => n.id === e.from), b = lv.nodes.find(n => n.id === e.to);
                if (!a || !b) return null;
                const p = ends(a, b), s = shown(e);
                return <path key={`${e.from}>${e.to}`} d={curve(p)} className={`pm-edge s-${s}`} markerEnd={`url(#pm-arrow-${s})`} />;
              })}
            </svg>
            {lv.nodes.map(n => {
              const e = byId.get(n.id)!, s = st(e), k = kids(e.id), who = of(e.id);
              const style: CSSProperties = { left: n.x, top: n.y, width: n.w, height: n.h };
              return <button type="button" key={n.id} className={`pm-node k-${e.kind} s-${s}${n.ctx ? ' ctx' : ''}${picked === e.id ? ' picked' : ''}${lit.has(e.id) ? ' lit' : ''}`}
                style={style} onClick={() => click(n)} data-testid={`pm-node-${e.id}`} title={e.description}>
                <span className="pm-kind">{t(`pm.kind.${e.kind}`)}{k && !n.ctx ? ` · ${t('pm.parts', { n: k })}` : ''}</span>
                <b className="pm-name">{e.name}</b>
                {!n.ctx && <span className="pm-desc">{e.status === 'blocked' && e.note ? e.note : e.description}</span>}
                {!n.ctx && <span className="pm-foot">
                  <i className={`pm-dot s-${s}`} /><span className="pm-st">{t(`pm.state.${s}`)}</span>
                  {who.slice(0, 3).map(a => <span key={a.chatId} className="pm-who" data-mark={a.mark} title={a.title}>{(a.role ?? a.title)[0]?.toUpperCase()}</span>)}
                  {who.length > 3 && <span className="pm-who more">+{who.length - 3}</span>}
                  {live && e.status === 'blocked' && e.actor === 'user' && <em className="pm-you">{t('pm.you')}</em>}
                </span>}
              </button>;
            })}
            {/* the labels above the boxes: a label in a narrow gap is never hidden under one */}
            {placeLabels(lv).map(({ e, left, top, flat }) => <div key={`l${e.from}>${e.to}`} className={`pm-label s-${shown(e)}${flat ? ' flat' : ''}`} style={{ left, top }} title={e.note}>
              {e.label}{e.count > 1 ? ` +${e.count - 1}` : ''}{e.status === 'blocked' && e.actor === 'user' && live && <em>{t('pm.you')}</em>}
            </div>)}
          </div>
        </div>
        <div className="pm-tools">
          <button type="button" className="btn btn-s" onClick={() => setZoom(z => Math.min(2.5, z * 1.25))} aria-label={t('pm.zoomIn')}>+</button>
          <button type="button" className="btn btn-s" onClick={() => setZoom(z => Math.max(0.4, z / 1.25))} aria-label={t('pm.zoomOut')}>−</button>
          <button type="button" className="btn btn-s" onClick={() => setZoom(1)} aria-label={t('pm.fit')}>⤢</button>
        </div>
        <div className="pm-legend" aria-label={t('bm.map.legendLabel')}>
          {(['ok', 'work', 'blocked', 'stale'] as const).map(s => <span key={s}><i className={`pm-dot s-${s}`} />{t(`pm.state.${s}`)}</span>)}
          <span><em className="pm-you">{t('pm.you')}</em>{t('pm.youMeans')}</span>
        </div>
      </div>
      <aside className="pm-side" data-testid="pm-side">
        {sel && <section className="pm-detail" data-testid="pm-detail">
          <span className="dash-eyebrow">{t(`pm.kind.${sel.kind}`).toUpperCase()}</span>
          <h3>{sel.name}</h3>
          {sel.description && <p>{sel.description}</p>}
          <p><i className={`pm-dot s-${st(sel)}`} />{t(`pm.state.${st(sel)}`)}{sel.note ? `: ${sel.note}` : ''}</p>
          <p className="pm-muted">{t('pm.confirmed', { at: since(sel.confirmedAt, now) })}</p>
          {sel.evidence.length > 0 && <p className="pm-muted">{t('pm.files')} {sel.evidence.join(', ')}</p>}
        </section>}
        <div className="pm-side-head"><h3>{t('pm.agents')}</h3><span>{live ? t('pm.agentsCount', { n: agents.length, run: agents.filter(a => a.mark === 'run').length }) : t('pm.agentsPast')}</span></div>
        {live && !agents.length && <p className="pm-muted">{t('pm.noAgents')}</p>}
        {groups.map(([g, list]) => (list.length ? <section key={g} className="pm-group" data-g={g}>
          <h4>{t(`pm.group.${g}`)}</h4>
          {list.map(a => <AgentCard key={a.chatId} a={a} names={names(a)} on={agentOn === a.chatId} onPick={() => setAgentOn(o => (o === a.chatId ? null : a.chatId))} />)}
        </section> : null))}
        {map.corrections.length > 0 && <section className="pm-group"><h4>{t('pm.corrections')}</h4>{map.corrections.map((c, i) => <p key={i} className="pm-muted">{c}</p>)}</section>}
      </aside>
    </div>
    {hist.length > 1 && <footer className="pm-history" data-testid="pm-history">
      <span>{t('pm.history')}</span>
      <input type="range" min={0} max={hist.length - 1} value={Math.max(0, at)} aria-label={t('pm.history')}
        onChange={e => { const i = Number(e.target.value); setVersion(i === hist.length - 1 ? null : hist[i]!.version); }} />
      <span className="pm-hist-at">{t('pm.version', { v: hist[Math.max(0, at)]!.version, n: hist[hist.length - 1]!.version })} · {hist[Math.max(0, at)]!.summary}</span>
    </footer>}
  </div>;
}
