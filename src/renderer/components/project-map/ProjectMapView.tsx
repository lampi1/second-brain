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
//   work on it (the view's works, live); the side column shows each plan drawn on the map (the approval is a line over
//   the drawing while it waits, ADR 0326), and on an agent's card the change the Orchestrator sent it and when the agent took it. Nothing is edited
//   here: the Orchestrator changes the map from what the user tells it, and is told the box picked (ui.mapPicked).
// - What moves (ADR 0302, the owner 2026-11-13): a box somebody works on right now breathes, quietly, and a line under
//   work carries a moving mark; a plan shows its steps in order, one turn after the other, and each step on a box wears
//   its turn; entering a system zooms into its box and coming back shows the
//   box left; with more than one project they are a list on the left (a row of pills on a narrow page), not a menu.
// - Told in full (ADR 0307, the owner 2026-11-14): the maps the user opens start full screen; a picked box, the system
//   on screen or a picked arrow tells how it works beside the drawing (MapDetail.tsx); the jobs that touch
//   the project are rows that open their own map (work-map/WorkMapView.tsx, ADR 0343); «Aggiorna» asks the Orchestrator to have the project read again and the map redrawn.
// - More detail (ADR 0316, the owner 2026-11-15: «vorrei capire bene come è strutturato senza vederlo»): a part holds
//   parts of its own, entered the same way, up to four levels; a box's panel tells its rules, what it keeps, how big it
//   is, why it is made so and its key files, each opened in the viewer; the paths (MapPaths.tsx) light the boxes of a
//   question one stop at a time, the view following each stop to its level.
// - A project told as a sequence (issue #443, ADR 0322; the owner 2026-11-18): a level of phases or steps is a line,
//   each box numbered in its order, «∥» on the ones that go together; the arrow to the following step is plain and
//   never wears a status; the side panel is wider, dragged by its left edge and remembered (side-width.ts).
// - How far it is (ADR 0326, the owner 2026-11-19: «le mappe servono per tracciare l'andamento di un piano … un
//   progressivo, una percentuale, e più dettagli nella parte dx»): the header carries the percentage; the side panel
//   opens with the progress (MapProgress.tsx: where the project is, what is done now and by whom, what waits for the
//   user, what comes next, every phase with its bar) and with the jobs of the project. Nothing sits over the drawing.
// - The status of a box (issue #456, ADR 0330): a box with pieces inside shows what they say together, never a status
//   of its own (shared/project-map-status.ts statusesOf); a phase or a step that is ok reads «fatto», anything else
//   «funziona»; the statuses move by themselves with the chats linked to the pieces (main/projectmap/service.ts).
// Rendered by brain-model/MapPage.tsx (view «Progetti», pageArg progetti/<project>/<system>), beside the Orchestrator's
// column: «Mappe», Ctrl+Shift+S and app_project_map open land there (actions.ts openMaps).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { countOf, planProgress, progressOf, workingOf } from '@shared/project-map-progress';
import { isStepKind, statusesOf, waitingOf, type ShownState } from '@shared/project-map-status';
import { NEW_MS, descendantsOf, levelOf, pathTo, shownStatus, type MapLink, type MapPlan, type MapWork, type Level, type LevelEdge, type LevelNode, type MapAgent, type MapElement, type MapState, type ProjectMapInfo, type ProjectMapView as View, type MapPath } from '@shared/project-map';
import { brainBridge, openChatRef, openFileViewer, openWorkMap, openInAppBrowser, orchestratorId } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { send, useApp } from '../../store/store';
import { closeModal, setMapPicked, setMapsArg, setMapsFull, toast, ui } from '../../store/ui';
import { IconArrowLeft, IconChat, IconMaximize, IconMinimize, IconRefresh } from '../Icons';
import { AgentAvatar } from '../AgentAvatar';
import { GroupHubs } from './GroupHubs';
import { ElementDetail, LinkDetail, stateText } from './MapDetail';
import { PathList, PathPanel, type Walk } from './MapPaths';
import { ProgressCard, ProgressChip, countText } from './MapProgress';
import { Turn } from './plan-words';
import { StateChip, StepDots } from '../work-map/WorkBits';
import '../work-map/work-map.css';
import { SIDE, clampSide, readSide, writeSide } from './side-width';
import './project-map.css';

type Shown = MapState | 'stale';
const shown = (s: { status: MapState; stale: boolean }): Shown => (s.stale ? 'stale' : s.status);
const DONE_MARKS = new Set(['done', 'idle']);
/** «4 min fa», or «ora» alone */
const since = (ts: number, now: number) => { const a = ago(ts, now); return a === t('appText.format.now') ? a : t('pm.ago', { at: a }); };

/** Where an arrow leaves a box and where it enters the next: bottom → top between rows, side → side on one row; drawn
 *  as a curve that leaves and enters straight (c1, c2 its control points). In a line (#443) the arrow to the place
 *  beside always runs side to side (`side`), and one that goes further follows the corners the layout gives (`route`),
 *  along the lanes between the boxes: it never runs behind a box. */
