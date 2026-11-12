// The project maps, live (ADR 0271): the store (projectmap/store.ts) plus what the app adds without tokens.
// - Which agents work on which element: a chat says so (project_map_update working_on), or the app sees it edit a file
//   an element was read from (its evidence) and binds it. Each bound chat shows on the map with its state, its plan's
//   steps done and in all, its current step and the question it waits on (the same reads as app_agents_recap).
// - When an element's files were last edited by an agent: a status confirmed before that edit reads «da verificare»
//   (shared/project-map.ts shownStatus) until an agent confirms it again.
// It watches the events main sends to the page (chat:item, chat:updated, chat:removed), like run/results.ts, and tells
// the page 'projectmap:changed' (debounced). The bindings and the edit times live in userData/project-map.json.
// Used by wiring-shared.ts attachProjectMaps; pinned by test/unit/projectmap-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '@shared/contract';
import { applyChanges, checkMap, elementOfFile, isMapId, MAP_LIMITS, projectSlug, type MapAgent, type ProjectMap, type ProjectMapInfo, type ProjectMapView } from '@shared/project-map';
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
  /** userData/project-map.json */
  stateFile: string;
  now?: () => number;
  debounceMs?: number;
}

interface Focus { project: string; elements: string[]; at: number }
interface State { focus: Record<string, Focus>; changed: Record<string, Record<string, number>> }
/** a chat that ended stays on its map this long, as «finito» */
const ENDED_MS = 12 * 3600_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'apply_patch']);
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const isAbs = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p);

export class ProjectMaps {
  private state: State = { focus: {}, changed: {} };
  private timers = new Map<string, NodeJS.Timeout>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly d: ProjectMapsDeps) {
    try {
      const s = JSON.parse(fs.readFileSync(d.stateFile, 'utf8')) as Partial<State>;
      this.state = { focus: s.focus && typeof s.focus === 'object' ? s.focus : {}, changed: s.changed && typeof s.changed === 'object' ? s.changed : {} };
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
    return { map, history: this.d.store.history(project), agents: this.agents(project), changed: this.state.changed[project] ?? {} };
  }

  /** A whole drawing (project_map_save): a new map, or the next version of an existing one. */
  save(a: { project?: string; title?: string; root?: string; map: unknown; by: string; summary: string; corrections?: string[] }): ProjectMap {
    const title = (a.title ?? '').trim().slice(0, MAP_LIMITS.title);
    const project = a.project ? (this.resolve(a.project) ?? projectSlug(a.project)) : title ? (this.resolve(title) ?? projectSlug(title)) : '';
    if (!project) throw new Error('project or title: required');
    const prev = this.d.store.get(project);
    const now = this.now();
    const { elements, links } = checkMap(a.map, now, prev);
    const summary = a.summary.trim().slice(0, MAP_LIMITS.summary) || (prev ? 'mappa ridisegnata' : 'prima mappa');
    const map: ProjectMap = {
      project, title: title || prev?.title || project, ...(a.root || prev?.root ? { root: a.root || prev!.root } : {}),
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
    if (a.workingOn !== undefined) {
      if (!a.chatId) throw new Error('working_on: only a chat can say what it works on');
      if (!Array.isArray(a.workingOn) || a.workingOn.length > 20 || !a.workingOn.every(isMapId)) throw new Error('working_on: up to 20 element ids');
      const unknown = (a.workingOn as string[]).filter(id => !prev.elements.some(e => e.id === id));
      if (unknown.length) throw new Error(`working_on: no element ${unknown.join(', ')} (project_map_read lists them)`);
      this.state.focus[a.chatId] = { project, elements: [...new Set(a.workingOn as string[])], at: this.now() };
      this.persist();
    }
    if (a.changes === undefined) { this.changed(project); return { map: null, touched: [] }; }
    const now = this.now();
    const { elements, links, touched } = applyChanges(prev, a.changes, now);
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
      });
    }
    const order = ['wait', 'error', 'run', 'queue', 'idle', 'done'];
    return out.sort((a, b) => order.indexOf(a.mark) - order.indexOf(b.mark) || (b.since ?? 0) - (a.since ?? 0));
  }

  /** Every event main sends to the page passes here (wiring-shared.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    try {
      if (channel === 'chat:item') this.item(payload as { chatId: string; item: ChatItem });
      else if (channel === 'chat:updated') { const f = this.state.focus[(payload as ChatSummary).id]; if (f) this.changed(f.project); }
      else if (channel === 'chat:removed') {
        const id = (payload as { chatId: string }).chatId, f = this.state.focus[id];
        if (f) { delete this.state.focus[id]; this.persist(); this.changed(f.project); }
      }
    } catch (err) { log.warn('projectmap', 'project map event not read', { cause: errText(err), hint: 'the map keeps its last state; the next event retries' }); }
  }

  private item({ chatId, item }: { chatId: string; item: ChatItem }): void {
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
    for (const file of files) {
      const abs = norm(isAbs(norm(file)) ? file : path.join(chat.cwd, file));
      for (const m of maps) {
        const root = norm(m.root!);
        if (!abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) continue;
        const el = elementOfFile(m.elements, abs.slice(root.length + 1));
        if (!el) continue;
        (this.state.changed[m.project] ??= {})[el] = item.at;
        const f = this.state.focus[chatId];
        if (!f || f.project !== m.project) this.state.focus[chatId] = { project: m.project, elements: [el], at: item.at };
        else if (!f.elements.includes(el)) f.elements.push(el);
        this.persist();
        this.changed(m.project);
      }
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
