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
// - Planning (ADR 0276): a piece that does not exist yet is dashed «previsto»; a box shows the steps of the plans that
//   work on it (the view's works, live); the side column shows each plan drawn on the map, with «Approva e parti» while
//   it waits, and on an agent's card the change the Orchestrator sent it and when the agent took it. Nothing is edited
//   here: the Orchestrator changes the map from what the user tells it, and is told the box picked (ui.mapPicked).
// Rendered by brain-model/MapPage.tsx (view «Progetti», pageArg progetti/<project>/<system>), beside the Orchestrator's
// column: «Mappe», Ctrl+Shift+S and app_project_map open land there (actions.ts openMaps).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NEW_MS, levelOf, pathTo, shownStatus, type MapPlan, type MapWork, type Level, type LevelEdge, type LevelNode, type MapAgent, type MapElement, type MapState, type ProjectMapInfo, type ProjectMapView as View } from '@shared/project-map';
import { brainBridge, openChatRef } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { useApp } from '../../store/store';
import { closeModal, setMapPicked, setMapsArg, toast, ui } from '../../store/ui';
import { IconArrowLeft, IconChat, IconMaximize, IconMinimize } from '../Icons';
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

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const WORK_MARK = { todo: '○', now: '●', done: '✓', blocked: '✕' } as const;

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
    {a.change && <p className="pm-agent-change" data-seen={a.change.seenAt ? '' : undefined} data-testid="pm-agent-change"><b>{a.change.seenAt ? t('pm.changeSeen', { at: clock(a.change.seenAt) }) : t('pm.changeSent', { at: clock(a.change.at) })}</b> {a.change.text}</p>}
    <button type="button" className="btn btn-ghost btn-s" onClick={e => { e.stopPropagation(); closeModal(); openChatRef(a.chatId); }}>{t('pm.openChat')}</button>
  </div>;
}

/** Where each arrow's label sits: the clearest spot near its arrow. A label never covers a box or another label (the
 *  owner 2026-11-13: «alcune sono in sovrapposizione»): points along the curve and offsets around them are tried, each
 *  scored by what it covers and by how far it strays from the arrow; the best wins. Busy boxes first get their labels
 *  nearer the end with fewer arrows. */
function placeLabels(lv: Level): { e: LevelEdge; left: number; top: number }[] {
  const deg = new Map<string, number>();
  for (const e of lv.edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1);
  const placed: { x: number; y: number; w: number }[] = [];
  const H = 24, PAD = 6;
  const cover = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
    Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const covered = (x: number, y: number, w: number) => {
    const lx = x - w / 2 - PAD, ly = y - H / 2 - PAD, lw = w + 2 * PAD, lh = H + 2 * PAD;
    let c = 0;
    for (const n of lv.nodes) c += cover(lx, ly, lw, lh, n.x, n.y, n.w, n.h);
    for (const q of placed) c += cover(lx, ly, lw, lh, q.x - q.w / 2, q.y - H / 2, q.w, H);
    return c;
  };
  const FS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];
  const DX = [0, -40, 40, -80, 80], DY = [0, -18, 18, -36, 36, -60, 60, -90, 90];
  return lv.edges.flatMap(e => {
    const a = lv.nodes.find(n => n.id === e.from), b = lv.nodes.find(n => n.id === e.to);
    if (!a || !b) return [];
    const p = ends(a, b);
    const da = deg.get(e.from) ?? 1, db = deg.get(e.to) ?? 1, want = Math.min(0.7, Math.max(0.3, da / (da + db)));
    const w = Math.min(220, e.label.length * 6.6 + 30);
    let best = { left: 0, top: 0, cost: Infinity };
    for (const f of FS) {
      const at = along(p, f);
      for (const dy of DY) for (const dx of DX) {
        const left = at.left + dx, top = at.top + dy;
        const cost = covered(left, top, w) * 50 + Math.hypot(dx, dy) + Math.abs(f - want) * 60;
        if (cost < best.cost) best = { left, top, cost };
      }
    }
    placed.push({ x: best.left, y: best.top, w });
    return [{ e, left: best.left, top: best.top }];
  });
}

