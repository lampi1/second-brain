// The work maps, live (ADR 0342): one map per Strategist job or idea, created and kept by the app in code. It watches the
// events main sends to the page (chat:updated, chat:removed) like the project maps do, so no agent has to call anything:
// a Strategist's root chat has a map from its first event, the map holds a copy of the chat's plan and survives the chat.
// - Which map is a chat's: the one of that chat and that job (taskOf); the one the chat was started for (ChatSummary.workMap,
//   an idea started or a job resumed in a new chat); the one of the chat it continues. Else a new map. A chat that moves to
//   another job leaves its earlier map behind (stopped, or finished) and gets another.
// - At load the same runs over the chats already there: a chat with a plan of an older version gets its map once. An old
//   closed chat with no plan gets none; one whose job was over goes straight to the archive.
// - The user's and the Orchestrator's actions go through the chat's own plan methods (ChatManager planDecide, planStart,
//   planStop, planResume, planReplan), so an approval is recorded in the coordination journal as before. A job whose chat
//   is gone, and an idea, start a new Strategist (workmap/start.ts).
// - The live status (live.ts, live-memory.ts): what the chats of each map do now, read again at each of their events and
//   once a minute (tick); it is never a version, and the page is told only when what it shows is different. An owner chat
//   that died by itself (its engine, or the app closed or dropped it with the job open) stops the map, and the
//   Orchestrator is told once per stop, so it takes the job up again; a chat closed by hand only stops it.
// - A finished map the user looked at (seen) moves to the archive; nothing is ever deleted.
// Used by wiring-shared.ts attachWorkMaps, ipc-handlers/brain.ts and the Orchestrator's app_project_map
// (workmap/tools.ts, through projectmap/tools.ts); pinned by test/unit/workmap-service.test.ts and test/unit/agents/work-map-chats.test.ts.
import crypto from 'node:crypto';
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { drawingOf, WORK_MAP_LIMITS, workActions, workInfo, type WorkMap, type WorkMapAction, type WorkMapInfo, type WorkMapState, type WorkMapView } from '@shared/work-map';
import { errText, log } from '../log';
import { follow, left, ownsJob, requestOf, settle, stateLine, summaryOf, taskOf, titleOf } from './follow';
import { liveOf, movesBelow, type LiveInput } from './live';
import { LiveMemory, liveKey } from './live-memory';
import type { WorkMapStore } from './store';

/** What the maps need from the chats (ChatService). */
export interface WorkChats {
  list(): ChatSummary[];
  planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string, by?: 'pc' | 'phone', keep?: boolean): Promise<void>;
  planStart(chatId: string): Promise<void>;
  planStop(chatId: string): Promise<void>;
  planResume(chatId: string): Promise<void>;
  planReplan(chatId: string, text: string): Promise<void>;
  planPutAway(chatId: string): void;
  /** the open requests, for whom a chat waits */
  pending?(): PendingRequest[];
}
/** Who is told of a job stopped by itself (OrchestratorWake). */
export interface StopNews {
  /** false = not taken: told again later */
  stalledWork(n: { threadId: string; title: string; detail: string; at: number }): boolean;
  /** the job moved again, or the user stopped it */
  unstalled(threadId: string): void;
}
/** How long a chat whose engine died has to come back by itself before its map is stopped. */
export const CRASH_GRACE_MS = 60_000;
export interface WorkMapsDeps {
  store: Pick<WorkMapStore, 'load' | 'save' | 'history' | 'version'> & Partial<Pick<WorkMapStore, 'loadLive' | 'saveLive'>>;
  chats: WorkChats;
  /** tells the page a map changed */
  emit(id: string): void;
  /** the project maps a chat works in or on (folder names) */
  projectsOf?(chat: ChatSummary): string[];
  /** a project as the user names it → its map's folder name, or null */
  projectNamed?(name: string): string | null;
  /** opens a Strategist for a map (an idea, or a job whose chat is gone); the chat carries the map's id */
  startStrategist?(map: WorkMap, change: string | undefined, by: string): Promise<ChatSummary>;
  now?: () => number;
  newId?: () => string;
}

