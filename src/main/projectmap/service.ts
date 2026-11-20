// The project maps, live (ADR 0271): the store (projectmap/store.ts) plus what the app adds without tokens.
// - Which agents work on which element: a chat says so (project_map_update working_on), or the app sees it edit a file
//   an element was read from (its evidence) and binds it; a delegated chat in an isolated worktree of the project's
//   checkout counts as working in the project (basesOf). Each bound chat shows on the map with its state, its plan's
//   steps done and in all, its current step and the question it waits on (the same reads as app_agents_recap).
// - When an element's files were last edited by an agent: a status confirmed before that edit reads «da verificare»
//   (shared/project-map.ts shownStatus) until an agent confirms it again.
// It watches the events main sends to the page (chat:item, chat:updated, chat:removed), like run/results.ts, and tells
// the page 'projectmap:changed' (debounced). The bindings and the edit times live in userData/project-map.json.
// - Planning (ADR 0276), all without tokens: a Strategist's plan drawn on a map (planDraw) shows its steps as works on
//   their elements (view), binds the chats delegated for a step to that element and moves the element's status with the
//   steps (syncPlan, on every chat:updated: under way → work, every step done → ok, one blocked → blocked). The
//   Orchestrator changes a drawing piece by piece (edit) and takes its last change back (undo). A change the
//   Orchestrator sends to an agent at work shows on the map until the agent takes it at its next turn (sent).
// - The map follows the chats (issue #456, ADR 0330), without tokens too: a chat linked to a piece on purpose (it said
//   so with working_on, or the Orchestrator linked it: link) moves that piece by itself: under way when the chat starts,
//   done when it reports done, stuck when it reports blocked (saved, one version per real change: follow); stuck on
//   the user while it waits for him, stuck on the agent while its turn stands on an error (shown only, never saved:
//   overlay). A chat the app bound because it edited a piece's file moves nothing (the piece reads «da verificare»,
//   as before). A box with pieces inside holds no status of its own: every save settles it from its pieces, a status
//   meant for it lands on the pieces it can speak for (shared/project-map-status.ts settle, spread), and while a
//   linked chat or a plan's step works on the box itself the view marks it `busy`: it reads under way. A chat's own
//   edits never turn its piece «da verificare» (they are not counted as a change of its files), a chat at work or
//   waiting again after its done report shows so without a new version, a report it gave before it was linked to a
//   piece is not about that piece, and what a piece's chats said is forgotten once none speaks for it.
// Used by wiring-shared.ts attachProjectMaps; pinned by test/unit/projectmap-service.test.ts and projectmap-follow.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { applyChanges, applyEdit, checkMap, checkPaths, elementOfFile, isMapId, isMapLayout, MAP_LAYOUTS, MAP_LIMITS, mergePaths, projectSlug, prunePaths, type MapActor, type MapAgent, type MapElement, type MapPlan, type MapState, type MapWork, type ProjectMap, type ProjectMapInfo, type ProjectMapView } from '@shared/project-map';
import { leavesOf, settle, spread, stateLabel, statusesOf, waitingOf } from '@shared/project-map-status';
import { planWaves, type PlanStep } from '@shared/strategy';
import { askLine } from '../appctl/digest';
import { markOf, progressOf } from '../appctl/agents-recap';
import { errText, log } from '../log';
import { sayOf, wantOf, type ChatSay } from './follow';
import { sizeOf, type PieceSize } from './size';
import type { ProjectMapStore } from './store';

export interface ProjectMapsDeps {
  store: ProjectMapStore;
  chats(): ChatSummary[];
  items(chatId: string): ChatItem[];
  pending(): PendingRequest[];
  /** tells the page a map or its agents changed */
  emit(project: string): void;
  /** puts a project's map on screen (ADR 0276: a plan just proposed on it waits there for the user's ok) */
  show?(project: string): void;
  /** userData/project-map.json */
  stateFile: string;
  now?: () => number;
  debounceMs?: number;
}

/** own = the elements the chat was linked to on purpose (#456): their status follows the chat; since = element → when
 *  it was linked there (a report the chat gave before is not about that piece) */
interface Focus { project: string; elements: string[]; at: number; own?: string[]; since?: Record<string, number> }
/** what the chats linked to one piece say, and when the last of their turns ended */
interface Said { list: ChatSay[]; at: number }
interface Sent { text: string; at: number; seenAt?: number }
/** followed = `project/element` → the last status the app saved there from its linked chats (#456) */
interface State { focus: Record<string, Focus>; changed: Record<string, Record<string, number>>; sent?: Record<string, Sent>; mirrored?: Record<string, MapState>; followed?: Record<string, MapState> }
/** a chat that ended stays on its map this long, as «finito» */
const ENDED_MS = 12 * 3600_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'apply_patch']);
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const isAbs = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p);

/** an isolated worktree the app made for a delegated chat: a sibling folder of the checkout (agents/worktrees.ts) */
const WORKTREE = /^\.second-brain-[a-z]+-/;

/** The folders that stand for a map's root for this chat: the root itself and, for a chat working in an isolated
 *  worktree of that checkout (a sibling .second-brain-* folder) whose parent chats work in the root, that worktree. */
export function basesOf(chat: ChatSummary, root: string, chats: readonly ChatSummary[]): string[] {
  const r = norm(root), parent = r.slice(0, r.lastIndexOf('/')), cwd = norm(chat.cwd);
  if (!cwd.toLowerCase().startsWith(`${parent.toLowerCase()}/`)) return [r];
  const top = cwd.slice(parent.length + 1).split('/')[0] ?? '';
  if (!WORKTREE.test(top)) return [r];
  const inRoot = (c: ChatSummary) => { const d = norm(c.cwd).toLowerCase(); return d === r.toLowerCase() || d.startsWith(`${r.toLowerCase()}/`); };
  for (let c = chat.parentId ? chats.find(x => x.id === chat.parentId) : undefined, n = 0; c && n < 10; n++, c = c.parentId ? chats.find(x => x.id === c!.parentId) : undefined) {
    if (inRoot(c)) return [r, `${parent}/${top}`];
  }
  return [r];
}