/** full / onFull: the full screen, held by the caller when it must see it. */
export function ProjectMapView({ arg, onArg, full: fullProp, onFull }: { arg: string | null; onArg: (arg: string | null) => void; full?: boolean; onFull?: (on: boolean) => void }) {
  const now = useNow(30_000);
  const [maps, setMaps] = useState<ProjectMapInfo[] | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [version, setVersion] = useState<number | null>(null); // null = now
  const [picked, setPicked] = useState<string | null>(null);
  const [agentOn, setAgentOn] = useState<string | null>(null);
  // the view on the drawing, like a design canvas (the owner 2026-11-13: «control + rotella zummasse e il drag … per
  // spostare la view, non spostare i riquadri ma spostarsi sul workspace tipo figma»): scale and offset of the plane;
  // fitted (centred, whole level in sight) until the user zooms or drags, then his own until the level changes
  const [cam, setCam] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; far: boolean } | null>(null);
  const dragged = useRef(false);
  const fitNow = useRef<() => void>(() => {});
  const box = useRef<HTMLDivElement>(null);
  // the real full screen (the owner 2026-11-13: «tutto schermo davvero»): the whole view, the window's chrome gone
  const root = useRef<HTMLDivElement>(null);
  // the view covers the whole window at once, and asks the screen too (best effort: the OS full screen may be refused)
  const [fullOwn, setFullOwn] = useState(false);
  const full = fullProp ?? fullOwn;
  const setFull = useCallback((on: boolean) => { if (onFull) onFull(on); else setFullOwn(on); }, [onFull]);
  const toggleFull = () => setFull(!full);
  useEffect(() => {
    const el = root.current;
    if (full && el && document.fullscreenElement !== el) void el.requestFullscreen().catch(() => {});
    if (!full && el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
  }, [full]);
  // the OS full screen left by itself (Esc, F11): the view leaves it too
  const wasScreen = useRef(false);
  useEffect(() => {
    const on = () => { const now = !!root.current && document.fullscreenElement === root.current; if (wasScreen.current && !now) setFull(false); wasScreen.current = now; };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [setFull]);
  // a window opened over it (Ctrl+K, Ctrl+Shift+S…) would sit under the full screen: the full screen steps aside
  const modal = ui.use(s => s.modal);
  const modalAt = useRef(modal);
  useEffect(() => { if (modal !== modalAt.current && modal !== null && full) setFull(false); modalAt.current = modal; }, [modal, full, setFull]);
  // on the page (no window around it) Esc leaves the full screen here
  useEffect(() => {
    if (!full || onFull) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFull(false); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [full, onFull, setFull]);
  const [argProject, argLevel] = (arg ?? '').split('/');
  // a project no longer drawn (or a stale place) falls back to the first one instead of «loading» for ever
  const project = (argProject && (!maps || maps.some(m => m.project === argProject)) ? argProject : maps?.[0]?.project) || null;
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
  // the Orchestrator is told the map, the level and the box on screen (lib/where.ts, ADR 0276); «Mappe» comes back here
  useEffect(() => { setMapPicked(picked); return () => setMapPicked(null); }, [picked]);
  useEffect(() => { if (project) setMapsArg(`${project}${level ? `/${level}` : ''}`); }, [project, level]);
  useEffect(() => { setPicked(null); moved.current = false; }, [level]);

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
  // placed once per level, not on every pan or zoom tick
  const labels = useMemo(() => (lv ? placeLabels(lv) : []), [lv]);
  // once per place (not on every live reload, which would undo what the user picked since)
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    const place = `${project}/${level ?? ''}`;
    if (!map || map.project !== project || pickedFor.current === place) return;
    pickedFor.current = place;
    if (level && shownLevel !== level && map.elements.some(e => e.id === level)) setPicked(level);
  }, [project, level, shownLevel, map]);
  useEffect(() => {
    const el = box.current;
    if (!el || !lv) return;
    // fitted: the whole level in sight, centred (the legend takes ≈56 px at the bottom); never above 100 %
    const measure = () => {
      if (moved.current) return;
      const w = el.clientWidth, h = el.clientHeight;
      const sc = Math.min(1, Math.max(0.2, Math.min((w - 48) / lv.width, (h - 88) / lv.height)));
      setCam({ s: sc, x: (w - lv.width * sc) / 2, y: Math.max(16, (h - 56 - lv.height * sc) / 2) });
    };
    fitNow.current = () => { moved.current = false; measure(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lv, full]);
  // Ctrl + wheel (or a trackpad pinch) zooms toward the pointer; the wheel alone moves the view (Shift: sideways).
  // A native listener: React's wheel handler is passive and could not keep the page from zooming or scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        setCam(c => { const s2 = Math.min(3, Math.max(0.15, c.s * Math.exp(-e.deltaY * 0.0022))); return { s: s2, x: px - (px - c.x) * (s2 / c.s), y: py - (py - c.y) * (s2 / c.s) }; });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setCam(c => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [lv]);

  // Backspace goes up one level while the map has the keyboard (not in a field)
  useEffect(() => {
    if (!shownLevel || !map) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' || e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.defaultPrevented) return;
      // another window over the map has the keyboard
      if (ui.get().modal && !root.current?.closest('.modal-body')) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (a && a !== document.body && !root.current?.contains(a)) return;
      e.preventDefault();
      const parent = map.elements.find(x => x.id === shownLevel)?.parent ?? null;
      onArg(`${project}${parent ? `/${parent}` : ''}`);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shownLevel, map, project, onArg]);

  if (maps === null) return <div className="dash-empty">{t('bm.loading')}</div>;
  if (!maps.length || !project) return <section className="dash-panel pm-empty" data-testid="pm-empty"><h3>{t('pm.emptyTitle')}</h3><p>{t('pm.emptyLead')}</p><p className="pm-example">{t('pm.emptyExample')}</p></section>;
  if (!map || !lv) return <div className="dash-empty">{t('bm.loading')}</div>;

  const byId = new Map(map.elements.map(e => [e.id, e]));
  const kids = (id: string) => map.elements.filter(e => e.parent === id).length;
  const agents = live ? view!.agents : [];
  const of = (id: string) => agents.filter(a => a.elements.some(x => x === id || pathTo(map, x).some(p => p.id === id)));
  const lit = new Set(agentOn ? agents.find(a => a.chatId === agentOn)?.elements.flatMap(x => pathTo(map, x).map(p => p.id)) ?? [] : []);
  const st = (e: MapElement) => shown(shownStatus(e, now, view!.changed[e.id]));
  // the plan steps on a box: its own, and for a system those of its parts
  const worksOf = (id: string): MapWork[] => (live ? [...(view!.works[id] ?? []), ...map.elements.filter(x => x.parent === id).flatMap(x => view!.works[x.id] ?? [])] : []);
  const plans: MapPlan[] = live ? view!.plans : [];
  const decide = (p: MapPlan) => { void window.sb.invoke('chat:plan', { chatId: p.chatId, decision: 'approve', at: p.at }).catch(() => toast(t('pm.planGone'), 'warn')); };
  const change = (p: MapPlan) => { setFull(false); if (!brainBridge.draftToOrchestrator(t('pm.planChangeDraft', { title: p.title }), () => {})) toast(t('pm.noOrchestrator'), 'warn'); };
  const waiting = [...map.elements, ...map.links].filter(x => x.status === 'blocked' && x.actor === 'user').length;
  const scale = cam.s;
  /** zoom by a factor around the canvas centre (the + / − buttons) */
  const zoomBy = (f: number) => {
    const el = box.current; if (!el) return;
    moved.current = true;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setCam(c => { const s2 = Math.min(3, Math.max(0.15, c.s * f)); return { s: s2, x: px - (px - c.x) * (s2 / c.s), y: py - (py - c.y) * (s2 / c.s) }; });
  };
  const refit = () => fitNow.current();
  // drag anywhere on the canvas moves the view (a box is clicked only when the pointer did not travel)
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    dragged.current = false;
    if ((e.target as HTMLElement).closest('.pm-tools, .pm-legend, .pm-talk, .pm-up')) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, far: false };
    const move = (m: PointerEvent) => {
      const d = drag.current; if (!d) return;
      if (m.buttons === 0) { up(); return; }
      const dx = m.clientX - d.x, dy = m.clientY - d.y;
      if (!d.far && Math.hypot(dx, dy) < 4) return;
      d.far = true; dragged.current = true; moved.current = true;
      box.current?.classList.add('dragging');
      setCam(c => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
    };
    const up = () => {
      drag.current = null; box.current?.classList.remove('dragging');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      // the click that follows this release is the one swallowed; none follows on some releases, so the flag ends here
      setTimeout(() => { dragged.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const trail = pathTo(map, shownLevel);
  const hist = view!.history;
  const at = version === null ? hist.length - 1 : hist.findIndex(h => h.version === version);
  const go = (lvl: string | null) => onArg(`${project}${lvl ? `/${lvl}` : ''}`);
  // back up one level, fast (the owner: «quando entro in un riquadro un modo veloce per tornare indietro»): the ← button
  // on the canvas, Backspace, the mouse's back button, a double click on the empty canvas
  const parentOf = shownLevel ? byId.get(shownLevel)?.parent ?? null : null;
  const up = () => { if (shownLevel) go(parentOf); };
  const click = (n: LevelNode) => {
    // a box from outside: its own place (inside it if it has parts, else picked on its level)
    if (n.ctx || kids(n.id)) go(n.id); else setPicked(p => (p === n.id ? null : n.id));
  };
  const sel = picked ? byId.get(picked) : undefined;
  // «Discuti» on a box (the owner 2026-11-13: «ogni riquadro devo poterlo discutere con l'orchestrator in un click»):
  // the full screen and the maps window step aside, the Orchestrator gets a ready draft that quotes the box, not sent
  const talk = (e: MapElement) => {
    const s = st(e), where = pathTo(map, e.parent ?? null).map(x => x.name);
    const text = t('pm.talkDraft', { project: map.title, name: e.name, kind: t(`pm.kind.${e.kind}`), where: where.length ? ` (${where.join(' › ')})` : '',
      state: t(`pm.state.${s}`), note: e.note ? `: ${e.note.replace(/[.\s]+$/, '')}` : '', desc: e.description ? ` ${e.description}.` : '' });
    setFull(false);
    closeModal();
    if (!brainBridge.draftToOrchestrator(text, () => {})) toast(t('pm.noOrchestrator'), 'warn');
  };
  const groups: ['wait' | 'work' | 'done', MapAgent[]][] = [['wait', agents.filter(a => a.mark === 'wait')], ['work', agents.filter(a => !DONE_MARKS.has(a.mark) && a.mark !== 'wait')], ['done', agents.filter(a => DONE_MARKS.has(a.mark))]];
  const names = (a: MapAgent) => a.elements.map(id => byId.get(id)?.name ?? id).join(', ');

  return <div className={`pm${full ? ' pm-full' : ''}`} ref={root} data-testid="pm-view">
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
      <button type="button" className="btn btn-s pm-fullbtn" onClick={toggleFull} aria-pressed={full} data-testid="pm-fullscreen">{full ? <IconMinimize size={14} /> : <IconMaximize size={14} />}{t('pm.fullscreen')}</button>
    </header>
    {!live && <div className="pm-past" data-testid="pm-past">{t('pm.past', { v: map.version, at: since(map.updatedAt, now), by: map.by })} · {map.summary}<button type="button" className="btn btn-s" onClick={() => setVersion(null)}>{t('pm.backNow')}</button></div>}
    {plans.map(p => <section key={p.chatId} className="pm-plan" data-phase={p.phase} data-testid="pm-plan">
      <span className="dash-eyebrow">{t('pm.plan')} · {t(`pm.planPhase.${p.phase}`)}</span>
      <h3>{p.title}</h3>
      <p className="pm-muted pm-plan-n">{t('pm.planSteps', { done: p.done, total: p.steps })}{p.doneWhen ? ` · ${p.doneWhen}` : ''}</p>
      {p.phase === 'proposed' && <div className="pm-plan-act">
        <button type="button" className="btn btn-primary btn-s" onClick={() => decide(p)} data-testid="pm-plan-approve">{t('pm.planApprove')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => change(p)} data-testid="pm-plan-change">{t('pm.planChange')}</button>
      </div>}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => { closeModal(); openChatRef(p.chatId); }}>{t('pm.openChat')}</button>
    </section>)}
    <div className="pm-body">
      <div className="pm-canvas" ref={box} onPointerDown={down} data-testid="pm-canvas" data-scale={scale.toFixed(3)}
        style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${22 * scale}px ${22 * scale}px` }}
        onClickCapture={e => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false; } }}
        onDoubleClick={e => { if (!(e.target as HTMLElement).closest('.pm-node, .pm-talk, .pm-tools, .pm-legend, .pm-up, .pm-label')) up(); }}
        onMouseUp={e => { if (e.button === 3) { e.preventDefault(); e.stopPropagation(); up(); } }}>
        {shownLevel && <button type="button" className="btn btn-s pm-up" onClick={up} data-testid="pm-up" data-tip={t('pm.upTip')}>
          <IconArrowLeft size={13} />{parentOf ? byId.get(parentOf)?.name : t('pm.top')}</button>}
        <div className="pm-stage">
          <div className="pm-plane" style={{ width: lv.width, height: lv.height, transform: `translate(${cam.x}px, ${cam.y}px) scale(${scale})` }}>
            <svg className="pm-edges" width={lv.width} height={lv.height} aria-hidden>
              <defs>{(['ok', 'work', 'blocked', 'unknown', 'stale', 'planned'] as const).map(s => <marker key={s} id={`pm-arrow-${s}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`pm-arrow s-${s}`} /></marker>)}</defs>
              {lv.edges.map(e => {
                const a = lv.nodes.find(n => n.id === e.from), b = lv.nodes.find(n => n.id === e.to);
                if (!a || !b) return null;
                const p = ends(a, b), s = shown(e);
                return <path key={`${e.from}>${e.to}`} d={curve(p)} className={`pm-edge s-${s}`} markerEnd={`url(#pm-arrow-${s})`} />;
              })}
            </svg>
            {lv.nodes.map(n => {
              const e = byId.get(n.id)!, s = st(e), k = kids(e.id), who = of(e.id), ws = n.ctx ? [] : worksOf(e.id);
              const style: CSSProperties = { left: n.x, top: n.y, width: n.w, height: n.h };
              return <button type="button" key={n.id} className={`pm-node k-${e.kind} s-${s}${n.ctx ? ' ctx' : ''}${picked === e.id ? ' picked' : ''}${lit.has(e.id) ? ' lit' : ''}`}
                style={style} onClick={() => click(n)} data-testid={`pm-node-${e.id}`} title={e.description}>
                <span className="pm-kind">{t(`pm.kind.${e.kind}`)}{k && !n.ctx ? ` · ${t('pm.parts', { n: k })}` : ''}</span>
                <b className="pm-name">{e.name}</b>
                {!n.ctx && (ws.length && !(e.status === 'blocked' && e.note)
                  ? <span className="pm-works" data-testid={`pm-works-${e.id}`}>{ws.slice(0, ws.length > 2 ? 1 : 2).map(w => <span key={`${w.chatId}-${w.step}`} data-s={w.state}><i>{WORK_MARK[w.state]}</i>{w.title}</span>)}{ws.length > 2 && <span className="pm-works-more">{t('pm.worksMore', { n: ws.length - 1, done: ws.filter(w => w.state === 'done').length, total: ws.length })}</span>}</span>
                  : <span className="pm-desc">{e.status === 'blocked' && e.note ? e.note : e.description}</span>)}
                {!n.ctx && <span className="pm-foot">
                  <i className={`pm-dot s-${s}`} /><span className="pm-st">{t(`pm.state.${s}`)}</span>
                  {who.slice(0, 3).map(a => <span key={a.chatId} className="pm-who" data-mark={a.mark} title={a.title}>{(a.role ?? a.title)[0]?.toUpperCase()}</span>)}
                  {who.length > 3 && <span className="pm-who more">+{who.length - 3}</span>}
                  {live && e.status === 'blocked' && e.actor === 'user' && <em className="pm-you">{t('pm.you')}</em>}
                  {live && e.addedAt !== undefined && now - e.addedAt < NEW_MS && <em className="pm-new">{t('pm.new')}</em>}
                </span>}
              </button>;
            })}
            {/* «Discuti» on every box: its own button at the box's corner (a button never sits inside another) */}
            {lv.nodes.map(n => <button type="button" key={`talk-${n.id}`} className="pm-talk" style={{ left: n.x + n.w - 30, top: n.y + 6, transform: `scale(${1 / scale})` }}
              onClick={() => talk(byId.get(n.id)!)} aria-label={t('pm.talkOn', { name: byId.get(n.id)!.name })} data-tip={t('pm.talk')} data-testid={`pm-talk-${n.id}`}><IconChat size={13} /></button>)}
            {/* the labels above the boxes: a label in a narrow gap is never hidden under one */}
            {labels.map(({ e, left, top }) => <div key={`l${e.from}>${e.to}`} className={`pm-label s-${shown(e)}`} style={{ left, top }} title={e.note}>
              {e.label}{e.count > 1 ? ` +${e.count - 1}` : ''}{e.status === 'blocked' && e.actor === 'user' && live && <em>{t('pm.you')}</em>}
            </div>)}
          </div>
        </div>
        <div className="pm-tools">
          <button type="button" className="btn btn-s" onClick={() => zoomBy(1.25)} aria-label={t('pm.zoomIn')} data-testid="pm-zoom-in">+</button>
          <span className="pm-pct" data-testid="pm-pct">{Math.round(scale * 100)}%</span>
          <button type="button" className="btn btn-s" onClick={() => zoomBy(1 / 1.25)} aria-label={t('pm.zoomOut')} data-testid="pm-zoom-out">−</button>
          <button type="button" className="btn btn-s" onClick={refit} aria-label={t('pm.fit')} data-tip={t('pm.fit')} data-testid="pm-fit">⤢</button>
        </div>
        <div className="pm-legend" aria-label={t('bm.map.legendLabel')}>
          {(['ok', 'work', 'blocked', 'planned', 'stale'] as const).map(s => <span key={s}><i className={`pm-dot s-${s}`} />{t(`pm.state.${s}`)}</span>)}
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
          {worksOf(sel.id).length > 0 && <ul className="pm-worklist" data-testid="pm-worklist">{worksOf(sel.id).map(w => <li key={`${w.chatId}-${w.step}`} data-s={w.state}><i>{WORK_MARK[w.state]}</i><span>{w.title}{w.added && <em className="pm-new">{t('pm.new')}</em>}</span>{w.role && <small>{w.role}</small>}</li>)}</ul>}
          <button type="button" className="btn btn-s" onClick={() => talk(sel)} data-testid="pm-detail-talk"><IconChat size={13} />{t('pm.talk')}</button>
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