const ACTION_WORDS: Record<WorkMapAction, string> = {
  approve: 'approvare', keep: 'approvare e tenere per dopo', start: 'avviare', stop: 'fermare', resume: 'riprendere', replan: 'ripianificare', archive: 'archiviare', reopen: 'riaprire', seen: 'segnare come vista',
};
/** the order of the list: what waits for the user first */
const ORDER: readonly WorkMapState[] = ['toApprove', 'running', 'stopped', 'planned', 'idea', 'finished', 'archived'];
/** what makes a version: everything but the version's own fields */
const content = (m: WorkMap): string => JSON.stringify({ ...m, version: 0, updatedAt: 0, by: '', summary: '' });

export class WorkMaps {
  private maps = new Map<string, WorkMap>();
  /** chat → what its last event looked like: an event that changes nothing here costs a comparison */
  private seenChats = new Map<string, { plan: ChatSummary['plan']; key: string }>();
  /** maps with an action under way: a second click waits for nothing, it is refused */
  private busy = new Set<string>();

  /** map → its live status as the page last had it: an event that changes nothing there is not sent */
  private pictures = new Map<string, string>();
  /** chat → what its live status is made of, and who delegated it */
  private liveKeys = new Map<string, { key: string; parent?: string }>();
  /** owner chats whose engine died, until they come back or CRASH_GRACE_MS passed */
  private dying = new Map<string, number>();
  private readonly memory: LiveMemory;
  private timer: ReturnType<typeof setInterval> | undefined;
  private news: StopNews | undefined;