/** The pieces of a box that read stuck while a chat linked to the box waits or stands on an error (#456). */
const spreadIds = (map: ProjectMap, id: string): string[] => spread(map.elements, id, 'blocked').map(c => c.id);

/** The pieces a plan drew that nobody started, to take off the map: still planned, and holding nothing that started or
 *  that another plan drew (a remove takes the parts with it). A part whose system goes is not listed again. */
function unstarted(m: ProjectMap, chatId: string): string[] {
  const mine = (e: MapElement) => e.plan === chatId && e.status === 'planned';
  const free = m.elements.filter(e => mine(e) && m.elements.every(k => k.parent !== e.id || mine(k)));
  return free.filter(e => !e.parent || !free.some(f => f.id === e.parent)).map(e => e.id);
}

export class ProjectMaps {
  private state: State = { focus: {}, changed: {} };
  private timers = new Map<string, NodeJS.Timeout>();
  /** chat → the proposal (its plan's `at`) already put on screen */
  private shown = new Map<string, number>();
  private saveTimer: NodeJS.Timeout | null = null;
  /** «Quanto è grande» per piece, counted a minute ago at most (ADR 0316) */
  private sizes = new Map<string, { at: number; size: Promise<PieceSize> }>();

  constructor(private readonly d: ProjectMapsDeps) {
    try {
      const s = JSON.parse(fs.readFileSync(d.stateFile, 'utf8')) as Partial<State>;
      this.state = { focus: s.focus && typeof s.focus === 'object' ? s.focus : {}, changed: s.changed && typeof s.changed === 'object' ? s.changed : {}, sent: s.sent && typeof s.sent === 'object' ? s.sent : {}, mirrored: s.mirrored && typeof s.mirrored === 'object' ? s.mirrored : {}, followed: s.followed && typeof s.followed === 'object' ? s.followed : {} };
    } catch { /* first start: nothing bound yet */ }
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  /** The maps, each with how many things wait for the user right now: the same count as the map's header. */
  list(): ProjectMapInfo[] {
    const now = this.now();
    return this.d.store.list(m => { const live = this.overlay(m, now); return waitingOf(live, statusesOf(live, now, this.state.changed[m.project] ?? {})); });
  }
  /** the maps' project folders (where a file named in a message may be, file-roots.ts) */
  roots(): string[] {
    const now = this.now();
    if (!this.rootsAt || now - this.rootsAt.at > 30_000) this.rootsAt = { at: now, roots: this.d.store.list().flatMap(m => this.d.store.get(m.project)?.root ?? []) };
    return this.rootsAt.roots;
  }
  private rootsAt: { at: number; roots: string[] } | null = null;

  /** The project a name means: its folder name, its title, or a slug of it. */
  resolve(name: string): string | null {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    const all = this.d.store.list();
    return all.find(m => m.project === n)?.project ?? all.find(m => m.title.toLowerCase() === n)?.project ?? all.find(m => m.project === projectSlug(name))?.project ?? null;
  }

  view(project: string, version?: number): ProjectMapView | null {
    const map = version === undefined ? this.d.store.get(project) : this.d.store.version(project, version);
    if (!map) return null;
    const { works, plans } = version === undefined ? this.works(project) : { works: {}, plans: [] };
    // a step under way vouches for its element now: the app sees it, so the status never reads «da verificare» meanwhile
    const now = this.now();
    const live = map.elements.some(e => works[e.id]?.some(w => w.state === 'now')) ? { ...map, elements: map.elements.map(e => (works[e.id]?.some(w => w.state === 'now') ? { ...e, confirmedAt: now } : e)) } : map;
    return { map: version === undefined ? this.overlay(live, now, new Set(Object.keys(works).filter(id => works[id]!.some(w => w.state === 'now')))) : live, history: this.d.store.history(project), agents: this.agents(project), changed: this.state.changed[project] ?? {}, works, plans };
  }

  /** What the chats linked on purpose to a map's pieces say now (#456): linked element → one say per chat. A chat
   *  that ended long ago, or that says nothing, is not counted. */
  private says(map: ProjectMap): Map<string, Said> {
    const out = new Map<string, Said>(), now = this.now();
    const linked = Object.entries(this.state.focus).filter(([, f]) => f.project === map.project && f.own?.length);
    if (!linked.length) return out;
    const all = this.d.chats(), asks = this.d.pending(), ids = new Set(map.elements.map(e => e.id));
    for (const [chatId, f] of linked) {
      const c = all.find(x => x.id === chatId);
      if (!c || ((c.closedAt || c.state === 'closed') && now - (c.closedAt ?? c.updatedAt) > ENDED_MS)) continue;
      for (const id of f.own!) {
        const say = ids.has(id) ? sayOf(c, all, asks, f.since?.[id] ?? 0) : null;
        if (!say) continue;
        const was = out.get(id);
        out.set(id, { list: [...(was?.list ?? []), say], at: Math.max(was?.at ?? 0, c.lastResult?.at ?? 0) });
      }
    }
    return out;
  }

  /** The map as it shows right now (#456): a piece whose linked chat waits for the user reads stuck on him, one whose
   *  chats all stand on an error stuck on the agent, a piece a chat works on is vouched for, a done piece whose chat
   *  is at work again reads under way, and a box with pieces inside that a chat or a plan's step (`stepsNow`) works on
   *  is `busy` (`waits` when its chat waits and no piece inside can say so). Shown only: nothing of this is saved, it
   *  ends when the chat moves on. */
  private overlay(map: ProjectMap, now: number, stepsNow: ReadonlySet<string> = new Set()): ProjectMap {
    const says = this.says(map);
    const stuck = new Map<string, MapActor>(), waits = new Map<string, MapActor>(), vouched = new Map<string, number>(), busy = new Set<string>(), redo = new Set<string>();
    const isBox = (id: string) => map.elements.some(e => e.parent === id);
    const mark = (m: Map<string, MapActor>, id: string, actor: MapActor) => { if (m.get(id) !== 'user') m.set(id, actor); };
    for (const id of stepsNow) if (isBox(id)) busy.add(id);
    for (const [id, said] of says) {
      const w = wantOf(said.list), box = isBox(id);
      if (w.live) {
        // a box: the pieces inside that can say so for it, else the box itself (a system whose parts are all done)
        const on = box ? spreadIds(map, id) : [id];
        if (on.length) for (const x of on) mark(stuck, x, w.live.actor); else mark(waits, id, w.live.actor);
      }
      if (box && (w.durable === 'work' || w.redo)) busy.add(id);
      if (!box && w.redo) redo.add(id);
      // the app sees its chats: at work now = confirmed now, between two turns = confirmed when the last turn ended
      // (the 2 hours count from there, not from the start of a long turn)
      if (w.durable === 'work' || w.redo) for (const e of leavesOf(map.elements, id)) if (!box || e.status === 'work') vouched.set(e.id, Math.max(vouched.get(e.id) ?? 0, w.running ? now : said.at));
    }
    if (!stuck.size && !waits.size && !vouched.size && !busy.size && !redo.size) return map;
    return { ...map, elements: map.elements.map(e => {
      const actor = stuck.get(e.id);
      if (actor) return { ...e, status: 'blocked' as const, actor, confirmedAt: now };
      let x = e;
      if (redo.has(e.id) && e.status === 'ok') x = { ...x, status: 'work' as const, confirmedAt: now };
      const at = vouched.get(e.id);
      if (at !== undefined && at > x.confirmedAt) x = { ...x, confirmedAt: at };
      const waitsOn = waits.get(e.id);
      if (waitsOn) x = { ...x, waits: waitsOn };
      else if (busy.has(e.id)) x = { ...x, busy: true as const };
      return x;
    }) };
  }

  /** The chats linked to a map's pieces moved (#456): each piece takes the status they say together, saved as one
   *  version when something really changes. Only when what the chats say moved since the last time: a status an agent
   *  or the Orchestrator set after it stays. A piece a plan's steps work on is the plan's (syncPlan). */
  private follow(project: string): void {
    const map = this.d.store.get(project);
    if (!map) return;
    const says = this.says(map), memo = (this.state.followed ??= {});
    // a piece no chat speaks for any more (stopped, unlinked, removed): what they said is forgotten, the next chat
    // linked to it starts afresh
    let forgot = false;
    for (const k of Object.keys(memo)) if (k.startsWith(`${project}/`) && !says.has(k.slice(project.length + 1))) { delete memo[k]; forgot = true; }
    if (!says.size) { if (forgot) this.persist(); return; }
    const planned = this.works(project).works;
    // the pieces a chat is linked to directly are its own: a chat linked to the box around them leaves them alone
    const direct = new Set([...says.keys()].filter(id => { const l = leavesOf(map.elements, id); return l.length === 1 && l[0]!.id === id; }));
    const changes = new Map<string, MapState>(), told = new Map<string, MapState>();
    for (const [id, said] of says) {
      const want = wantOf(said.list).durable, key = `${project}/${id}`;
      if (!want || memo[key] === want || planned[id]?.length) continue;
      told.set(key, want);
      for (const c of spread(map.elements, id, want, direct.has(id) ? undefined : direct)) changes.set(c.id, c.status);
    }
    if (!told.size) { if (forgot) this.persist(); return; }
    if (changes.size) {
      const el = (id: string) => map.elements.find(e => e.id === id);
      try { this.update(project, { changes: [...changes].map(([id, status]) => ({ id, status })), by: 'app', summary: [...changes].map(([id, st]) => `${el(id)?.name ?? id}: ${stateLabel(st, el(id)?.kind)}`).join(' · ') }); }
      // nothing is remembered: the next change of a linked chat tries again
      catch (err) { log.warn('projectmap', 'chats not mirrored on their map', { cause: errText(err), hint: 'the map keeps its last statuses; the next change of a linked chat retries' }); return; }
    }
    for (const [key, want] of told) memo[key] = want;
    this.persist();
    this.changed(project);
  }

  /** The Orchestrator links a chat to the pieces it works on (#456: app_create_chat / app_assign_task `map`,
   *  app_project_map link): the chat shows on them and their status follows it from now on. No elements = unlinked. */
  link(project: string, chatId: string, elements: unknown): { project: string; elements: string[] } {
    const map = this.d.store.get(project);
    if (!map) throw new Error(`nessuna mappa «${project}»`);
    const ids = this.linkable(project, elements);
    if (!this.d.chats().some(c => c.id === chatId)) throw new Error(`link: no chat «${chatId.slice(0, 80)}» (app_chats lists them)`);
    if (!ids.length) { const f = this.state.focus[chatId]; if (f?.project === project) delete this.state.focus[chatId]; }
    else this.own(project, chatId, ids, this.now());
    this.persist();
    this.follow(project);
    this.changed(project);
    return { project, elements: ids };
  }
  /** A chat is linked on purpose to these pieces. A piece it was not on before speaks afresh: what the chats said
   *  there does not hold it back, and what this chat reported before is not about it. A piece it was already on keeps
   *  what was said (a status set by hand stands through a repeated link). */
  private own(project: string, chatId: string, ids: string[], now: number): void {
    const was = this.state.focus[chatId], before = was?.project === project ? was : undefined;
    const since: Record<string, number> = {};
    for (const id of ids) {
      if (before?.own?.includes(id)) { since[id] = before.since?.[id] ?? 0; continue; }
      since[id] = now;
      delete this.state.followed?.[`${project}/${id}`];
    }
    this.state.focus[chatId] = { project, elements: ids, at: now, ...(ids.length ? { own: ids, since } : {}) };
  }
  /** Whether a chat, or one that delegated it, is linked on purpose to a piece or to a box around it: it speaks for it. */
  private speaksFor(map: ProjectMap, chat: ChatSummary, all: readonly ChatSummary[], el: string): boolean {
    const up = new Set<string>();
    for (let e = map.elements.find(x => x.id === el), n = 0; e && n < 50 && !up.has(e.id); n++) { up.add(e.id); e = e.parent ? map.elements.find(x => x.id === e!.parent) : undefined; }
    for (let c: ChatSummary | undefined = chat, n = 0; c && n < 10; n++, c = c.parentId ? all.find(x => x.id === c!.parentId) : undefined) {
      const f = this.state.focus[c.id];
      if (f?.project === map.project && f.own?.some(id => up.has(id))) return true;
    }
    return false;
  }
  /** A chat shown on pieces without moving them (the demo's chats): bound as one that edited their files is. */
  bind(project: string, chatId: string, elements: string[]): void {
    const ids = this.linkable(project, elements);
    if (ids.length) this.state.focus[chatId] = { project, elements: ids, at: this.now() };
    this.persist();
    this.changed(project);
  }
  /** The element ids of a link, checked against the map (before a chat is started for them). */
  linkable(project: string, elements: unknown): string[] {
    const map = this.d.store.get(project);
    if (!map) throw new Error(`nessuna mappa «${project}»`);
    if (!Array.isArray(elements) || elements.length > 20 || !elements.every(isMapId)) throw new Error('elements: up to 20 element ids of the map');
    const unknown = (elements as string[]).filter(id => !map.elements.some(e => e.id === id));
    if (unknown.length) throw new Error(`elements: no element ${unknown.join(', ')} in «${map.project}» (read the map for its ids)`);
    return [...new Set(elements as string[])];
  }
  /** The map whose project folder holds a folder (the deepest one when two nest), for whoever starts work there. */
  mapOfFolder(cwd: string): ProjectMap | null {
    const d = norm(cwd).toLowerCase();
    let hit: ProjectMap | null = null;
    for (const info of this.d.store.list()) {
      const m = this.d.store.get(info.project), r = m?.root ? norm(m.root).toLowerCase() : '';
      if (m && r && (d === r || d.startsWith(`${r}/`)) && (!hit || r.length > norm(hit.root!).length)) hit = m;
    }
    return hit;
  }

  /** The plans drawn on a project's map and their steps, per element: read from the chats, never saved (ADR 0276). */
  private works(project: string): { works: Record<string, MapWork[]>; plans: MapPlan[] } {
    const works: Record<string, MapWork[]> = {}, plans: MapPlan[] = [], now = this.now();
    for (const c of this.d.chats()) {
      const p = c.plan;
      if (!p || p.map !== project || p.phase === 'asking') continue;
      if ((c.closedAt || c.state === 'closed') && (p.phase !== 'done' && p.phase !== 'running' || now - (c.closedAt ?? c.updatedAt) > ENDED_MS)) continue;
      // which steps go together (ADR 0302): the ones that share a turn, and the ones under way at the same moment
      const waves = planWaves(p.steps), running = p.steps.filter(x => x.state === 'now').length;
      const par = (x: PlanStep, i: number) => waves.filter(w => w === waves[i]).length > 1 || (x.state === 'now' && running > 1);
      plans.push({ chatId: c.id, title: c.title, phase: p.phase, at: p.at, steps: p.steps.length, done: p.steps.filter(x => x.state === 'done').length, ...(p.doneWhen ? { doneWhen: p.doneWhen } : {}),
        flow: p.steps.map((x, i) => ({ step: i + 1, title: x.title, state: x.state, wave: waves[i]!, ...(par(x, i) ? { par: true } : {}), ...(x.on ? { on: x.on } : {}), ...(x.role ? { role: x.role } : {}),
          ...(x.detail ? { detail: x.detail } : {}), ...(x.chatIds?.length ? { chatIds: [...x.chatIds] } : {}), ...(x.startedAt ? { startedAt: x.startedAt } : {}), ...(x.endedAt ? { endedAt: x.endedAt } : {}), ...(x.added ? { added: true } : {}) })) });
      p.steps.forEach((x, i) => { if (x.on) (works[x.on] ??= []).push({ title: x.title, state: x.state, ...(x.role ? { role: x.role } : {}), chatId: c.id, step: i + 1, chatIds: x.chatIds ?? [], ...(x.added ? { added: true } : {}), wave: waves[i]!, ...(par(x, i) ? { par: true } : {}) }); });
    }
    return { works, plans: plans.sort((a, b) => b.at - a.at) };
  }

  /** Every save passes here (#456): a box that holds pieces is saved with what they say together. */
  private put(map: ProjectMap): ProjectMap { map.elements = settle(map.elements.map(e => (e.busy || e.waits ? (({ busy: _b, waits: _w, ...rest }) => rest)(e) : e))); return this.d.store.save(map); }

  elementsOf(project: string): string[] { return this.d.store.get(project)?.elements.map(e => e.id) ?? []; }

  /** A piece-by-piece change (ADR 0276): the Orchestrator's, from what the user said, or a plan's. One version. */
  edit(project: string, ops: unknown, by: string, plan?: string): { map: ProjectMap; did: string[]; added: string[] } {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»`);
    const now = this.now();
    const { elements, links, did, added } = applyEdit(prev, ops, now, plan);
    const paths = prunePaths(prev.paths, new Set(elements.map(e => e.id)));
    const map: ProjectMap = { ...prev, elements, links, paths: paths.length ? paths : undefined, version: prev.version + 1, updatedAt: now, by, summary: did.join(' · ').slice(0, MAP_LIMITS.summary) };
    this.put(map);
    this.prune(project, new Set(elements.map(e => e.id)));
    this.persist();
    this.changed(project);
    return { map, did, added };
  }

  /** «Annulla»: the drawing of the version before the current one comes back, as a new version (the history keeps both). */
  undo(project: string, by: string): ProjectMap {
    const cur = this.d.store.get(project);
    if (!cur) throw new Error(`nessuna mappa «${project}»`);
    // the last change somebody made: the versions the app wrote since (statuses mirrored from a plan) are not it
    let v = cur.version, last: ProjectMap | null = cur;
    while (last && last.by === 'app' && v > 1) last = this.d.store.version(project, --v);
    const before = last && v > 1 ? this.d.store.version(project, v - 1) : null;
    if (!before) throw new Error('niente da annullare: la mappa ha una sola versione');
    // the pieces come back as they were drawn; the ones still there keep the status they have now
    const live = new Map(cur.elements.map(e => [e.id, e]));
    const elements = v === cur.version ? before.elements : before.elements.map(e => { const n = live.get(e.id); return n ? { ...e, status: n.status, confirmedAt: n.confirmedAt, ...(n.note ? { note: n.note } : {}) } : e; });
    const { layout: _now, ...rest } = cur;
    const map: ProjectMap = { ...rest, ...(before.layout ? { layout: before.layout } : {}), elements, links: before.links, corrections: before.corrections, paths: before.paths, version: cur.version + 1, updatedAt: this.now(), by, summary: `annullato: ${last!.summary}`.slice(0, MAP_LIMITS.summary) };
    this.put(map);
    this.prune(project, new Set(elements.map(e => e.id)));
    this.persist();
    this.changed(project);
    return map;
  }

  /** An element that left the drawing leaves the chats' bindings and what the app remembers of it. */
  private prune(project: string, ids: ReadonlySet<string>): void {
    for (const f of Object.values(this.state.focus)) if (f.project === project) { f.elements = f.elements.filter(id => ids.has(id)); if (f.own) f.own = f.own.filter(id => ids.has(id)); }
    for (const k of Object.keys(this.state.followed ?? {})) if (k.startsWith(`${project}/`) && !ids.has(k.slice(project.length + 1))) delete this.state.followed![k];
  }

  /** plan_propose / plan_update add with a map (agents/strategy-tools.ts): the plan's new pieces go on the project's map,
   *  dashed; the unstarted pieces of this chat's earlier proposal leave first (keep = false). A project with no map
   *  gets one made of these pieces only: nobody waits for a Scout to read the whole project. */
  planDraw(chatId: string, a: { project?: unknown; title?: unknown; add?: unknown; links?: unknown; keep?: unknown }): { project: string; elements: string[]; added: string[] } {
    const chat = this.d.chats().find(c => c.id === chatId);
    const by = chat?.title || 'Strategist';
    const name = typeof a.project === 'string' && a.project.trim() ? a.project.trim() : typeof a.title === 'string' ? a.title.trim() : '';
    if (!name) throw new Error('map: project (an existing map) or title (a new one).');
    const add = a.add === undefined ? [] : a.add, links = a.links === undefined ? [] : a.links;
    if (!Array.isArray(add) || add.length > 20 || !Array.isArray(links) || links.length > 20) throw new Error('map: add and links are lists of up to 20.');
    let project = this.resolve(name);
    if (!project) {
      if (!add.length) throw new Error(`map: no map «${name.slice(0, 80)}» yet (maps: ${this.d.store.list().map(m => m.project).join(', ') || 'none'}). Give title and, in add, the pieces this work touches.`);
      const first = this.save({ title: name, ...(chat?.cwd ? { defaultRoot: chat.cwd } : {}), by, summary: 'mappa nata da un piano',
        map: { elements: add.map(x => ({ ...(x as object), status: 'planned', evidence: [], id: (x as { id?: unknown }).id ?? projectSlug(String((x as { name?: unknown }).name ?? '')) })), links } });
      project = first.project;
      const mine = first.elements.map(e => ({ ...e, plan: chatId, addedAt: first.updatedAt }));
      this.put({ ...first, elements: mine });
      return { project, elements: mine.map(e => e.id), added: mine.map(e => e.id) };
    }
    const prev = this.d.store.get(project)!;
    const ops: unknown[] = a.keep === true ? [] : unstarted(prev, chatId).map(id => ({ op: 'remove', id }));
    for (const x of add) ops.push({ ...(x && typeof x === 'object' ? x : {}), op: 'add' });
    for (const l of links) ops.push({ ...(l && typeof l === 'object' ? l : {}), op: 'link' });
    if (!ops.length) return { project, elements: prev.elements.map(e => e.id), added: [] };
    const r = this.edit(project, ops, by, chatId);
    return { project, elements: r.map.elements.map(e => e.id), added: r.added };
  }

  /** The unstarted pieces of a plan that will never run (its chat was removed, or closed before the user's ok) leave the maps. */
  private dropPlan(chatId: string): void {
    for (const info of this.d.store.list()) {
      const m = this.d.store.get(info.project);
      const tops = m ? unstarted(m, chatId) : [];
      if (!tops.length) continue;
      try { this.edit(info.project, tops.map(id => ({ op: 'remove', id })), 'app'); } catch (err) { log.warn('projectmap', 'planned pieces not removed', { cause: errText(err), hint: 'they stay dashed on the map; ask the Orchestrator to remove them' }); }
    }
  }

  /** A plan drawn on a map moved (chat:updated): its delegated chats show on their step's element, and the element's
   *  status follows its steps. Zero tokens: the app already holds all of it. A version only when a status really changes. */
  private syncPlan(c: ChatSummary): void {
    const p = c.plan;
    if (!p?.map) return;
    if ((c.closedAt || c.state === 'closed') && (p.phase === 'proposed' || p.phase === 'revising')) { this.dropPlan(c.id); return; }
    const map = this.d.store.get(p.map);
    if (!map) return;
    // the owner: «quando lo stratega ha finito con le domande si apra la mappa del piano e l'utente può premere approva»
    if (p.phase === 'proposed' && this.shown.get(c.id) !== p.at) { this.shown.set(c.id, p.at); this.d.show?.(p.map); }
    const now = this.now(), ids = new Set(map.elements.map(e => e.id));
    let bound = false;
    const bind = (chatId: string, el: string) => {
      const f = this.state.focus[chatId];
      // a chat linked on purpose to another map stays there (#456)
      if (!f || (f.project !== p.map && !f.own?.length)) { this.state.focus[chatId] = { project: p.map!, elements: [el], at: now }; bound = true; }
      else if (f.project === p.map && !f.elements.includes(el)) { f.elements.push(el); bound = true; }
    };
    const by = new Map<string, string[]>();
    for (const s of p.steps) {
      if (!s.on || !ids.has(s.on)) continue;
      by.set(s.on, [...(by.get(s.on) ?? []), s.state]);
      for (const id of s.chatIds ?? []) bind(id, s.on);
      // a step the Strategist does itself
      if (s.state === 'now' && !s.chatIds?.length) bind(c.id, s.on);
    }
    if (bound) this.persist();
    const changes: { id: string; status: MapState }[] = [], told = new Map<string, MapState>(), memo = (this.state.mirrored ??= {});
    if (p.phase === 'running' || p.phase === 'done') for (const [id, states] of by) {
      const want = states.includes('blocked') ? 'blocked' : states.every(x => x === 'done') ? 'ok' : states.some(x => x !== 'todo') ? 'work' : null;
      // only when the steps moved since the last mirror: a status an agent or the Orchestrator set after it stays
      const key = `${c.id}:${id}`;
      if (!want || memo[key] === want) continue;
      told.set(key, want);
      // a step on a box with pieces inside moves its open pieces: the box says what they say together (#456)
      for (const x of spread(map.elements, id, want)) if (!changes.some(y => y.id === x.id)) changes.push(x);
    }
    // remembered only once saved: a save that failed is tried again at the next plan change
    const remember = () => { for (const [key, want] of told) memo[key] = want; if (told.size) this.persist(); };
    if (changes.length) {
      const el = (id: string) => map.elements.find(e => e.id === id);
      try { this.update(p.map, { changes, by: 'app', summary: changes.map(x => `${el(x.id)?.name ?? x.id}: ${stateLabel(x.status, el(x.id)?.kind)}`).join(' · ') }); remember(); }
      catch (err) { log.warn('projectmap', 'plan not mirrored on its map', { cause: errText(err), hint: 'the map keeps its last statuses; the next plan change retries' }); }
    } else { remember(); this.changed(p.map); }
  }

  /** The Orchestrator sent a change to an agent at work (app_send_to_chat): the map shows it on that agent until the
   *  agent takes it. busy = it is mid-turn (it reads the message at its next turn); otherwise it has it now. */
  sent(chatId: string, text: string, busy: boolean): void {
    const f = this.state.focus[chatId];
    if (!f) return;
    const at = this.now();
    (this.state.sent ??= {})[chatId] = { text: text.replace(/\s+/g, ' ').trim().slice(0, 120), at, ...(busy ? {} : { seenAt: at }) };
    this.persist();
    this.changed(f.project);
  }

  /** A whole drawing (project_map_save): a new map, or the next version of an existing one. */
  /** root: the project's folder, given on purpose; defaultRoot: the caller's folder, used only for a new map (a redraw
   *  from a worktree or a subfolder must not move the map's root there). */
  save(a: { project?: string; title?: string; root?: string; defaultRoot?: string; map: unknown; by: string; summary: string; corrections?: string[] }): ProjectMap {
    const title = (a.title ?? '').trim().slice(0, MAP_LIMITS.title);
    const project = a.project ? (this.resolve(a.project) ?? projectSlug(a.project)) : title ? (this.resolve(title) ?? projectSlug(title)) : '';
    if (!project) throw new Error('project or title: required');
    const prev = this.d.store.get(project);
    const root = a.root?.trim() || prev?.root || a.defaultRoot?.trim() || undefined;
    if (root && (!isAbs(norm(root)) || norm(root).startsWith('//'))) throw new Error(`root: the project's folder as an absolute path, a local folder, not «${root.slice(0, 80)}»`);
    const now = this.now();
    const { elements, links } = checkMap(a.map, now, prev);
    // the walks (ADR 0316): the ones sent, or the previous ones still on the drawing
    const ids = new Set(elements.map(e => e.id));
    const sent = a.map && typeof a.map === 'object' ? (a.map as { paths?: unknown }).paths : undefined;
    const paths = sent === undefined ? prunePaths(prev?.paths, ids) : checkPaths(sent, ids);
    // how the top level is drawn (#443): the one sent, else the previous one
    const asked = a.map && typeof a.map === 'object' ? (a.map as { layout?: unknown }).layout : undefined;
    if (asked !== undefined && asked !== null && !isMapLayout(asked)) throw new Error(`layout: ${MAP_LAYOUTS.join(' | ')}`);
    const layout = asked === undefined ? prev?.layout : asked ?? undefined;
    const summary = a.summary.trim().slice(0, MAP_LIMITS.summary) || (prev ? 'mappa ridisegnata' : 'prima mappa');
    const map: ProjectMap = {
      project, title: title || prev?.title || project, ...(root ? { root } : {}),
      version: (prev?.version ?? 0) + 1, updatedAt: now, by: a.by, summary, elements, links,
      corrections: a.corrections ?? prev?.corrections ?? [], ...(paths.length ? { paths } : {}), ...(layout ? { layout } : {}),
    };
    this.put(map);
    // an element that left the drawing leaves the bindings and the edit times too
    const changed = this.state.changed[project];
    if (changed) for (const id of Object.keys(changed)) if (!ids.has(id) || (elements.find(e => e.id === id)!.confirmedAt >= changed[id]!)) delete changed[id];
    this.prune(project, ids);
    this.persist();
    log.info('projectmap', 'project map saved', { data: { project, version: map.version, elements: elements.length, links: links.length, by: a.by } });
    this.changed(project);
    return map;
  }

  /** A status update (project_map_update): each change is confirmed now; `working_on` binds the calling chat. */
  update(project: string, a: { changes?: unknown; workingOn?: unknown; paths?: unknown; dropPaths?: unknown; chatId?: string; by: string; summary?: string }): { map: ProjectMap | null; touched: string[] } {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»: disegnala prima con project_map_save`);
    const now = this.now();
    // the changes first: a wrong one refuses the whole call, binding included
    const next = a.changes === undefined ? null : applyChanges(prev, a.changes, now);
    // walks told or taken away (ADR 0316): no redraw, a version of their own
    const walks = a.paths === undefined && a.dropPaths === undefined ? null : mergePaths(prev.paths, a.paths, a.dropPaths, new Set(prev.elements.map(e => e.id)));
    if (a.workingOn !== undefined) {
      if (!a.chatId) throw new Error('working_on: only a chat can say what it works on');
      if (!Array.isArray(a.workingOn) || a.workingOn.length > 20 || !a.workingOn.every(isMapId)) throw new Error('working_on: up to 20 element ids');
      const unknown = (a.workingOn as string[]).filter(id => !prev.elements.some(e => e.id === id));
      if (unknown.length) throw new Error(`working_on: no element ${unknown.join(', ')} (project_map_read lists them)`);
      // it said so itself: the status of these pieces follows it from now on (#456)
      this.own(project, a.chatId, [...new Set(a.workingOn as string[])], now);
      this.persist();
    }
    if (!next && !walks) { if (a.workingOn !== undefined) this.follow(project); this.changed(project); return { map: null, touched: [] }; }
    const { elements, links, touched } = next ?? { elements: prev.elements, links: prev.links, touched: [] as string[] };
    const map: ProjectMap = { ...prev, elements, links, ...(walks ? { paths: walks.paths.length ? walks.paths : undefined } : {}), version: prev.version + 1, updatedAt: now, by: a.by,
      summary: (a.summary ?? '').trim().slice(0, MAP_LIMITS.summary) || [...(touched.length ? [`stato di ${touched.join(', ')}`] : []), ...(walks?.did ?? [])].join(' · ').slice(0, MAP_LIMITS.summary) };
    this.put(map);
    const changed = this.state.changed[project];
    if (changed) for (const id of touched) delete changed[id];
    if (a.by !== 'app' && touched.length) {
      // a status somebody set by hand stands (#456): the app moves that piece again only when its linked chats say something new
      const says = this.says(map), memo = (this.state.followed ??= {});
      for (const id of touched) { const w = wantOf(says.get(id)?.list ?? []).durable; if (w) memo[`${project}/${id}`] = w; }
    }
    this.persist();
    this.changed(project);
    // the pieces it only named follow it
    if (a.workingOn !== undefined) this.follow(project);
    return { map, touched };
  }

  /** «Quanto è grande» (ADR 0316): the files and lines under a piece's evidence, inside the map's root; null without
   *  a root on this PC or files to count. Counted again a minute later at most. */
  async size(project: string, element: string): Promise<PieceSize | null> {
    const map = this.d.store.get(project), e = map?.elements.find(x => x.id === element);
    if (!map?.root || !e?.evidence.length || !isAbs(norm(map.root))) return null;
    const key = `${project}\n${map.root}\n${e.evidence.join('\n')}`, now = this.now(), hit = this.sizes.get(key);
    const size = hit && now - hit.at < 60_000 ? hit.size : sizeOf(map.root, e.evidence);
    if (size !== hit?.size) { this.sizes.set(key, { at: now, size }); if (this.sizes.size > 200) this.sizes.delete(this.sizes.keys().next().value!); }
    const got = await size;
    return got.files ? got : null;
  }

  /** A correction of the user's (the Orchestrator writes it): kept for every later drawing. */
  correct(project: string, text: string): ProjectMap {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»`);
    const t = text.replace(/\s+/g, ' ').trim().slice(0, MAP_LIMITS.correction);
    if (!t) throw new Error('text: the correction, in the user\'s words');
    const map: ProjectMap = { ...prev, corrections: [...prev.corrections, t].slice(-MAP_LIMITS.corrections), version: prev.version + 1, updatedAt: this.now(), by: 'utente', summary: `correzione: ${t}`.slice(0, MAP_LIMITS.summary) };
    this.put(map);
    this.changed(project);
    return map;
  }