interface Ends { x1: number; y1: number; x2: number; y2: number; c1: [number, number]; c2: [number, number]; route?: [number, number][] }
function ends(a: LevelNode, b: LevelNode, e?: Pick<LevelEdge, 'side' | 'route'>): Ends {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  if (e?.route && e.route.length > 1) { const [x1, y1] = e.route[0]!, [x2, y2] = e.route[e.route.length - 1]!; return { x1, y1, x2, y2, c1: [x1, y1], c2: [x2, y2], route: e.route }; }
  if (e?.side || Math.abs(ay - by) < 20) {
    const [x1, x2] = ax < bx ? [a.x + a.w, b.x] : [a.x, b.x + b.w], mx = (x1 + x2) / 2;
    return { x1, y1: ay, x2, y2: by, c1: [mx, ay], c2: [mx, by] };
  }
  const [y1, y2] = ay < by ? [a.y + a.h, b.y] : [a.y, b.y + b.h], my = (y1 + y2) / 2;
  return { x1: ax, y1, x2: bx, y2, c1: [ax, my], c2: [bx, my] };
}
/** the corner of a route, rounded: how far from it the straight part stops */
const BEND = 10;
function curve(p: Ends): string {
  if (!p.route) return `M${p.x1},${p.y1} C${p.c1[0]},${p.c1[1]} ${p.c2[0]},${p.c2[1]} ${p.x2},${p.y2}`;
  const r = p.route, toward = (from: [number, number], to: [number, number]) => { const len = Math.hypot(to[0] - from[0], to[1] - from[1]), k = len ? Math.min(BEND, len / 2) / len : 0; return `${from[0] + (to[0] - from[0]) * k},${from[1] + (to[1] - from[1]) * k}`; };
  return `M${r[0]![0]},${r[0]![1]}${r.slice(1, -1).map((c, i) => ` L${toward(c, r[i]!)} Q${c[0]},${c[1]} ${toward(c, r[i + 2]!)}`).join('')} L${p.x2},${p.y2}`;
}
/** the point at f (0..1) along the curve */
function along(p: Ends, f: number): { left: number; top: number } {
  if (p.route) {
    const legs = p.route.slice(1).map((c, i) => Math.hypot(c[0] - p.route![i]![0], c[1] - p.route![i]![1]));
    let d = f * legs.reduce((s, l) => s + l, 0), i = 0;
    while (i < legs.length - 1 && d > legs[i]!) d -= legs[i++]!;
    const from = p.route[i]!, to = p.route[i + 1]!, k = legs[i] ? d / legs[i]! : 0;
    return { left: from[0] + (to[0] - from[0]) * k, top: from[1] + (to[1] - from[1]) * k };
  }
  const g = 1 - f, k = [g * g * g, 3 * g * g * f, 3 * g * f * f, f * f * f] as const;
  return { left: k[0] * p.x1 + k[1] * p.c1[0] + k[2] * p.c2[0] + k[3] * p.x2, top: k[0] * p.y1 + k[1] * p.c1[1] + k[2] * p.c2[1] + k[3] * p.y2 };
}