  constructor(private readonly d: WorkMapsDeps) {
    for (const m of d.store.load()) this.maps.set(m.id, m);
    this.memory = new LiveMemory(d.store.loadLive?.() ?? null);
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  private newId(): string { return this.d.newId?.() ?? `wm_${crypto.randomBytes(6).toString('hex')}`; }

  /** The chats already there at start: plans of an older version get their map; a map whose chat is gone is stopped. */
  adopt(): void {
    const chats = this.d.chats.list();
    for (const c of chats) this.safe(c.id, () => { this.hand(c); this.onChat(c, true); });
    const ids = new Set(chats.map(c => c.id));
    for (const m of [...this.maps.values()]) if (m.owner && !ids.has(m.owner.chatId)) this.safe(m.owner.chatId, () => this.put(left(m, 'gone', this.now()), undefined, !this.memory.removedBy(m.owner!.chatId)));
    for (const c of chats) this.liveKeys.set(c.id, { key: liveKey(c), ...(c.parentId ? { parent: c.parentId } : {}) });
    for (const m of this.maps.values()) this.pictures.set(m.id, this.picture(m));
  }

  /** Who hears of a job stopped by itself; the stops before this call are told at the next tick. */
  tellTo(news: StopNews): void { this.news = news; }

  /** The live status kept true with no event: once a minute until stop(). */
  start(everyMs = 60_000): void {
    this.timer ??= setInterval(() => this.tick(), everyMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.remember();
  }

  /** What time alone changes: a chat that did not come back, a state nobody vouches for any more, a stop still to tell. */
  tick(): void {
    this.safe('', () => this.bury());
    for (const m of [...this.maps.values()]) if (m.state !== 'archived') this.safe('', () => this.refresh(m.id));
    this.safe('', () => this.tellStops());
    this.remember();
  }

  /** The events main sends to the page. */
  observe(channel: string, payload: unknown): void {
    if (channel === 'chat:updated') { const c = payload as ChatSummary; this.safe(c.id, () => { this.hand(c); this.onChat(c); }); this.safe(c.id, () => this.onLive(c)); }
    else if (channel === 'chat:removed') { const { chatId, by } = payload as { chatId: string; by?: 'user' | 'agent' }; this.safe(chatId, () => this.onRemoved(chatId, by)); }
    else if (channel === 'pending:added' || channel === 'pending:resolved') { const { chatId } = payload as { chatId: string }; this.safe(chatId, () => this.refreshOf(chatId)); }
  }
  /** A map that cannot be saved never breaks the chat's own event. */
  private safe(chatId: string, fn: () => void): void {
    try { fn(); } catch (e) { log.warn('workmap', 'a work map did not follow its chat', { chat: chatId, cause: errText(e), hint: 'the next change of the chat tries again' }); }
  }

  private onChat(c: ChatSummary, atLoad = false): void {
    if (!ownsJob(c)) return;
    const key = `${taskOf(c)}|${c.title}|${c.cwd}|${c.closedAt ?? 0}|${c.closedBy ?? ''}|${c.run?.report?.at ?? 0}|${c.run?.report?.via ?? ''}|${c.plan ? '' : c.workSince ?? 0}|${c.continuedFrom?.id ?? ''}|${c.workMap ?? ''}`;
    const last = this.seenChats.get(c.id);
    if (last && last.plan === c.plan && last.key === key) return;
    const m = this.mapOf(c) ?? this.create(c, atLoad);
    if (m) this.put(this.followed(m, c), undefined, this.alone(c));
    this.seenChats.set(c.id, { plan: c.plan, key });
  }

  private followed(m: WorkMap, c: ChatSummary): WorkMap { return this.withProjects(follow(m, c, this.now(), this.memory.crashed(c.id)), c); }
  /** Whether a map this chat leaves stopped was stopped by the chat's own end, not by the user's hand. */
  private alone(c: ChatSummary): boolean { return c.closedAt ? c.closedBy !== 'user' : this.memory.crashed(c.id); }

  private onRemoved(chatId: string, by?: 'user' | 'agent'): void {
    this.seenChats.delete(chatId);
    this.dying.delete(chatId);
    const touched = this.mapsOf(chatId), mine = [...this.maps.values()].filter(m => m.owner?.chatId === chatId);
    this.memory.forget(chatId);
    if (by && mine.length) this.memory.removed(chatId, by);
    // closed by an agent = the Orchestrator's own close: it knows
    for (const m of mine) this.put(left(m, 'gone', this.now()), undefined, !this.memory.removedBy(chatId));
    this.liveKeys.delete(chatId);
    for (const id of touched) this.refresh(id);
  }

  /** The user's hand on an owner chat, remembered: the chat may leave the app later, and it was still closed by hand. */
  private hand(c: ChatSummary): void {
    if (ownsJob(c)) this.memory.removed(c.id, c.closedAt && c.closedBy === 'user' ? 'user' : undefined);
  }

  /** The chat's event for the live status: what the page shows of its maps is read again only when something of it changed. */
  private onLive(c: ChatSummary): void {
    if (c.state === 'error' && !c.closedAt) { if (ownsJob(c) && !this.memory.crashed(c.id) && !this.dying.has(c.id)) this.dying.set(c.id, this.now()); } else if (c.state !== 'closed') {
      // alive again: its map is not stopped for it any more
      this.dying.delete(c.id);
      if (this.memory.alive(c.id)) { this.seenChats.delete(c.id); this.onChat(c); }
    }
    const key = liveKey(c);
    if (this.liveKeys.get(c.id)?.key === key) return;
    this.liveKeys.set(c.id, { key, ...(c.parentId ? { parent: c.parentId } : {}) });
    this.refreshOf(c.id);
  }

  /** The maps a chat counts for: its own, its step's, and those of the chats above it. */
  private mapsOf(chatId: string): string[] {
    const chain = new Set<string>();
    for (let id: string | undefined = chatId; id && !chain.has(id); id = this.liveKeys.get(id)?.parent) chain.add(id);
    return [...this.maps.values()].filter(m => m.owner && chain.has(m.owner.chatId) || m.plan?.steps.some(s => s.chatIds?.some(id => chain.has(id)))).map(m => m.id);
  }
  private refreshOf(chatId: string): void { for (const id of this.mapsOf(chatId)) this.refresh(id); }
  private refresh(id: string): void {
    const m = this.maps.get(id);
    if (!m) return;
    const pic = this.picture(m);
    if (this.pictures.get(id) === pic) return;
    this.pictures.set(id, pic);
    this.d.emit(id);
  }

  private live(m: WorkMap, chats = this.d.chats.list()): ReturnType<typeof liveOf> {
    const id = m.owner?.chatId, removedBy = id ? this.memory.removedBy(id) : undefined;
    const input: LiveInput = { chats, asks: this.d.chats.pending?.() ?? [], now: this.now(), confirmed: c => this.memory.confirmed(c), crashed: !!id && this.memory.crashed(id), ...(removedBy ? { removedBy } : {}) };
    return liveOf(m, input);
  }
  /** The live status as compared; what it confirms is remembered. */
  private picture(m: WorkMap): string {
    const chats = this.d.chats.list(), l = this.live(m, chats);
    for (const w of [...l.boxes.flatMap(b => b?.chats ?? []), ...(l.map ? [...l.map.working, ...l.map.waiting] : [])]) this.memory.confirm(w, chats.find(c => c.id === w.chatId)?.lastResult?.at, this.now());
    return JSON.stringify(l);
  }
  private info(m: WorkMap, chats: ChatSummary[]): WorkMapInfo { const l = this.live(m, chats).map; return { ...workInfo(m), ...(l ? { live: l } : {}) }; }

  /** A chat whose engine died and did not come back, with nothing under way below it: its map stops. */
  private bury(): void {
    const chats = this.d.chats.list();
    for (const [id, since] of [...this.dying]) {
      const c = chats.find(x => x.id === id);
      if (!c || c.closedAt || c.state !== 'error') { this.dying.delete(id); continue; }
      const m = this.ofChat(id);
      // a plan to approve or kept, and the user's stop, stay as they are
      if (this.now() - since < CRASH_GRACE_MS || !m || m.state !== 'running' && m.state !== 'idea') continue;
      if (movesBelow(id, chats, this.d.chats.pending?.() ?? [])) continue;
      this.dying.delete(id);
      this.memory.crash(id, this.now());
      this.seenChats.delete(id);
      this.onChat(c);
    }
  }

  /** The stops the Orchestrator does not know yet. Not taken (off, no Orchestrator) = again at the next tick. */
  private tellStops(): void {
    for (const id of this.memory.untold()) {
      const m = this.maps.get(id);
      if (!m || m.state !== 'stopped') { this.memory.unstop(id); continue; }
      const left = m.plan?.steps.filter(s => s.state !== 'done' && !s.drop).length ?? 0;
      const detail = `${this.live(m).map?.why === 'crash' ? 'il motore della chat è caduto e non è ripartito' : m.stopped?.by === 'gone' ? 'la chat non è più nell’app' : 'la chat è stata chiusa dall’app a lavoro aperto'}${left ? `; passi da finire: ${left}` : ''}. L’utente non l’ha fermato: riprendilo con app_project_map, action resume, job ${m.id}.`;
      if (this.news?.stalledWork({ threadId: m.id, title: m.title, detail, at: m.stopped!.at })) this.memory.told(id);
    }
  }
  private remember(): void {
    if (!this.d.store.saveLive) return;
    try {
      const ids = new Set(this.d.chats.list().map(c => c.id)), owners = new Set([...this.maps.values()].flatMap(m => (m.owner ? [m.owner.chatId] : [])));
      const v = this.memory.toSave(id => ids.has(id), id => owners.has(id));
      if (v) this.d.store.saveLive(v);
    } catch (e) { log.warn('workmap', 'the live status of the work maps was not saved', { cause: errText(e), hint: 'saved again within a minute' }); }
  }

  /** The map of the job this chat is on, with the chat as its owner; null = it has none yet. */
  private mapOf(c: ChatSummary): WorkMap | null {
    const task = taskOf(c), all = [...this.maps.values()], mine = all.filter(m => m.owner?.chatId === c.id);
    const same = mine.find(m => m.owner!.task === task);
    if (same) return same;
    // its first run was not known yet when the map was made
    const early = mine.find(m => m.owner!.task === 'chat');
    if (early) return { ...early, owner: { chatId: c.id, task } };
    if (task === 'chat' && mine.length) return mine[mine.length - 1]!;
    for (const m of mine) this.put(left(m, 'replaced', this.now()));
    if (mine.length) return null;
    const was = all.find(m => m.id === c.workMap && !m.past?.includes(c.id)) ?? (c.continuedFrom ? all.find(m => m.owner?.chatId === c.continuedFrom!.id && m.state !== 'finished' && m.archivedAt === undefined) : undefined);
    return was ? this.moved(was, c) : null;
  }

  private moved(m: WorkMap, c: ChatSummary): WorkMap {
    const past = [...new Set([...(m.past ?? []), ...(m.owner ? [m.owner.chatId] : [])])].slice(-WORK_MAP_LIMITS.past);
    const { stopped: _s, finishedAt: _f, seenAt: _v, archivedAt: _a, ...rest } = m;
    return settle({ ...rest, owner: { chatId: c.id, task: taskOf(c) }, ...(past.length ? { past } : {}) });
  }

  private create(c: ChatSummary, atLoad: boolean): WorkMap | null {
    // an old chat nobody works in any more, with no plan to keep
    if (c.closedAt && !c.plan) return null;
    const now = this.now(), idea = requestOf(c);
    const m = settle({ id: this.newId(), version: 0, title: titleOf(c), ...(idea ? { idea } : {}), touches: [], owner: { chatId: c.id, task: taskOf(c) }, createdAt: c.run?.startedAt ?? now, updatedAt: now, by: 'app', summary: '' });
    if (!atLoad || !c.closedAt || c.plan?.phase !== 'done') return m;
    // an old job already over: in the archive, not in front of the user again
    return settle({ ...m, finishedAt: c.plan.at, seenAt: c.plan.at, archivedAt: now });
  }

  /** The project maps the job touches: its plan's, its chat's, its steps' chats'. They only grow. */
  private withProjects(m: WorkMap, c: ChatSummary): WorkMap {
    const ids = new Set((m.plan?.steps ?? []).flatMap(s => s.chatIds ?? []));
    const steps = ids.size && this.d.projectsOf ? this.d.chats.list().filter(x => ids.has(x.id)) : [];
    const of = [...(m.plan?.map ? [m.plan.map] : []), ...[c, ...steps].flatMap(x => this.d.projectsOf?.(x) ?? [])];
    const touches = [...new Set([...m.touches, ...of])].filter(t => t && t.length <= WORK_MAP_LIMITS.project).slice(0, WORK_MAP_LIMITS.touches);
    const project = m.project ?? touches[0];
    return { ...m, touches, ...(project ? { project } : {}) };
  }

  /** Saved as the next version when something really changed. */
  private put(next: WorkMap, by?: string, alone = false): WorkMap {
    const prev = this.maps.get(next.id) ?? null;
    if (prev && content(prev) === content(next)) return prev;
    const who = (by ?? (prev && next.owner ? next.title : 'app')).slice(0, WORK_MAP_LIMITS.by);
    const saved: WorkMap = { ...next, version: (prev?.version ?? 0) + 1, updatedAt: this.now(), by: who, summary: summaryOf(prev, next) };
    this.d.store.save(saved);
    this.maps.set(saved.id, saved);
    if (saved.state !== 'stopped' || saved.stopped?.by === 'user') { if (this.memory.unstop(saved.id)) this.news?.unstalled(saved.id); } else if (prev && prev.state !== 'stopped' && alone) { this.memory.stopped(saved.id, saved.stopped!.at); this.tellStops(); }
    // one event for the version and for what it changes of the live status
    this.pictures.set(saved.id, this.picture(saved));
    this.d.emit(saved.id);
    return saved;
  }

  /** The list: the maps not archived, or the archived ones; a query looks in both. */
  list(q: { archived?: boolean; query?: string } | void): WorkMapInfo[] {
    const words = (q?.query ?? '').toLowerCase().split(' ').filter(Boolean);
    const text = (m: WorkMap) => [m.title, m.idea ?? '', m.project ?? '', ...m.touches, ...(m.plan?.steps ?? []).map(s => s.title)].join(' ').toLowerCase();
    const order = (m: WorkMap) => ORDER.indexOf(m.state), chats = this.d.chats.list();
    return [...this.maps.values()]
      .filter(m => words.length ? words.every(w => text(m).includes(w)) : q?.archived ? m.state === 'archived' : m.state !== 'archived')
      .sort((a, b) => order(a) - order(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(m => this.info(m, chats));
  }

  /** The jobs that touch a project map (ProjectMapView.jobs), the archived ones left out. */
  touching(project: string): WorkMapInfo[] { return this.list().filter(i => i.touches.includes(project)); }

  /** The map of the job a chat is on, when it has one. */
  ofChat(chatId: string): WorkMap | null {
    const mine = [...this.maps.values()].filter(m => m.owner?.chatId === chatId);
    return mine.find(m => m.stopped?.by !== 'replaced' && m.state !== 'archived') ?? mine[mine.length - 1] ?? null;
  }

  get(id: string): WorkMap | null { const m = this.maps.get(id); return m ? structuredClone(m) : null; }

  view(id: string, version?: number): WorkMapView | null {
    const now = this.maps.get(id);
    if (!now) return null;
    const m = version === undefined || version === now.version ? now : this.d.store.version(id, version);
    if (!m) return null;
    const map = structuredClone(m), { boxes, links } = drawingOf(map), history = this.d.store.history(id);
    // an earlier version is only what it was
    if (map.version !== now.version) return { map, info: { ...workInfo(map), can: [] }, boxes, links, history };
    const live = this.live(map);
    return { map, info: { ...workInfo(map), ...(live.map ? { live: live.map } : {}) }, boxes: boxes.map((b, i) => (live.boxes[i] ? { ...b, live: live.boxes[i] } : b)), links, history };
  }

  /** A map from an idea alone: no chat is started. */
  idea(a: { title: string; idea?: string; project?: string }, by = 'user'): WorkMap {
    const line = (v: unknown, max: number, what: string): string => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (s.length > max) throw new Error(`${what}: al massimo ${max} caratteri`);
      return s;
    };
    const title = line(a?.title, WORK_MAP_LIMITS.title, 'title').replace(/\s+/g, ' ');
    if (!title) throw new Error('title: scrivi l’idea in una riga');
    const idea = line(a.idea, WORK_MAP_LIMITS.idea, 'idea'), named = line(a.project, WORK_MAP_LIMITS.project, 'project');
    const known = named ? this.d.projectNamed?.(named) ?? null : null, project = known ?? named, now = this.now();
    return this.clone(this.put(settle({ id: this.newId(), version: 0, title, ...(idea ? { idea } : {}), ...(project ? { project } : {}), touches: known ? [known] : [], createdAt: now, updatedAt: now, by, summary: '' }), by));
  }

  /** One action on a map, for the user (IPC) or for the Orchestrator; refused when the map does not allow it now. */
  async act(id: string, action: WorkMapAction, a: { at?: number; text?: string } = {}, by = 'user'): Promise<WorkMap> {
    const m = this.maps.get(id);
    if (!m) throw new Error('Questa mappa non c’è.');
    // the screen says it of every map it shows: only a finished one moves
    if (action === 'seen' && m.state !== 'finished') return this.clone(m);
    if (!workActions(m).includes(action)) throw new Error(`Non si può ${ACTION_WORDS[action]}: la mappa è «${stateLine(m)}».`);
    if (this.busy.has(id)) throw new Error('Un’azione su questa mappa è già in corso.');
    this.busy.add(id);
    try { await this.run(m, action, a, by); } finally { this.busy.delete(id); }
    log.info('workmap', 'action on a work map', { data: { id, action, by: by === 'user' ? 'user' : 'orchestrator' } });
    return this.clone(this.maps.get(id)!);
  }

  private async run(m: WorkMap, action: WorkMapAction, a: { at?: number; text?: string }, by: string): Promise<void> {
    const { chats } = this.d, chat = this.ownerChat(m);
    switch (action) {
      case 'approve': case 'keep': {
        if (!Number.isFinite(a.at)) throw new Error('at: la revisione del piano che hai visto');
        await chats.planDecide(this.needChat(chat).id, 'approve', a.at!, undefined, 'pc', action === 'keep');
        return this.sync(m.id, by);
      }
      case 'start':
        if (!m.owner) return this.begin(m, by);
        await chats.planStart(this.needChat(chat).id);
        return this.sync(m.id, by);
      case 'stop':
        if (chat) await chats.planStop(chat.id);
        this.sync(m.id, by);
        this.edit(m.id, by, x => (x.state === 'finished' || x.stopped ? x : settle({ ...x, stopped: { at: this.now(), by: 'user' } })));
        return;
      case 'resume':
        // its chat is gone, or works on another job now: the job goes on in a new one
        if (!chat) return this.begin(m, by);
        await chats.planResume(chat.id);
        this.memory.alive(chat.id);
        this.dying.delete(chat.id);
        this.sync(m.id, by);
        this.edit(m.id, by, x => { if (!x.stopped) return x; const { stopped: _s, ...rest } = x; return settle(rest); });
        return;
      case 'replan': {
        const text = (a.text ?? '').trim();
        if (!text || text.length > WORK_MAP_LIMITS.change) throw new Error(`Scrivi cosa cambiare (al massimo ${WORK_MAP_LIMITS.change} caratteri).`);
        if (!chat) return this.begin(m, by, text);
        await chats.planReplan(chat.id, text);
        return this.sync(m.id, by);
      }
      case 'archive':
        // what waits or asks in its chat does not stay open behind an archived map
        if (m.state === 'toApprove' && chat) chats.planPutAway(chat.id);
        else if (m.state === 'idea' && chat && !chat.closedAt) await chats.planStop(chat.id);
        this.sync(m.id, by);
        this.edit(m.id, by, x => settle({ ...x, archivedAt: Math.max(this.now(), x.plan?.at ?? 0), ...(x.finishedAt !== undefined ? { seenAt: x.seenAt ?? this.now() } : {}) }));
        return;
      case 'reopen':
        this.edit(m.id, by, x => { const { archivedAt: _a, ...rest } = x; return settle(rest); });
        return;
      case 'seen': {
        const now = this.now();
        this.edit(m.id, by, x => settle({ ...x, seenAt: x.seenAt ?? now, archivedAt: now }));
      }
    }
  }

  private async begin(m: WorkMap, by: string, change?: string): Promise<void> {
    if (!this.d.startStrategist) throw new Error('Qui non si può avviare uno Strategist.');
    const chat = await this.d.startStrategist(structuredClone(m), change, by);
    // its own events linked it already (ChatSummary.workMap); one that did not is linked here
    this.edit(m.id, by, x => (x.owner?.chatId === chat.id ? x : this.moved(x, chat)));
    this.sync(m.id, by);
  }

  /** The chat of the map's job, when it still is on that job. */
  private ownerChat(m: WorkMap): ChatSummary | null {
    const c = m.owner && m.stopped?.by !== 'replaced' ? this.d.chats.list().find(x => x.id === m.owner!.chatId) : undefined;
    return c && (m.owner!.task === 'chat' || taskOf(c) === m.owner!.task) ? c : null;
  }
  private needChat(c: ChatSummary | null): ChatSummary { if (!c) throw new Error('La chat di questo lavoro non c’è più: riprendilo.'); return c; }

  private edit(id: string, by: string, fn: (m: WorkMap) => WorkMap): void { this.put(fn(this.maps.get(id)!), by); }
  /** The map read again from its chat, in the name of who acted. */
  private sync(id: string, by: string): void {
    const m = this.maps.get(id)!, c = this.ownerChat(m);
    if (c) this.put(this.followed(m, c), by, this.alone(c));
  }
  private clone(m: WorkMap): WorkMap { return structuredClone(m); }
}