  /** The chats bound to a project's elements, as the map shows them. */
  agents(project: string): MapAgent[] {
    const now = this.now();
    const chats = new Map(this.d.chats().map(c => [c.id, c]));
    const asks = this.d.pending();
    const out: MapAgent[] = [];
    for (const [chatId, f] of Object.entries(this.state.focus)) {
      if (f.project !== project || !f.elements.length) continue;
      const c = chats.get(chatId);
      if (!c) continue;
      const ended = !!c.closedAt || c.state === 'closed';
      if (ended && now - (c.closedAt ?? c.updatedAt) > ENDED_MS) continue;
      const rs = asks.filter(r => r.chatId === chatId);
      const m = markOf(c, rs);
      const mark = ended ? 'done' : m === 'stopped' ? 'idle' : m;
      const p = c.parentId ? null : progressOf(this.d.items(chatId));
      out.push({
        chatId, title: c.title, ...(c.agent?.name ? { role: c.agent.name } : {}), mark,
        done: p?.done ?? 0, total: p?.total ?? 0, ...(p?.now && !ended ? { now: p.now } : {}),
        // a delegated chat's question is its parent's (ADR 0083): only that it waits
        ...(mark === 'wait' && rs[0] && !c.parentId ? { ask: askLine(rs[0]) } : {}),
        since: f.at, elements: f.elements,
        ...(this.state.sent?.[chatId] && now - this.state.sent[chatId]!.at < ENDED_MS ? { change: this.state.sent[chatId]! } : {}),
      });
    }
    const order = ['wait', 'error', 'run', 'queue', 'idle', 'done'];
    return out.sort((a, b) => order.indexOf(a.mark) - order.indexOf(b.mark) || (b.since ?? 0) - (a.since ?? 0));
  }

