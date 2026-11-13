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
// Used by wiring-shared.ts attachProjectMaps; pinned by test/unit/projectmap-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { applyChanges, applyEdit, checkMap, elementOfFile, isMapId, MAP_LIMITS, projectSlug, type MapAgent, type MapElement, type MapPlan, type MapState, type MapWork, type ProjectMap, type ProjectMapInfo, type ProjectMapView } from '@shared/project-map';
import { askLine } from '../appctl/digest';
import { markOf, progressOf } from '../appctl/agents-recap';
import { errText, log } from '../log';
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

interface Focus { project: string; elements: string[]; at: number }
interface Sent { text: string; at: number; seenAt?: number }
interface State { focus: Record<string, Focus>; changed: Record<string, Record<string, number>>; sent?: Record<string, Sent>; mirrored?: Record<string, MapState> }
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

  constructor(private readonly d: ProjectMapsDeps) {
    try {
      const s = JSON.parse(fs.readFileSync(d.stateFile, 'utf8')) as Partial<State>;
      this.state = { focus: s.focus && typeof s.focus === 'object' ? s.focus : {}, changed: s.changed && typeof s.changed === 'object' ? s.changed : {}, sent: s.sent && typeof s.sent === 'object' ? s.sent : {}, mirrored: s.mirrored && typeof s.mirrored === 'object' ? s.mirrored : {} };
    } catch { /* first start: nothing bound yet */ }
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  list(): ProjectMapInfo[] { return this.d.store.list(); }

  /** The project a name means: its folder name, its title, or a slug of it. */
  resolve(name: string): string | null {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    const all = this.list();
    return all.find(m => m.project === n)?.project ?? all.find(m => m.title.toLowerCase() === n)?.project ?? all.find(m => m.project === projectSlug(name))?.project ?? null;
  }

  view(project: string, version?: number): ProjectMapView | null {
    const map = version === undefined ? this.d.store.get(project) : this.d.store.version(project, version);
    if (!map) return null;
    const { works, plans } = version === undefined ? this.works(project) : { works: {}, plans: [] };
    // a step under way vouches for its element now: the app sees it, so the status never reads «da verificare» meanwhile
    const now = this.now();
    const live = map.elements.some(e => works[e.id]?.some(w => w.state === 'now')) ? { ...map, elements: map.elements.map(e => (works[e.id]?.some(w => w.state === 'now') ? { ...e, confirmedAt: now } : e)) } : map;
    return { map: live, history: this.d.store.history(project), agents: this.agents(project), changed: this.state.changed[project] ?? {}, works, plans };
  }

  /** The plans drawn on a project's map and their steps, per element: read from the chats, never saved (ADR 0276). */
  private works(project: string): { works: Record<string, MapWork[]>; plans: MapPlan[] } {
    const works: Record<string, MapWork[]> = {}, plans: MapPlan[] = [], now = this.now();
    for (const c of this.d.chats()) {
      const p = c.plan;
      if (!p || p.map !== project || p.phase === 'asking') continue;
      if ((c.closedAt || c.state === 'closed') && (p.phase !== 'done' && p.phase !== 'running' || now - (c.closedAt ?? c.updatedAt) > ENDED_MS)) continue;
      plans.push({ chatId: c.id, title: c.title, phase: p.phase, at: p.at, steps: p.steps.length, done: p.steps.filter(x => x.state === 'done').length, ...(p.doneWhen ? { doneWhen: p.doneWhen } : {}) });
      p.steps.forEach((x, i) => { if (x.on) (works[x.on] ??= []).push({ title: x.title, state: x.state, ...(x.role ? { role: x.role } : {}), chatId: c.id, step: i + 1, chatIds: x.chatIds ?? [], ...(x.added ? { added: true } : {}) }); });
    }
    return { works, plans: plans.sort((a, b) => b.at - a.at) };
  }

  elementsOf(project: string): string[] { return this.d.store.get(project)?.elements.map(e => e.id) ?? []; }

  /** A piece-by-piece change (ADR 0276): the Orchestrator's, from what the user said, or a plan's. One version. */
  edit(project: string, ops: unknown, by: string, plan?: string): { map: ProjectMap; did: string[]; added: string[] } {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»`);
    const now = this.now();
    const { elements, links, did, added } = applyEdit(prev, ops, now, plan);
    const map: ProjectMap = { ...prev, elements, links, version: prev.version + 1, updatedAt: now, by, summary: did.join(' · ').slice(0, MAP_LIMITS.summary) };
    this.d.store.save(map);
    const ids = new Set(elements.map(e => e.id));
    for (const f of Object.values(this.state.focus)) if (f.project === project) f.elements = f.elements.filter(id => ids.has(id));
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
    const map: ProjectMap = { ...cur, elements, links: before.links, corrections: before.corrections, version: cur.version + 1, updatedAt: this.now(), by, summary: `annullato: ${last!.summary}`.slice(0, MAP_LIMITS.summary) };
    this.d.store.save(map);
    const ids = new Set(elements.map(e => e.id));
    for (const f of Object.values(this.state.focus)) if (f.project === project) f.elements = f.elements.filter(id => ids.has(id));
    this.persist();
    this.changed(project);
    return map;
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
      if (!add.length) throw new Error(`map: no map «${name.slice(0, 80)}» yet (maps: ${this.list().map(m => m.project).join(', ') || 'none'}). Give title and, in add, the pieces this work touches.`);
      const first = this.save({ title: name, ...(chat?.cwd ? { defaultRoot: chat.cwd } : {}), by, summary: 'mappa nata da un piano',
        map: { elements: add.map(x => ({ ...(x as object), status: 'planned', evidence: [], id: (x as { id?: unknown }).id ?? projectSlug(String((x as { name?: unknown }).name ?? '')) })), links } });
      project = first.project;
      const mine = first.elements.map(e => ({ ...e, plan: chatId, addedAt: first.updatedAt }));
      this.d.store.save({ ...first, elements: mine });
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
    for (const info of this.list()) {
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
      if (!f || f.project !== p.map) { this.state.focus[chatId] = { project: p.map!, elements: [el], at: now }; bound = true; }
      else if (!f.elements.includes(el)) { f.elements.push(el); bound = true; }
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
    const changes: { id: string; status: MapState }[] = [];
    let told = false;
    if (p.phase === 'running' || p.phase === 'done') for (const [id, states] of by) {
      const want: MapState | null = states.includes('blocked') ? 'blocked' : states.every(x => x === 'done') ? 'ok' : states.some(x => x !== 'todo') ? 'work' : null;
      // only when the steps moved since the last mirror: a status an agent or the Orchestrator set after it stays
      const key = `${c.id}:${id}`, memo = (this.state.mirrored ??= {});
      if (!want || memo[key] === want) continue;
      memo[key] = want; told = true;
      if (map.elements.find(e => e.id === id)!.status !== want) changes.push({ id, status: want });
    }
    if (told && !changes.length) this.persist();
    if (changes.length) {
      const name = (id: string) => map.elements.find(e => e.id === id)?.name ?? id;
      const label = { ok: 'funziona', work: 'in lavorazione', blocked: 'bloccato', unknown: 'da capire', planned: 'previsto' } as const;
      try { this.update(p.map, { changes, by: 'app', summary: changes.map(x => `${name(x.id)}: ${label[x.status]}`).join(' · ') }); }
      catch (err) { log.warn('projectmap', 'plan not mirrored on its map', { cause: errText(err), hint: 'the map keeps its last statuses; the next plan change retries' }); }
    } else this.changed(p.map);
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
    if (root && !isAbs(norm(root))) throw new Error(`root: the project's folder as an absolute path, not «${root.slice(0, 80)}»`);
    const now = this.now();
    const { elements, links } = checkMap(a.map, now, prev);
    const summary = a.summary.trim().slice(0, MAP_LIMITS.summary) || (prev ? 'mappa ridisegnata' : 'prima mappa');
    const map: ProjectMap = {
      project, title: title || prev?.title || project, ...(root ? { root } : {}),
      version: (prev?.version ?? 0) + 1, updatedAt: now, by: a.by, summary, elements, links,
      corrections: a.corrections ?? prev?.corrections ?? [],
    };
    this.d.store.save(map);
    // an element that left the drawing leaves the bindings and the edit times too
    const ids = new Set(elements.map(e => e.id));
    const changed = this.state.changed[project];
    if (changed) for (const id of Object.keys(changed)) if (!ids.has(id) || (elements.find(e => e.id === id)!.confirmedAt >= changed[id]!)) delete changed[id];
    for (const f of Object.values(this.state.focus)) if (f.project === project) f.elements = f.elements.filter(id => ids.has(id));
    this.persist();
    log.info('projectmap', 'project map saved', { data: { project, version: map.version, elements: elements.length, links: links.length, by: a.by } });
    this.changed(project);
    return map;
  }

  /** A status update (project_map_update): each change is confirmed now; `working_on` binds the calling chat. */
  update(project: string, a: { changes?: unknown; workingOn?: unknown; chatId?: string; by: string; summary?: string }): { map: ProjectMap | null; touched: string[] } {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»: disegnala prima con project_map_save`);
    const now = this.now();
    // the changes first: a wrong one refuses the whole call, binding included
    const next = a.changes === undefined ? null : applyChanges(prev, a.changes, now);
    if (a.workingOn !== undefined) {
      if (!a.chatId) throw new Error('working_on: only a chat can say what it works on');
      if (!Array.isArray(a.workingOn) || a.workingOn.length > 20 || !a.workingOn.every(isMapId)) throw new Error('working_on: up to 20 element ids');
      const unknown = (a.workingOn as string[]).filter(id => !prev.elements.some(e => e.id === id));
      if (unknown.length) throw new Error(`working_on: no element ${unknown.join(', ')} (project_map_read lists them)`);
      this.state.focus[a.chatId] = { project, elements: [...new Set(a.workingOn as string[])], at: now };
      this.persist();
    }
    if (!next) { this.changed(project); return { map: null, touched: [] }; }
    const { elements, links, touched } = next;
    const map: ProjectMap = { ...prev, elements, links, version: prev.version + 1, updatedAt: now, by: a.by,
      summary: (a.summary ?? '').trim().slice(0, MAP_LIMITS.summary) || `stato di ${touched.join(', ')}` };
    this.d.store.save(map);
    const changed = this.state.changed[project];
    if (changed) for (const id of touched) delete changed[id];
    this.persist();
    this.changed(project);
    return { map, touched };
  }

  /** A correction of the user's (the Orchestrator writes it): kept for every later drawing. */
  correct(project: string, text: string): ProjectMap {
    const prev = this.d.store.get(project);
    if (!prev) throw new Error(`nessuna mappa «${project}»`);
    const t = text.replace(/\s+/g, ' ').trim().slice(0, MAP_LIMITS.correction);
    if (!t) throw new Error('text: the correction, in the user\'s words');
    const map: ProjectMap = { ...prev, corrections: [...prev.corrections, t].slice(-MAP_LIMITS.corrections), version: prev.version + 1, updatedAt: this.now(), by: 'utente', summary: `correzione: ${t}`.slice(0, MAP_LIMITS.summary) };
    this.d.store.save(map);
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
      if (!c || c.quick) continue;
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
      else if (channel === 'chat:updated') { const c = payload as ChatSummary; this.syncPlan(c); const f = this.state.focus[c.id]; if (f) this.changed(f.project); }
      else if (channel === 'chat:removed') {
        const id = (payload as { chatId: string }).chatId, f = this.state.focus[id];
        this.dropPlan(id);
        if (this.state.sent?.[id]) delete this.state.sent[id];
        for (const k of Object.keys(this.state.mirrored ?? {})) if (k.startsWith(`${id}:`)) delete this.state.mirrored![k];
        if (f) { delete this.state.focus[id]; this.persist(); this.changed(f.project); }
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
    const maps = this.list().map(m => this.d.store.get(m.project)).filter((m): m is ProjectMap => !!m?.root);
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
      (this.state.changed[m.project] ??= {})[el] = item.at;
      const f = this.state.focus[chatId];
      if (!f || f.project !== m.project) this.state.focus[chatId] = { project: m.project, elements: [el], at: item.at };
      else if (!f.elements.includes(el)) f.elements.push(el);
      this.persist();
      this.changed(m.project);
    }
  }

  private changed(project: string): void {
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