/** a file of the project as the viewer opens it: the map's folder joined to the path, with the folder's own separator */
export function inRoot(root: string | undefined, rel: string): string {
  if (!root) return rel;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const WORK_MARK = { todo: '○', now: '●', done: '✓', blocked: '✕' } as const;

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** how long «Aggiorna» waits for the redraw before it can be pressed again */
const REFRESH_WAIT_MS = 10 * 60_000;
/** the smallest scale the view picks by itself: under it a box's text cannot be read */
const READABLE = 0.62;
/** how long the view zooms into a box before the level inside it is drawn (project-map.css .pm-plane.zooming) */
const ZOOM_MS = 200;

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
    // the arrow to the following step with nothing written on it says «then» by itself (#443)
    if (!a || !b || !e.label) return [];
    const p = ends(a, b, e);
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
  // a picked arrow: the links it stands for (ADR 0307), told beside the drawing
  const [pickedLinks, setPickedLinks] = useState<string[] | null>(null);
  // «Aggiorna» was pressed at this version: the button waits until the map changes
  const [asked, setAsked] = useState<{ project: string; version: number; at: number } | null>(null);
  const [agentOn, setAgentOn] = useState<string | null>(null);
  // a path walked on the map (ADR 0316): which one and the stop on screen
  const [walk, setWalk] = useState<Walk | null>(null);
  const side = useRef<HTMLElement>(null);
  // the side panel's width (#443): dragged by its left edge, remembered; the grid keeps the drawing its floor
  const body = useRef<HTMLDivElement>(null);
  const [sideW, setSideW] = useState(() => readSide(typeof localStorage === 'undefined' ? undefined : localStorage));
  const storeSide = (w: number) => writeSide(typeof localStorage === 'undefined' ? undefined : localStorage, w);
  /** the width the panel and the drawing share: the body less the projects list and the gaps */
  const sideRoom = () => { const b = body.current; if (!b) return undefined; const nav = b.querySelector<HTMLElement>('.pm-nav'); return b.clientWidth - (nav ? nav.offsetWidth + 12 : 0) - 12; };
  const resizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = side.current?.parentElement?.getBoundingClientRect().width ?? sideW, room = sideRoom();
    // the width is kept only once the edge has moved: a click on it changes nothing
    let last: number | null = null;
    const move = (m: PointerEvent) => { last = clampSide(w0 + x0 - m.clientX, room); setSideW(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); body.current?.classList.remove('resizing'); if (last !== null) storeSide(last); };
    body.current?.classList.add('resizing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const resizeKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? SIDE.step : e.key === 'ArrowRight' ? -SIDE.step : e.key === 'Home' ? SIDE.max : e.key === 'End' ? -SIDE.max : 0;
    if (!d) return;
    e.preventDefault();
    const w = clampSide(sideW + d, sideRoom()); setSideW(w); storeSide(w);
  };
  // a path opened from deep in the side (a box's «Percorsi che passano di qui»): its stops show from the top
  const walking = walk?.path ?? null;
  useEffect(() => { if (walking && side.current) side.current.scrollTop = 0; }, [walking]);
  // the view on the drawing, like a design canvas (the owner 2026-11-13: «control + rotella zummasse e il drag … per
  // spostare la view, non spostare i riquadri ma spostarsi sul workspace tipo figma»): scale and offset of the plane;
  // fitted (centred, whole level in sight) until the user zooms or drags, then his own until the level changes
  const [cam, setCam] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; far: boolean } | null>(null);
  const dragged = useRef(false);
  const fitNow = useRef<() => void>(() => {});
  const whole = useRef(false); // ⤢ was pressed on this level: the whole of it, however small
  const box = useRef<HTMLDivElement>(null);
  // the passage between a level and the one inside it (ADR 0302): the view zooms into the box, then the level inside
  // grows from it; coming back, the level shrinks into place and the box left is marked for a moment
  const [zooming, setZooming] = useState(false);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enter, setEnter] = useState<{ dir: 'in' | 'out'; from: string | null } | null>(null);
  useEffect(() => () => { if (zoomTimer.current) clearTimeout(zoomTimer.current); }, []);
  // the real full screen (the owner 2026-11-13: «tutto schermo davvero»): the whole view, the window's chrome gone
  const root = useRef<HTMLDivElement>(null);
  // the view covers the whole window at once, and asks the screen too (best effort: the OS full screen may be refused)
  const [fullOwn, setFullOwn] = useState(false);
  const full = fullProp ?? fullOwn;
  const setFull = useCallback((on: boolean) => { if (onFull) onFull(on); else setFullOwn(on); }, [onFull]);
  const toggleFull = () => setFull(!full);
  // the maps the user opens start full screen (ADR 0307: «quando le apro le voglio di default full screen»): «Mappe»,
  // Ctrl+Shift+S and the palette ask for it (actions.ts openMaps); the Orchestrator's own opening stays beside it
  const wantFull = ui.use(s => s.mapsFull);
  const [drawn, setDrawn] = useState(false); // the view's root is on screen (not «loading»): the screen can be asked
  // only with a map on screen: over an empty page the full screen would wait, and jump over the Orchestrator when the
  // first map is saved while the user talks to it
  const none = maps !== null && maps.length === 0;
  useEffect(() => { if (!wantFull) return; if (none) setMapsFull(false); else if (drawn) { setMapsFull(false); setFull(true); } }, [wantFull, drawn, none, setFull]);
  useEffect(() => { if (none && full) setFull(false); }, [none, full, setFull]);
  useEffect(() => {
    const el = root.current;
    if (full && el && document.fullscreenElement !== el) void el.requestFullscreen().catch(() => {});
    if (!full && el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
  }, [full, drawn]);
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
  useEffect(() => { setVersion(null); setPicked(null); setPickedLinks(null); setAgentOn(null); setWalk(null); }, [project]);
  // the Orchestrator is told the map, the level and the box on screen (lib/where.ts, ADR 0276); «Mappe» comes back here
  useEffect(() => { setMapPicked(picked); return () => setMapPicked(null); }, [picked]);
  useEffect(() => { if (project) setMapsArg(`${project}${level ? `/${level}` : ''}`); }, [project, level]);
  useEffect(() => { setPicked(null); setPickedLinks(null); moved.current = false; whole.current = false; }, [level, project]);
  useEffect(() => { if (picked) setPickedLinks(null); }, [picked]);

  const map = view?.map ?? null;
  useEffect(() => { setDrawn(!!map); }, [map]);
  const live = version === null;
  // the level drawn: the system named in the place, or, for an element with nothing inside, the level that holds it
  // (app_project_map open can name any element: it is then picked)
  const shownLevel = useMemo(() => {
    const e = map?.elements.find(x => x.id === level);
    if (!map || !e) return null;
    return map.elements.some(x => x.parent === e.id) ? e.id : e.parent ?? null;
  }, [map, level]);
  const lv = useMemo(() => (map ? levelOf(map, shownLevel, now) : null), [map, shownLevel, now]);
  // How far the project is (ADR 0326), counted once per version of the view, not on every pan or zoom tick. The pieces
  // somebody works on right now (a plan's step under way, an agent at work) count as under way whatever their status.
  const working = useMemo(() => (view && live ? workingOf(view) : new Set<string>()), [view, live]);
  const progress = useMemo(() => (map ? progressOf(map, working) : null), [map, working]);
  // what each box shows (#456): its own status, or for a box with pieces inside what they say together
  const statuses = useMemo(() => (map ? statusesOf(map, now, view?.changed ?? {}) : new Map<string, ShownState>()), [map, now, view]);
  // on a map that tells a plan, each box with pieces inside wears its own count
  const counts = useMemo(() => {
    const out = new Map<string, NonNullable<ReturnType<typeof countOf>>>();
    if (!map || !progress) return out;
    for (const id of new Set(map.elements.flatMap(e => (e.parent ? [e.parent] : [])))) { const c = countOf(map, id, working); if (c) out.set(id, c); }
    return out;
  }, [map, progress, working]);
  // which way the level changed: deeper (in) or back up (out, from the system just left)
  const lastLevel = useRef<{ project: string | null; level: string | null; path: string[] } | null>(null);
  useEffect(() => {
    if (!map || map.project !== project) return;
    const path = pathTo(map, shownLevel).map(e => e.id), last = lastLevel.current;
    if (last && last.project === project && last.level !== shownLevel) {
      const out = path.length < last.path.length;
      // back up, even several levels at once: the box left is the one on this level that held where the user was
      setEnter({ dir: out ? 'out' : 'in', from: out ? last.path[path.length] ?? null : null });
    } else if (!last || last.project !== project) setEnter(null);
    lastLevel.current = { project, level: shownLevel, path };
    setZooming(false);
  }, [map, project, shownLevel]);
  // the place changed while the view was zooming into a box (Backspace, another project): that zoom is dropped
  useEffect(() => { if (zoomTimer.current) { clearTimeout(zoomTimer.current); zoomTimer.current = null; } setZooming(false); }, [project, level]);
  // the path walked: its stop on screen, and the view follows each new stop to the level that shows its box
  const walkPath = walk && map ? map.paths?.find(p => p.id === walk.path) : undefined;
  const walkStop = walk && walkPath ? walkPath.stops[walk.i] : undefined;
  const walkedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!walk || !walkStop || !map) { walkedTo.current = null; return; }
    const key = `${walk.path}/${walk.i}`;
    if (walkedTo.current === key) return;
    walkedTo.current = key;
    const want = map.elements.find(e => e.id === walkStop.on)?.parent ?? null;
    if (want !== shownLevel) onArg(`${project}${want ? `/${want}` : ''}`);
  }, [walk, walkStop, map, shownLevel, project, onArg]);
  // ← → move along the path while the map has the keyboard (not in a field)
  useEffect(() => {
    if (!walk || !walkPath) return;
    const key = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      // the viewer over the page (a stop's file), a window over the map or another column has the keyboard
      if (ui.get().viewer.open || (ui.get().modal && !root.current?.closest('.modal-body'))) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (a && a !== document.body && !root.current?.contains(a)) return;
      const i = walk.i + (e.key === 'ArrowRight' ? 1 : -1);
      if (i < 0 || i >= walkPath.stops.length) return;
      e.preventDefault();
      setWalk({ path: walk.path, i });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [walk, walkPath]);
  // a path gone from the map (a redraw, the history): the walk ends
  useEffect(() => { if (walk && map && !walkStop) setWalk(null); }, [walk, map, walkStop]);
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
    // fitted: the level in sight, centred (the legend takes ≈56 px at the bottom); never above 100 %, and by itself
    // never so small that the boxes cannot be read (ADR 0307): a tall level starts from its top and the wheel moves
    // down it. ⤢ shows the whole level whatever its size.
    const measure = () => {
      if (moved.current) return;
      const w = el.clientWidth, h = el.clientHeight;
      const sc = Math.min(1, Math.max(whole.current ? 0.2 : READABLE, Math.min((w - 48) / lv.width, (h - 88) / lv.height)));
      setCam({ s: sc, x: Math.max(16, (w - lv.width * sc) / 2), y: Math.max(16, (h - 56 - lv.height * sc) / 2) });
    };
    fitNow.current = () => { moved.current = false; whole.current = true; measure(); };
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
  /** its pieces are steps (or phases): counted as «passi» */
  const stepsIn = (id: string) => map.elements.some(e => e.parent === id && (e.kind === 'step' || e.kind === 'phase'));
  const agents = live ? view!.agents : [];
  const of = (id: string) => agents.filter(a => a.elements.some(x => x === id || pathTo(map, x).some(p => p.id === id)));
  const lit = new Set(agentOn ? agents.find(a => a.chatId === agentOn)?.elements.flatMap(x => pathTo(map, x).map(p => p.id)) ?? [] : []);
  const st = (e: MapElement) => shown(statuses.get(e.id) ?? shownStatus(e, now, view!.changed[e.id]));
  /** it waits for the user: the piece itself, or a piece inside it */
  const yours = (e: MapElement) => statuses.get(e.id)?.status === 'blocked' && statuses.get(e.id)?.actor === 'user';
  // the plan steps on a box: its own, and for a system those of its parts (and theirs, at every depth)
  const worksOf = (id: string): MapWork[] => (live ? [...(view!.works[id] ?? []), ...[...descendantsOf(map, id)].flatMap(x => view!.works[x] ?? [])] : []);
  // the path walked on the drawing: each box shows the stops on it or inside it, the stop on screen stands out
  const stopsOn = new Map<string, number[]>();
  for (const [k, s] of (walkPath?.stops ?? []).entries()) for (const e of pathTo(map, s.on)) stopsOn.set(e.id, [...(stopsOn.get(e.id) ?? []), k + 1]);
  const nowOn = new Set(walkStop ? pathTo(map, walkStop.on).map(e => e.id) : []);
  const startWalk = (p: MapPath, i: number) => { setPicked(null); setPickedLinks(null); setWalk({ path: p.id, i }); };
  // a key file, a stop's file or a file a piece was read from: the viewer shows it (the full screen steps aside, the
  // viewer opens over the page)
  const openFile = (rel: string) => { setFull(false); openFileViewer(inRoot(map.root, rel)); };
  // a proof's or a link's address: a tab of the app's browser (the full screen steps aside)
  const openLink = (href: string) => { setFull(false); void openInAppBrowser(href); };
  const askPath = () => { setFull(false); if (!brainBridge.draftToOrchestrator(t('pm.pathAskDraft', { title: map.title }), () => {})) toast(t('pm.noOrchestrator'), 'warn'); };
  const plans: MapPlan[] = live ? view!.plans : [];
  // what waits for the user: the pieces themselves (a box that holds one is not counted again) and the links
  const waiting = waitingOf(map, statuses);
  // the number in the header: the project's own count, else the one of the plan under way on this map
  const mainPlan = plans.find(p => p.phase === 'running') ?? plans.find(p => p.phase !== 'done');
  const headline = progress ? { pct: progress.pct, tip: countText(progress) }
    : mainPlan ? { pct: planProgress(mainPlan).pct, tip: `${mainPlan.title}: ${t('pm.planSteps', { done: mainPlan.done, total: mainPlan.steps })}` } : null;
  const cap = (x: string) => (x ? x[0]!.toUpperCase() + x.slice(1) : x);
  /** who works on a piece right now, in words: the agents at work on it and the roles of the plan steps under way on it */
  const whoOf = (id: string): string | undefined => {
    const names = [...new Set([...of(id).filter(a => a.mark === 'run').map(a => cap(a.role ?? a.title)), ...worksOf(id).filter(w => w.state === 'now' && w.role).map(w => cap(w.role!))])];
    return names.length ? t('pm.prog.by', { who: names.join(', ') }) : undefined;
  };
  const jobs = live ? view!.jobs ?? [] : [];
  const openJob = (id: string) => { setFull(false); closeModal(); openWorkMap(id); };
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
  // the legend's word for ok: «fatto» on a level of phases and steps, «funziona» on a level of systems, both when mixed
  const own = lv.nodes.filter(n => !n.ctx).map(n => isStepKind(byId.get(n.id)?.kind));
  const okWords = own.length && own.every(Boolean) ? t('pm.state.done') : own.some(Boolean) ? `${t('pm.state.ok')} / ${t('pm.state.done')}` : t('pm.state.ok');
  const trail = pathTo(map, shownLevel);
  const hist = view!.history;
  const at = version === null ? hist.length - 1 : hist.findIndex(h => h.version === version);
  const go = (lvl: string | null) => onArg(`${project}${lvl ? `/${lvl}` : ''}`);
  // back up one level, fast (the owner: «quando entro in un riquadro un modo veloce per tornare indietro»): the ← button
  // on the canvas, Backspace, the mouse's back button, a double click on the empty canvas
  const parentOf = shownLevel ? byId.get(shownLevel)?.parent ?? null : null;
  const up = () => { if (shownLevel) go(parentOf); };
  /** into a system: the view first zooms into its box (ZOOM_MS), then the level inside is drawn */
  const enterBox = (n: LevelNode) => {
    const el = box.current;
    if (zoomTimer.current) return;
    if (!el || reduced()) { go(n.id); return; }
    const w = el.clientWidth, h = el.clientHeight, s2 = Math.min(3, Math.min((w * 0.9) / n.w, (h * 0.9) / n.h));
    setZooming(true);
    setCam({ s: s2, x: w / 2 - (n.x + n.w / 2) * s2, y: h / 2 - (n.y + n.h / 2) * s2 });
    zoomTimer.current = setTimeout(() => { zoomTimer.current = null; go(n.id); }, ZOOM_MS);
  };
  const click = (n: LevelNode) => {
    // a box from outside: its own place (inside it if it has parts, else picked on its level)
    if (kids(n.id) && !n.ctx) enterBox(n); else if (n.ctx || kids(n.id)) go(n.id); else setPicked(p => (p === n.id ? null : n.id));
  };
  /** a plan's step shows the box it works on: its place (go picks it there), or picked again when already there */
  const show = (id: string) => { if (level === id && !kids(id)) setPicked(id); else go(id); };
  const sel = picked ? byId.get(picked) : undefined;
  // nothing picked inside a system: the system itself is told
  const selLinks = pickedLinks ? map.links.filter(l => pickedLinks.includes(l.id)) : [];
  const here = !sel && !selLinks.length && shownLevel ? byId.get(shownLevel) : undefined;
  const stLink = (l: MapLink) => shown(shownStatus(l, now));
  // «Aggiorna» (ADR 0307: «vorrei anche poterle aggiornare da un tasto»): the Orchestrator has the project read again
  // and the map redrawn, details included; the drawing changes by itself when the new version is saved
  // The button waits for a new version of this map, ten minutes at most (the Orchestrator may ask something first).
  const waitingRefresh = !!asked && asked.project === map.project && asked.version === map.version && now - asked.at < REFRESH_WAIT_MS;
  const refresh = () => {
    const r = orchestratorId();
    // a toast sits under the full screen: without an Orchestrator, or with nothing sent, the full screen steps aside
    if (!r) { setFull(false); toast(t('pm.noOrchestrator'), 'warn'); return; }
    if (send(r, t('pm.refreshAsk', { title: map.title, project: map.project })) === 'empty') { setFull(false); toast(t('pm.refreshFailed'), 'warn'); return; }
    setAsked({ project: map.project, version: map.version, at: now });
  };
  // «Discuti» on a box (the owner 2026-11-13: «ogni riquadro devo poterlo discutere con l'orchestrator in un click»):
  // the full screen and the maps window step aside, the Orchestrator gets a ready draft that quotes the box, not sent
  const talk = (e: MapElement) => {
    const s = st(e), where = pathTo(map, e.parent ?? null).map(x => x.name);
    const text = t('pm.talkDraft', { project: map.title, name: e.name, kind: t(`pm.kind.${e.kind}`), where: where.length ? ` (${where.join(' › ')})` : '',
      state: stateText(s, e.kind), note: e.note ? `: ${e.note.replace(/[.\s]+$/, '')}` : '', desc: e.description ? ` ${e.description}.` : '' });
    setFull(false);
    closeModal();
    if (!brainBridge.draftToOrchestrator(text, () => {})) toast(t('pm.noOrchestrator'), 'warn');
  };
  const groups: ['wait' | 'work' | 'done', MapAgent[]][] = [['wait', agents.filter(a => a.mark === 'wait')], ['work', agents.filter(a => !DONE_MARKS.has(a.mark) && a.mark !== 'wait')], ['done', agents.filter(a => DONE_MARKS.has(a.mark))]];
  const names = (a: MapAgent) => a.elements.map(id => byId.get(id)?.name ?? id).join(', ');

  return <div className={`pm${full ? ' pm-full' : ''}`} ref={root} data-testid="pm-view">
    <header className="pm-bar">
      <h3>{map.title}</h3>
      {trail.length > 0 && <nav className="pm-trail" aria-label={t('pm.trail')}>
        <button type="button" onClick={() => go(null)} aria-current={!level || undefined}>{t('pm.top')}</button>
        {trail.map(e => <span key={e.id}>›<button type="button" onClick={() => go(e.id)} aria-current={e.id === shownLevel || undefined}>{e.name}</button></span>)}
      </nav>}
      <span className="sp" />
      {headline && <ProgressChip pct={headline.pct} tip={headline.tip} />}
      {live && waiting > 0 && <span className="pm-waiting" data-testid="pm-waiting">{t('pm.waiting', { n: waiting })}</span>}
      {/* said inside the view: a toast and a tip sit under the full screen */}
      {live && waitingRefresh ? <span className="pm-updated pm-asked" role="status" data-testid="pm-refresh-note">{t('pm.refreshAsked')}</span>
        : <span className="pm-updated">{t('pm.updated', { at: since(map.updatedAt, now) })}</span>}
      {live && <button type="button" className="btn btn-s pm-refresh" onClick={refresh} disabled={waitingRefresh} title={t('pm.refreshTip')} data-testid="pm-refresh"><IconRefresh size={14} />{t(waitingRefresh ? 'pm.refreshing' : 'pm.refresh')}</button>}
      <button type="button" className="btn btn-s pm-fullbtn" onClick={toggleFull} aria-pressed={full} data-testid="pm-fullscreen">{full ? <IconMinimize size={14} /> : <IconMaximize size={14} />}{t('pm.fullscreen')}</button>
    </header>
    {!live && <div className="pm-past" data-testid="pm-past">{t('pm.past', { v: map.version, at: since(map.updatedAt, now), by: map.by })} · {map.summary}<button type="button" className="btn btn-s" onClick={() => setVersion(null)}>{t('pm.backNow')}</button></div>}
    <div className={`pm-body${maps.length > 1 ? ' with-nav' : ''}`} ref={body} style={{ '--pm-side': `${sideW}px` } as CSSProperties}>
      {/* the projects, a list beside the drawing like the newspaper's sections (ADR 0302: no menu to open) */}
      {maps.length > 1 && <nav className="pm-nav" aria-label={t('pm.projects')} data-testid="pm-nav">
        <div className="pm-nav-lbl">{t('pm.projects')}</div>
        {maps.map(m => <button type="button" key={m.project} className={m.project === project ? 'on' : ''} aria-pressed={m.project === project} onClick={() => onArg(m.project)} data-testid={`pm-nav-${m.project}`}>
          <i className={`pm-dot ${m.waiting ? 's-wait' : 's-ok'}`} /><span>{m.title}</span>{m.waiting > 0 && <em className="pm-you" title={t('pm.waiting', { n: m.waiting })}>{m.waiting}</em>}
        </button>)}
      </nav>}
      <div className="pm-canvas" ref={box} onPointerDown={down} data-testid="pm-canvas" data-scale={scale.toFixed(3)}
        style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${22 * scale}px ${22 * scale}px` }}
        onClickCapture={e => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false; } }}
        onDoubleClick={e => { if (!(e.target as HTMLElement).closest('.pm-node, .pm-frame-head, .pm-talk, .pm-tools, .pm-legend, .pm-up, .pm-label')) up(); }}
        onMouseUp={e => { if (e.button === 3) { e.preventDefault(); e.stopPropagation(); up(); } }}>
        {shownLevel && <button type="button" className="btn btn-s pm-up" onClick={up} data-testid="pm-up" data-tip={t('pm.upTip')}>
          <IconArrowLeft size={13} />{parentOf ? byId.get(parentOf)?.name : t('pm.top')}</button>}
        <div className="pm-stage">
          <div className={`pm-plane${zooming ? ' zooming' : ''}${walkPath ? ' walking' : ''}`} style={{ width: lv.width, height: lv.height, transform: `translate(${cam.x}px, ${cam.y}px) scale(${scale})` }}>
            <div className="pm-level" key={`${project}/${shownLevel ?? ''}`} data-enter={enter?.dir} data-layout={lv.linear ? 'linear' : 'auto'} data-testid="pm-level">
            {/* a phase drawn open (ADR 0335): a frame with its name, its count and its bar; its steps sit inside it */}
            {lv.nodes.filter(n => n.frame).map(n => {
              const e = byId.get(n.id)!, cnt = counts.get(e.id);
              return <div key={`fr-${n.id}`} className={`pm-frame s-${st(e)}${picked === e.id ? ' picked' : ''}${lit.has(e.id) ? ' lit' : ''}`} style={{ left: n.x, top: n.y, width: n.w, height: n.h }} data-testid={`pm-frame-${e.id}`}>
                <button type="button" className="pm-frame-head" onClick={() => click(n)} title={e.description} data-testid={`pm-node-${e.id}`}>
                  {n.n !== undefined && <i className="pm-ord" data-testid={`pm-ord-${e.id}`}>{n.n}</i>}<b>{e.name}</b>
                  <i className={`pm-dot s-${st(e)}`} /><span className="pm-st" data-testid={`pm-st-${e.id}`}>{stateText(st(e), e.kind)}</span>
                  {cnt && <span className="pm-cnt" title={countText(cnt)} data-testid={`pm-count-${e.id}`}>{cnt.done}/{cnt.total}</span>}
                </button>
                {cnt && <span className="pm-frame-meter" aria-hidden><i style={{ width: `${cnt.pct}%` }} /></span>}
              </div>;
            })}
            {/* the boxes that go together (ADR 0335): a dashed frame in the colour of «together», never a status colour */}
            {(lv.groups ?? []).map(g => <div key={`g-${g.ids.join('+')}`} className="pm-pgroup" style={{ left: g.x, top: g.y, width: g.w, height: g.h }} data-testid={`pm-group-${g.ids[0]}`}>
              <span className="pm-pgroup-label">{t('pm.parGroup', { n: g.ids.length })}</span></div>)}
            <svg className="pm-edges" width={lv.width} height={lv.height} aria-hidden>
              <defs>{(['ok', 'work', 'blocked', 'unknown', 'stale', 'planned', 'next', 'fan'] as const).map(s => <marker key={s} id={`pm-arrow-${s}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={`pm-arrow s-${s}`} /></marker>)}</defs>
              {lv.edges.map(e => {
                const a = lv.nodes.find(n => n.id === e.from), b = lv.nodes.find(n => n.id === e.to);
                if (!a || !b) return null;
                // the arrow to the following step: plain, whatever the statuses around it (#443)
                const p = ends(a, b, e), s = e.fan ? 'fan' : e.kind === 'next' ? 'next' : shown(e);
                return <g key={`${e.from}>${e.to}`} data-testid={e.kind === 'next' ? `pm-next-${e.from}-${e.to}` : undefined}>
                  <path d={curve(p)} className={`pm-edge s-${s}`} markerEnd={`url(#pm-arrow-${s})`} />
                  {/* a line under work carries a mark that travels along it */}
                  {live && s === 'work' && <path d={curve(p)} className="pm-edge-run" pathLength={100} />}
                </g>;
              })}
              {/* where a group splits (top edge of its frame) and where it joins again (bottom edge) */}
              {/* a point only where an arrow passes: no split point for a group that opens its phase, no join point for one that closes it */}
              <GroupHubs groups={lv.groups} />
            </svg>
            {lv.nodes.filter(n => !n.frame).map(n => {
              const e = byId.get(n.id)!, s = st(e), k = kids(e.id), who = of(e.id), ws = n.ctx ? [] : worksOf(e.id), cnt = n.ctx ? undefined : counts.get(e.id);
              const faces = live && yours(e) ? 1 : 3;
              // somebody works on it right now: a step of a plan under way, or an agent at work on it
              const running = live && (worksOf(e.id).some(w => w.state === 'now') || who.some(a => a.mark === 'run'));
              const style: CSSProperties = { left: n.x, top: n.y, width: n.w, height: n.h };
              return <button type="button" key={n.id} className={`pm-node k-${e.kind} s-${s}${n.n !== undefined ? ' in-line' : ''}${n.ctx ? ' ctx' : ''}${picked === e.id ? ' picked' : ''}${lit.has(e.id) ? ' lit' : ''}${stopsOn.has(e.id) ? ' on-path' : ''}${nowOn.has(e.id) ? ' stop-now' : ''}${running ? ' running' : ''}${enter?.from === e.id ? ' came' : ''}`}
                style={style} onClick={() => click(n)} data-testid={`pm-node-${e.id}`} data-running={running ? '' : undefined} title={e.description}
                onAnimationEnd={ev => { if (ev.animationName === 'pm-came') setEnter(x => (x ? { ...x, from: null } : x)); }}>
                <span className="pm-kind">{n.n !== undefined && <i className="pm-ord" data-testid={`pm-ord-${e.id}`}>{n.n}</i>}{t(`pm.kind.${e.kind}`)}{k && !n.ctx ? ` · ${t(stepsIn(e.id) ? 'pm.stepsCount' : 'pm.parts', { n: k })}` : ''}{n.par && <em className="pm-par" title={t('pm.withPrev')} data-testid={`pm-par-${e.id}`}>∥</em>}</span>
                {stopsOn.has(e.id) && <span className="pm-stopnum" data-testid={`pm-stopnum-${e.id}`}>{stopsOn.get(e.id)!.slice(0, 4).join(' · ')}{stopsOn.get(e.id)!.length > 4 ? ' …' : ''}</span>}
                <b className="pm-name">{e.name}</b>
                {!n.ctx && (ws.length && !(s === 'blocked' && e.note)
                  ? <span className="pm-works" data-testid={`pm-works-${e.id}`}>{(ws.length > 2 ? [ws.find(w => w.state === 'now') ?? ws.find(w => w.state !== 'done') ?? ws[0]!] : ws).map(w => <span key={`${w.chatId}-${w.step}`} data-s={w.state}><i>{WORK_MARK[w.state]}</i><Turn wave={w.wave} par={w.par} />{w.title}</span>)}{ws.length > 2 && <span className="pm-works-more">{t('pm.worksMore', { n: ws.length - 1, done: ws.filter(w => w.state === 'done').length, total: ws.length })}</span>}</span>
                  : <span className="pm-desc">{s === 'blocked' && e.note ? e.note : e.description}</span>)}
                {!n.ctx && <span className="pm-foot">
                  <i className={`pm-dot s-${s}`} /><span className="pm-st" data-testid={`pm-st-${e.id}`}>{stateText(s, e.kind)}</span>
                  {cnt && <span className="pm-cnt" title={countText(cnt)} data-testid={`pm-count-${e.id}`}>{cnt.done}/{cnt.total}</span>}
                  {/* with the «Tu» badge one face only: the status word keeps its place */}
                  {who.slice(0, faces).map(a => <span key={a.chatId} className="pm-who" data-mark={a.mark} title={a.title}>{(a.role ?? a.title)[0]?.toUpperCase()}</span>)}
                  {who.length > faces && <span className="pm-who more">+{who.length - faces}</span>}
                  {live && yours(e) && <em className="pm-you">{t('pm.you')}</em>}
                  {live && e.addedAt !== undefined && now - e.addedAt < NEW_MS && <em className="pm-new">{t('pm.new')}</em>}
                </span>}
                {/* its own count along the bottom edge: how much of what is inside is done */}
                {cnt && <span className="pm-node-meter" aria-hidden><i style={{ width: `${cnt.pct}%` }} /></span>}
              </button>;
            })}
            {/* «Discuti» on every box: its own button at the box's corner (a button never sits inside another) */}
            {lv.nodes.map(n => <button type="button" key={`talk-${n.id}`} className="pm-talk" style={{ left: n.x + n.w - 30, top: n.y + (n.frame ? 12 : 6), transform: `scale(${1 / scale})` }}
              onClick={() => talk(byId.get(n.id)!)} aria-label={t('pm.talkOn', { name: byId.get(n.id)!.name })} data-tip={t('pm.talk')} data-testid={`pm-talk-${n.id}`}><IconChat size={13} /></button>)}
            {/* the labels above the boxes: a label in a narrow gap is never hidden under one */}
            {labels.map(({ e, left, top }) => <button type="button" key={`l${e.from}>${e.to}`} className={`pm-label s-${e.kind === 'next' ? 'next' : shown(e)}${pickedLinks?.includes(e.id) ? ' picked' : ''}`} style={{ left, top }} title={e.note}
              aria-pressed={!!pickedLinks?.includes(e.id)} onClick={() => { setPicked(null); setPickedLinks(p => (p?.includes(e.id) ? null : e.ids)); }} data-testid={`pm-label-${e.id}`}>
              {e.label}{e.count > 1 ? ` +${e.count - 1}` : ''}{e.status === 'blocked' && e.actor === 'user' && live && <em>{t('pm.you')}</em>}
            </button>)}
            </div>
          </div>
        </div>
        <div className="pm-tools">
          <button type="button" className="btn btn-s" onClick={() => zoomBy(1.25)} aria-label={t('pm.zoomIn')} data-testid="pm-zoom-in">+</button>
          <span className="pm-pct" data-testid="pm-pct">{Math.round(scale * 100)}%</span>
          <button type="button" className="btn btn-s" onClick={() => zoomBy(1 / 1.25)} aria-label={t('pm.zoomOut')} data-testid="pm-zoom-out">−</button>
          <button type="button" className="btn btn-s" onClick={refit} aria-label={t('pm.fit')} data-tip={t('pm.fit')} data-testid="pm-fit">⤢</button>
        </div>
        <div className="pm-legend" aria-label={t('bm.map.legendLabel')}>
          {(['ok', 'work', 'blocked', 'planned', 'stale'] as const).map(s => <span key={s}><i className={`pm-dot s-${s}`} />{s === 'ok' ? okWords : t(`pm.state.${s}`)}</span>)}
          {live && lv.nodes.some(n => of(n.id).some(a => a.mark === 'run') || worksOf(n.id).some(w => w.state === 'now')) && <span data-testid="pm-legend-run"><i className="pm-dot s-work run" />{t('pm.runningNow')}</span>}
          <span><em className="pm-you">{t('pm.you')}</em>{t('pm.youMeans')}</span>
          {!!lv.groups?.length && <span data-testid="pm-legend-par"><i className="pm-legend-par" />{t('pm.parLegend')}</span>}
        </div>
      </div>
      <div className="pm-sidewrap" data-testid="pm-sidewrap">
      {/* the panel's left edge: dragged to make it wider or narrower (#443); a double click puts the starting width back */}
      <div className="pm-resize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={t('pm.resize')} title={t('pm.resize')} aria-valuemin={SIDE.min} aria-valuemax={SIDE.max} aria-valuenow={sideW}
        onPointerDown={resizeDown} onKeyDown={resizeKey} onDoubleClick={() => { setSideW(SIDE.def); storeSide(SIDE.def); }} data-testid="pm-resize" />
      <aside className="pm-side" ref={side} data-testid="pm-side">
        {walkPath && walk && <PathPanel map={map} path={walkPath} i={walk.i} onStep={i => setWalk({ path: walkPath.id, i })} onClose={() => setWalk(null)} onShow={show} onFile={openFile} />}
        {sel && <ElementDetail count={counts.get(sel.id)} map={map} el={sel} state={st(sel)} stateOfLink={stLink} confirmed={t('pm.confirmed', { at: since(sel.confirmedAt, now) })} works={worksOf(sel.id)} onTalk={() => talk(sel)} onShow={show} onFile={openFile} onWalk={startWalk} stateOfEl={st} onLink={openLink} />}
        {selLinks.length > 0 && <LinkDetail map={map} links={selLinks} stateOfLink={stLink} onShow={show} />}
        {/* how far the project is; then the jobs that touch it: each opens its own map (ADR 0343) */}
        {progress && <ProgressCard p={progress} compact={!!sel || selLinks.length > 0 || !!walkPath || !!shownLevel} whoOf={whoOf} onShow={show} />}
        {jobs.length > 0 && <section className="pm-group" data-testid="pm-jobs"><h4>{t('pm.jobs')}</h4><ul className="wm-jobs">
          {jobs.map(j => <li key={j.id} className="wm-job" data-testid={`pm-job-${j.id}`}><b>{j.title}</b><StateChip info={j} />{j.steps > 0 && <><StepDots info={j} /><span>{t('wm.steps', { done: j.done, n: j.steps })}</span></>}<button type="button" className="btn btn-ghost btn-s" onClick={() => openJob(j.id)} data-testid={`pm-job-open-${j.id}`}>{t('wm.open')}</button></li>)}
        </ul></section>}
        {here && !walkPath && <ElementDetail count={counts.get(here.id)} map={map} el={here} state={st(here)} stateOfLink={stLink} confirmed={t('pm.confirmed', { at: since(here.confirmedAt, now) })} works={here.kind === 'part' || here.kind === 'phase' || here.kind === 'step' ? worksOf(here.id) : []} onTalk={() => talk(here)} onShow={show} onFile={openFile} onWalk={startWalk} stateOfEl={st} onLink={openLink} testid="pm-here" lead={t('pm.youAreIn')} />}
        {!walkPath && <PathList map={map} onWalk={startWalk} onAsk={askPath} />}
        <div className="pm-side-head"><h3>{t('pm.agents')}</h3><span>{live ? t('pm.agentsCount', { n: agents.length, run: agents.filter(a => a.mark === 'run').length }) : t('pm.agentsPast')}</span></div>
        {live && !agents.length && <p className="pm-muted">{t('pm.noAgents')}</p>}
        {groups.map(([g, list]) => (list.length ? <section key={g} className="pm-group" data-g={g}>
          <h4>{t(`pm.group.${g}`)}</h4>
          {list.map(a => <AgentCard key={a.chatId} a={a} names={names(a)} on={agentOn === a.chatId} onPick={() => setAgentOn(o => (o === a.chatId ? null : a.chatId))} />)}
        </section> : null))}
        {map.corrections.length > 0 && <section className="pm-group"><h4>{t('pm.corrections')}</h4>{map.corrections.map((c, i) => <p key={i} className="pm-muted">{c}</p>)}</section>}
      </aside>
      </div>
    </div>
    {hist.length > 1 && <footer className="pm-history" data-testid="pm-history">
      <span>{t('pm.history')}</span>
      <input type="range" min={0} max={hist.length - 1} value={Math.max(0, at)} aria-label={t('pm.history')}
        onChange={e => { const i = Number(e.target.value); setVersion(i === hist.length - 1 ? null : hist[i]!.version); }} />
      <span className="pm-hist-at">{t('pm.version', { v: hist[Math.max(0, at)]!.version, n: hist[hist.length - 1]!.version })} · {hist[Math.max(0, at)]!.summary}</span>
    </footer>}
  </div>;
}