  /** Every event main sends to the page passes here (wiring-shared.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    try {
      if (channel === 'chat:item') this.item(payload as { chatId: string; item: ChatItem });
      else if (channel === 'chat:updated') {
        const c = payload as ChatSummary;
        this.syncPlan(c);
        const f = this.state.focus[c.id];
        if (f) this.changed(f.project);
        // the maps follow their linked chats (#456): this one, and the ones that delegated it (its state is theirs)
        const all = this.d.chats(), seen = new Set<string>();
        for (let x: ChatSummary | undefined = c, n = 0; x && n < 10; n++, x = x.parentId ? all.find(y => y.id === x!.parentId) : undefined) {
          const g = this.state.focus[x.id];
          if (g?.own?.length && !seen.has(g.project)) { seen.add(g.project); this.follow(g.project); if (x !== c) this.changed(g.project); }
        }
      }
      else if (channel === 'chat:removed') {
        const id = (payload as { chatId: string }).chatId, f = this.state.focus[id];
        this.dropPlan(id);
        if (this.state.sent?.[id]) delete this.state.sent[id];
        for (const k of Object.keys(this.state.mirrored ?? {})) if (k.startsWith(`${id}:`)) delete this.state.mirrored![k];
        // the pieces it was linked to say what the chats left on them say (#456)
        if (f) { delete this.state.focus[id]; this.persist(); if (f.own?.length) this.follow(f.project); this.changed(f.project); }
      }
    } catch (err) { log.warn('projectmap', 'project map event not read', { cause: errText(err), hint: 'the map keeps its last state; the next event retries' }); }
  }

  private item({ chatId, item }: { chatId: string; item: ChatItem }): void {
    // a turn ended: the change that waited behind it is the agent's now
    const sent = this.state.sent?.[chatId];
    if (item.kind === 'result' && sent && !sent.seenAt && item.at >= sent.at) { sent.seenAt = item.at; this.persist(); const f = this.state.focus[chatId]; if (f) this.changed(f.project); }
    if (item.kind !== 'tool' || item.status !== 'ok') return;
    const files = [...(item.diff?.map(x => x.path) ?? [])];
    if (!files.length && EDIT_TOOLS.has(item.name)) {
      const i = (item.input ?? {}) as Record<string, unknown>;
      for (const k of ['file_path', 'path', 'notebook_path']) if (typeof i[k] === 'string') files.push(i[k] as string);
    }
    if (!files.length) return;
    const chat = this.d.chats().find(c => c.id === chatId);
    if (!chat || chat.isOrchestrator) return;
    const maps = this.d.store.list().map(m => this.d.store.get(m.project)).filter((m): m is ProjectMap => !!m?.root);
    const chats = this.d.chats();
    for (const file of files) {
      const abs = norm(isAbs(norm(file)) ? file : path.join(chat.cwd, file));
      // the map whose folder holds the file (the deepest one when two nest), through the chat's worktree if it has one
      let hit: { m: ProjectMap; base: string } | null = null;
      for (const m of maps) for (const base of basesOf(chat, m.root!, chats)) {
        if (abs.toLowerCase().startsWith(`${base.toLowerCase()}/`) && (!hit || base.length > hit.base.length)) hit = { m, base };
      }
      if (!hit) continue;
      const { m, base } = hit;
      const el = elementOfFile(m.elements, abs.slice(base.length + 1));
      if (!el) continue;
      // an edit by the chat that speaks for the piece (linked to it or to a box around it, or delegated by one that is)
      // is its own work: only somebody else's edit turns the piece «da verificare» (#456)
      if (!this.speaksFor(m, chat, chats, el)) (this.state.changed[m.project] ??= {})[el] = item.at;
      const f = this.state.focus[chatId];
      // a chat linked on purpose to another map stays there: the edit only dates this map's piece (#456)
      if (!f || (f.project !== m.project && !f.own?.length)) this.state.focus[chatId] = { project: m.project, elements: [el], at: item.at };
      else if (f.project === m.project && !f.elements.includes(el)) f.elements.push(el);
      this.persist();
      this.changed(m.project);
    }
  }

  private changed(project: string): void {
    this.rootsAt = null;
    if (this.timers.has(project)) return;
    const t = setTimeout(() => { this.timers.delete(project); this.d.emit(project); }, this.d.debounceMs ?? 400);
    t.unref?.();
    this.timers.set(project, t);
  }

  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 500);
    this.saveTimer.unref?.();
  }

  flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.d.stateFile), { recursive: true });
      fs.writeFileSync(`${this.d.stateFile}.tmp`, JSON.stringify(this.state));
      fs.renameSync(`${this.d.stateFile}.tmp`, this.d.stateFile);
    } catch (err) { log.warn('projectmap', 'project map bindings not saved', { cause: errText(err), hint: 'the bindings live in memory until the next save' }); }
  }

  stop(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.flush(); } }
}
