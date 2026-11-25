// The plans, live (ADR 0342, 0359): one plan per Strategist job or idea, created and kept by the app in code. It watches the
// events main sends to the page (chat:updated, chat:removed), so no agent has to call anything: a Strategist's root chat has a
// plan from its first event, the plan holds a copy of the chat's own plan and survives the chat. Closing a chat, losing it or
// finishing the job never changes a step's state (ADR 0359): only a report, the Strategist's proof, the user or an explicit
// operation do.
// - Which plan is a chat's: the one of that chat and that job (taskOf); the one the chat was started for (ChatSummary.planId,
//   an idea started or a job resumed in a new chat); the one of the chat it continues. Else a new plan. A chat that moves to
//   another job leaves its earlier plan behind (stopped, or finished) and gets another.
// - At load the same runs over the chats already there: a chat with a plan of an older version gets its record once. An old
//   closed chat with no plan gets none; one whose job was over goes straight to the archive.
// - The user's and the Orchestrator's actions go through the chat's own plan methods (ChatManager planDecide, planStart,
//   planStop, planResume, planReplan), so an approval is recorded in the coordination journal as before. A job whose chat
//   is gone, and an idea, start a new Strategist (plans/start.ts). One active Strategist per plan: «Riprendi» goes to the
//   chat that works or the newer one, never to a second.
// - Edits (change): the plan's own words (title, goal, why, project, constraints, links) and its steps, by explicit
//   operations (shared/plan-edit.ts): a save never deletes what it does not name, and every save is a version.
// - The live status (live.ts, live-memory.ts): what the chats of each plan do now, read again at each of their events and once
//   a minute (tick); it is never a version. An owner chat that died by itself stops the plan, and the Orchestrator is told once
//   per stop; a chat closed by hand only stops it.
// - A finished plan the user looked at (seen) moves to the archive; a deleted one goes to the trash and comes back with
//   «Ripristina»; only the user's own «Elimina per sempre» (forgetForever) removes it, and only from the trash.
// Used by wiring-shared.ts attachPlans, ipc-handlers/brain.ts and the Orchestrator's plans tool (plans/tools.ts); pinned by
// test/unit/plans/service.test.ts and test/unit/agents/plan-chats.test.ts.
import crypto from 'node:crypto';
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { approvalGate } from '@shared/plan-doubts';
import { PLAN_LIMITS, planActions, stepViews, waitsForUser, planInfo, type Plan, type PlanAction, type PlanInfo, type PlanLink, type PlanState, type PlanFull } from '@shared/plan';
import { applySteps, type StepOp } from '@shared/plan-edit';
import { errText, log } from '../log';
import { follow, left, ownsJob, requestOf, settle, stateLine, summaryOf, taskOf, titleOf } from './follow';
import { asksOf, liveOf, movesBelow, type LiveInput } from './live';
import { LiveMemory, liveKey } from './live-memory';
import type { PlanStore } from './store';
import path from 'node:path';

/** What the maps need from the chats (ChatService). */
export interface PlanChats {
  list(): ChatSummary[];
  planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string, by?: 'pc' | 'phone', keep?: boolean): Promise<void>;
  planStart(chatId: string): Promise<void>;
  planStop(chatId: string): Promise<void>;
  planResume(chatId: string, cwd?: string): Promise<void>;
  planReplan(chatId: string, text: string): Promise<void>;
  planPutAway(chatId: string): void;
  /** the steps of the plan a live chat carries, by explicit operations (ChatManager.planEdit) */
  planEdit?(chatId: string, ops: readonly StepOp[], by: 'user' | 'strategist'): void;
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
export interface PlansDeps {
  store: Pick<PlanStore, 'load' | 'save' | 'history' | 'version'> & Partial<Pick<PlanStore, 'loadLive' | 'saveLive' | 'forget'>>;
  chats: PlanChats;
  /** tells the page a map changed */
  emit(id: string): void;
  /** opens a Strategist for a map (an idea, or a job whose chat is gone); the chat carries the map's id */
  startStrategist?(map: Plan, change: string | undefined, by: string, cwd?: string): Promise<ChatSummary>;
  now?: () => number;
  newId?: () => string;
}

const ACTION_WORDS: Record<PlanAction, string> = {
  approve: 'approvare', keep: 'approvare e tenere per dopo', start: 'avviare', stop: 'fermare', resume: 'riprendere', replan: 'ripianificare', archive: 'archiviare', reopen: 'riaprire', seen: 'segnare come vista', delete: 'eliminare', restore: 'ripristinare',
};
/** the order of the list: what waits for the user first */
const ORDER: readonly PlanState[] = ['toApprove', 'running', 'stopped', 'planned', 'idea', 'finished', 'archived'];
/** the fields of a plan the page and the tool may set by name */
export interface PlanFields { title?: string; idea?: string | null; goal?: string | null; why?: string | null; project?: string | null; constraints?: readonly string[]; links?: readonly PlanLink[] }
/** One save: what to set, what to add or take away by name, and the steps' operations. Nothing else changes. */
export interface PlanChange { set?: PlanFields; add?: { constraints?: readonly string[]; links?: readonly PlanLink[] }; remove?: { constraints?: readonly string[]; links?: readonly string[] }; steps?: readonly StepOp[] }
/** what makes a version: everything but the version's own fields */
/** the same text whatever the order of the keys: a restart that builds the record in another order is no new version */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)])) : v);
const content = (m: Plan): string => JSON.stringify(canon({ ...m, version: 0, updatedAt: 0, by: '', summary: '' }));

export class Plans {
  private maps = new Map<string, Plan>();
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

  constructor(private readonly d: PlansDeps) {
    for (const m of d.store.load()) this.maps.set(m.id, m);
    this.memory = new LiveMemory(d.store.loadLive?.() ?? null);
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  private newId(): string { return this.d.newId?.() ?? `pl_${crypto.randomBytes(6).toString('hex')}`; }

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
    try { fn(); } catch (e) { log.warn('plans', 'a plan did not follow its chat', { chat: chatId, cause: errText(e), hint: 'the next change of the chat tries again' }); }
  }

  private onChat(c: ChatSummary, atLoad = false): void {
    if (!ownsJob(c)) return;
    const key = `${taskOf(c)}|${c.title}|${c.cwd}|${c.closedAt ?? 0}|${c.closedBy ?? ''}|${c.run?.report?.at ?? 0}|${c.run?.report?.via ?? ''}|${c.plan ? '' : c.workSince ?? 0}|${c.continuedFrom?.id ?? ''}|${c.planId ?? ''}`;
    const last = this.seenChats.get(c.id);
    if (last && last.plan === c.plan && last.key === key) return;
    const m = this.mapOf(c) ?? this.create(c, atLoad);
    if (m) this.put(this.followed(m, c), undefined, this.alone(c));
    this.seenChats.set(c.id, { plan: c.plan, key });
  }

  private followed(m: Plan, c: ChatSummary): Plan { const next = follow(m, c, this.now(), this.memory.crashed(c.id)); return next.project || !c.cwd ? next : { ...next, project: path.basename(c.cwd).slice(0, PLAN_LIMITS.project) }; }
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

  private live(m: Plan, chats = this.d.chats.list()): ReturnType<typeof liveOf> {
    const id = m.owner?.chatId, removedBy = id ? this.memory.removedBy(id) : undefined;
    const input: LiveInput = { chats, asks: this.d.chats.pending?.() ?? [], now: this.now(), confirmed: c => this.memory.confirmed(c), crashed: !!id && this.memory.crashed(id), ...(removedBy ? { removedBy } : {}) };
    return liveOf(m, input);
  }
  /** The live status and the questions as compared; what it confirms is remembered. */
  private picture(m: Plan): string {
    const chats = this.d.chats.list(), l = this.live(m, chats);
    for (const w of [...l.boxes.flatMap(b => b?.chats ?? []), ...(l.map ? [...l.map.working, ...l.map.waiting] : [])]) this.memory.confirm(w, chats.find(c => c.id === w.chatId)?.lastResult?.at, this.now());
    return JSON.stringify([l, asksOf(m, chats).map(a => [a.question.id, a.question.level, a.question.holder, a.question.trail.length, a.question.answered?.at])]);
  }
  private info(m: Plan, chats: ChatSummary[]): PlanInfo { const l = this.live(m, chats).map; return { ...planInfo(m), ...(l ? { live: l } : {}) }; }

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
      const detail = `${this.live(m).map?.why === 'crash' ? 'il motore della chat è caduto e non è ripartito' : m.stopped?.by === 'gone' ? 'la chat non è più nell’app' : 'la chat è stata chiusa dall’app a lavoro aperto'}${left ? `; passi da finire: ${left}` : ''}. L’utente non l’ha fermato: riprendilo con plans, action resume, plan ${m.id}.`;
      if (this.news?.stalledWork({ threadId: m.id, title: m.title, detail, at: m.stopped!.at })) this.memory.told(id);
    }
  }
  private remember(): void {
    if (!this.d.store.saveLive) return;
    try {
      const ids = new Set(this.d.chats.list().map(c => c.id)), owners = new Set([...this.maps.values()].flatMap(m => (m.owner ? [m.owner.chatId] : [])));
      const v = this.memory.toSave(id => ids.has(id), id => owners.has(id));
      if (v) this.d.store.saveLive(v);
    } catch (e) { log.warn('plans', 'the live status of the plans was not saved', { cause: errText(e), hint: 'saved again within a minute' }); }
  }

  /** The map of the job this chat is on, with the chat as its owner; null = it has none yet. */
  private mapOf(c: ChatSummary): Plan | null {
    const task = taskOf(c), all = [...this.maps.values()], mine = all.filter(m => m.owner?.chatId === c.id);
    const same = mine.find(m => m.owner!.task === task);
    if (same) return same;
    // its first run was not known yet when the map was made
    const early = mine.find(m => m.owner!.task === 'chat');
    if (early) return { ...early, owner: { chatId: c.id, task } };
    if (task === 'chat' && mine.length) return mine[mine.length - 1]!;
    for (const m of mine) this.put(left(m, 'replaced', this.now()));
    if (mine.length) return null;
    const was = all.find(m => m.id === c.planId && !m.past?.includes(c.id)) ?? (c.continuedFrom ? all.find(m => m.owner?.chatId === c.continuedFrom!.id && m.state !== 'finished' && m.archivedAt === undefined) : undefined);
    return was ? this.moved(was, c) : null;
  }

  private moved(m: Plan, c: ChatSummary): Plan {
    const past = [...new Set([...(m.past ?? []), ...(m.owner ? [m.owner.chatId] : [])])].slice(-PLAN_LIMITS.past);
    const { stopped: _s, finishedAt: _f, seenAt: _v, archivedAt: _a, ...rest } = m;
    return settle({ ...rest, owner: { chatId: c.id, task: taskOf(c) }, ...(past.length ? { past } : {}) });
  }

  private create(c: ChatSummary, atLoad: boolean): Plan | null {
    // an old chat nobody works in any more, with no plan to keep
    if (c.closedAt && !c.plan) return null;
    const now = this.now(), idea = requestOf(c);
    const m = settle({ id: this.newId(), version: 0, title: titleOf(c), ...(idea ? { idea } : {}), constraints: [], links: [], owner: { chatId: c.id, task: taskOf(c) }, createdAt: c.run?.startedAt ?? now, updatedAt: now, by: 'app', summary: '' });
    if (!atLoad || !c.closedAt || c.plan?.phase !== 'done') return m;
    // an old job already over: in the archive, not in front of the user again
    return settle({ ...m, finishedAt: c.plan.at, seenAt: c.plan.at, archivedAt: now });
  }

  /** Saved as the next version when something really changed. */
  private put(next: Plan, by?: string, alone = false): Plan {
    const prev = this.maps.get(next.id) ?? null;
    if (prev && content(prev) === content(next)) return prev;
    const who = (by ?? (prev && next.owner ? next.title : 'app')).slice(0, PLAN_LIMITS.by);
    const saved: Plan = { ...next, version: (prev?.version ?? 0) + 1, updatedAt: this.now(), by: who, summary: summaryOf(prev, next) };
    this.d.store.save(saved);
    this.maps.set(saved.id, saved);
    if (saved.state !== 'stopped' || saved.stopped?.by === 'user') { if (this.memory.unstop(saved.id)) this.news?.unstalled(saved.id); } else if (prev && prev.state !== 'stopped' && alone) { this.memory.stopped(saved.id, saved.stopped!.at); this.tellStops(); }
    // one event for the version and for what it changes of the live status
    this.pictures.set(saved.id, this.picture(saved));
    this.d.emit(saved.id);
    return saved;
  }

  /** The list: the plans not archived, or the archived ones, or the trash; a query looks in the first two. */
  list(q: { archived?: boolean; trash?: boolean; query?: string } | void): PlanInfo[] {
    const words = (q?.query ?? '').toLowerCase().split(' ').filter(Boolean);
    const text = (m: Plan) => [m.title, m.idea ?? '', m.goal ?? '', m.why ?? '', m.project ?? '', ...m.constraints, ...m.links.map(l => l.ref), ...(m.plan?.steps ?? []).map(s => s.title)].join(' ').toLowerCase();
    const order = (i: PlanInfo) => (waitsForUser(i) ? 0 : ORDER.indexOf(i.state)), chats = this.d.chats.list();
    return [...this.maps.values()]
      .filter(m => q?.trash ? m.deletedAt !== undefined : m.deletedAt === undefined && (words.length ? words.every(w => text(m).includes(w)) : q?.archived ? m.state === 'archived' : m.state !== 'archived'))
      .map(m => this.info(m, chats)).sort((a, b) => order(a) - order(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  /** The map of the job a chat is on, when it has one. */
  ofChat(chatId: string): Plan | null {
    const mine = [...this.maps.values()].filter(m => m.owner?.chatId === chatId);
    return mine.find(m => m.stopped?.by !== 'replaced' && m.state !== 'archived') ?? mine[mine.length - 1] ?? null;
  }

  get(id: string): Plan | null { const m = this.maps.get(id); return m ? structuredClone(m) : null; }

  view(id: string, version?: number): PlanFull | null {
    const now = this.maps.get(id);
    if (!now) return null;
    const m = version === undefined || version === now.version ? now : this.d.store.version(id, version);
    if (!m) return null;
    const record = structuredClone(m), steps = stepViews(record.plan), history = this.d.store.history(id), chats = this.d.chats.list();
    // an earlier version is only what it was
    if (record.version !== now.version) return { record, info: { ...planInfo(record), can: [] }, steps, history, questions: [] };
    const live = this.live(record, chats);
    return { record, info: { ...planInfo(record), ...(live.map ? { live: live.map } : {}) }, steps: steps.map((b, i) => (live.boxes[i] ? { ...b, live: live.boxes[i] } : b)), history, questions: structuredClone(asksOf(record, chats)) };
  }

  /** A plan from an idea alone: no chat is started. */
  idea(a: { title: string; idea?: string; goal?: string; why?: string; project?: string; constraints?: readonly string[]; links?: readonly PlanLink[] }, by = 'user'): Plan {
    const line = (v: unknown, max: number, what: string): string => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (s.length > max) throw new Error(`${what}: al massimo ${max} caratteri`);
      return s;
    };
    const title = line(a?.title, PLAN_LIMITS.title, 'title').replace(/\s+/g, ' ');
    if (!title) throw new Error('title: scrivi l’idea in una riga');
    const idea = line(a.idea, PLAN_LIMITS.idea, 'idea'), goal = line(a.goal, PLAN_LIMITS.goal, 'goal'), why = line(a.why, PLAN_LIMITS.why, 'why'), project = line(a.project, PLAN_LIMITS.project, 'project'), now = this.now();
    const base = settle({ id: this.newId(), version: 0, title, ...(idea ? { idea } : {}), ...(goal ? { goal } : {}), ...(why ? { why } : {}), ...(project ? { project } : {}), constraints: [], links: [], createdAt: now, updatedAt: now, by, summary: '' });
    const made = this.put(this.withWords(base, { add: { constraints: a.constraints ?? [], links: a.links ?? [] } }), by);
    return this.clone(made);
  }

  /** The words of a plan changed by name: what is set is replaced, what is added is added (never twice), what is removed
   *  is the entry named; every other word stays. Throws when a value does not fit. */
  private withWords(m: Plan, c: Pick<PlanChange, 'set' | 'add' | 'remove'>): Plan {
    const one = (v: unknown, max: number, what: string): string => {
      const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
      if (!t) throw new Error(`${what}: serve un testo.`);
      if (t.length > max) throw new Error(`${what}: al massimo ${max} caratteri.`);
      return t;
    };
    const text = (key: 'idea' | 'goal' | 'why' | 'project', max: number, cur: Plan): Plan => {
      const v = c.set?.[key];
      if (v === undefined) return cur;
      if (v === null || v === '') { const { [key]: _x, ...rest } = cur; return rest as Plan; }
      return { ...cur, [key]: one(v, max, key) };
    };
    let out = m;
    if (c.set?.title !== undefined) out = { ...out, title: one(c.set.title, PLAN_LIMITS.title, 'title') };
    out = text('idea', PLAN_LIMITS.idea, out); out = text('goal', PLAN_LIMITS.goal, out); out = text('why', PLAN_LIMITS.why, out); out = text('project', PLAN_LIMITS.project, out);
    let constraints = c.set?.constraints ? c.set.constraints.map(x => one(x, PLAN_LIMITS.constraint, 'constraints')) : out.constraints;
    constraints = [...new Set([...constraints, ...(c.add?.constraints ?? []).map(x => one(x, PLAN_LIMITS.constraint, 'constraints'))])].filter(x => !(c.remove?.constraints ?? []).includes(x));
    if (constraints.length > PLAN_LIMITS.constraints) throw new Error(`constraints: al massimo ${PLAN_LIMITS.constraints}.`);
    const link = (l: PlanLink): PlanLink => ({ kind: (['file', 'link', 'plan', 'chat'] as const).includes(l.kind) ? l.kind : 'link', ref: one(l.ref, 500, 'links'), ...(l.label ? { label: one(l.label, 160, 'links') } : {}) });
    let links = c.set?.links ? c.set.links.map(link) : out.links;
    for (const l of (c.add?.links ?? []).map(link)) if (!links.some(x => x.ref === l.ref)) links = [...links, l];
    links = links.filter(l => !(c.remove?.links ?? []).includes(l.ref));
    if (links.length > PLAN_LIMITS.links) throw new Error(`links: al massimo ${PLAN_LIMITS.links}.`);
    return { ...out, constraints, links };
  }

  /** One save, by explicit operations. Everything is checked first and applied together, or nothing changes; what the save does not
   *  name stays as it was, so a partial save deletes nothing. Every real change is a version. */
  async change(id: string, c: PlanChange, by = 'user'): Promise<Plan> {
    const m = this.maps.get(id);
    if (!m) throw new Error('Questo piano non c’è.');
    if (m.deletedAt !== undefined) throw new Error('Il piano è nel cestino: ripristinalo prima di cambiarlo.');
    const words = c.set || c.add || c.remove ? this.withWords(m, c) : m;
    if (c.steps?.length) {
      const chat = this.ownerChat(m);
      // a live chat carries the plan: the steps change there, and the plan follows it
      if (chat && this.d.chats.planEdit) {
        applySteps(m.plan ?? { phase: 'asking', clarified: [], steps: [], at: 0 }, c.steps, this.now(), by === 'user' ? 'user' : 'strategist');
        if (words !== m) this.put(words, by);
        this.d.chats.planEdit(chat.id, c.steps, by === 'user' ? 'user' : 'strategist');
        this.sync(id, by);
        return this.clone(this.maps.get(id)!);
      }
      const plan = applySteps(m.plan ?? { phase: 'asking', clarified: [], steps: [], at: this.now() }, c.steps, this.now(), by === 'user' ? 'user' : 'strategist');
      return this.clone(this.put(settle({ ...words, plan }), by));
    }
    return this.clone(this.put(words, by));
  }

  /** Two plans in one (the first one stays, with the other's steps, answers, doubts, constraints, links and history of where it came
   *  from); the other goes to the trash, named in `from`, so nothing is lost. Both must have no chat at work. */
  async merge(baseId: string, otherId: string, by = 'user'): Promise<Plan> {
    const a = this.maps.get(baseId), b = this.maps.get(otherId);
    if (!a || !b || baseId === otherId) throw new Error('Servono due piani diversi.');
    if (a.deletedAt !== undefined || b.deletedAt !== undefined) throw new Error('Un piano nel cestino non si unisce: ripristinalo prima.');
    for (const p of [a, b]) if (this.busyChat(p)) throw new Error(`«${p.title}» ha una chat al lavoro: fermala o aspetta che finisca, poi unisci.`);
    const steps = b.plan?.steps ?? [];
    const plan = a.plan ?? { phase: 'asking' as const, clarified: [], steps: [], at: this.now() };
    const merged = steps.length ? applySteps(plan, [{ op: 'import', steps }], this.now()) : plan;
    const clarified = [...merged.clarified, ...(b.plan?.clarified ?? []).filter(x => !merged.clarified.some(y => y.q === x.q))].slice(0, 8);
    const doubts = [...(merged.doubts ?? []), ...(b.plan?.doubts ?? []).filter(x => !(merged.doubts ?? []).some(y => y.text === x.text))];
    const next = this.withWords(settle({ ...a, plan: { ...merged, clarified, ...(doubts.length ? { doubts } : {}) }, from: [...new Set([...(a.from ?? []), `${b.title} (${b.id})`, ...(b.from ?? [])])].slice(0, PLAN_LIMITS.from) }), { add: { constraints: b.constraints, links: b.links } });
    const done = this.put(next, by);
    this.put(settle({ ...b, deletedAt: this.now() }), by);
    return this.clone(done);
  }

  /** Some of a plan's steps go to a new plan (the numbers named); they leave the first one, which stays what it was for the rest. */
  async split(id: string, numbers: readonly number[], title: string, by = 'user'): Promise<Plan> {
    const m = this.maps.get(id);
    if (!m?.plan) throw new Error('Questo piano non ha passi da dividere.');
    if (this.busyChat(m)) throw new Error('Ha una chat al lavoro: fermala o aspetta che finisca, poi dividi.');
    const pick = [...new Set(numbers)].map(n => m.plan!.steps[n - 1]);
    if (!pick.length || pick.some(s => !s)) throw new Error('Dimmi quali passi (i numeri, da 1).');
    if (pick.some(s => s!.state !== 'todo')) throw new Error('Si dividono solo passi non ancora partiti: gli altri restano dove sono.');
    const ids = new Set(pick.map(s => s!.id));
    const made = this.idea({ title, ...(m.project ? { project: m.project } : {}), goal: m.goal ?? '', why: m.why ?? '', constraints: m.constraints, links: m.links }, by);
    const moved = pick.map(s => { const after = (s!.after ?? []).filter(x => ids.has(x)); const { after: _a, ...rest } = s!; return after.length ? { ...rest, after } : rest; });
    await this.change(made.id, { steps: [{ op: 'import', steps: moved as never }] }, by);
    await this.change(id, { steps: [...pick].map(s => ({ op: 'remove' as const, step: s!.id })) }, by);
    return this.clone(this.maps.get(made.id)!);
  }

  /** A chat of this plan is at work now: a plan is not merged or split under it. */
  private busyChat(m: Plan): boolean {
    const c = this.ownerChat(m);
    return !!c && !c.closedAt && (c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || !!c.queued);
  }

  /** The user's own «Elimina per sempre»: only a plan already in the trash. Never called by an agent. */
  forgetForever(id: string): void {
    const m = this.maps.get(id);
    if (!m) throw new Error('Questo piano non c’è.');
    if (m.deletedAt === undefined) throw new Error('Si elimina per sempre solo dal cestino: prima mettilo nel cestino.');
    this.d.store.forget?.(id);
    this.maps.delete(id);
    this.pictures.delete(id);
    this.d.emit(id);
  }

  /** One action on a map, for the user (IPC) or for the Orchestrator; refused when the map does not allow it now. */
  async act(id: string, action: PlanAction, a: { at?: number; text?: string; cwd?: string } = {}, by = 'user'): Promise<Plan> {
    const m = this.maps.get(id);
    if (!m) throw new Error('Questa mappa non c’è.');
    // the screen says it of every map it shows: only a finished one moves
    if (action === 'seen' && m.state !== 'finished') return this.clone(m);
    if (m.deletedAt !== undefined && action !== 'restore') throw new Error('Il piano è nel cestino: si può solo ripristinare.');
    if (!planActions(m).includes(action)) throw new Error(`Non si può ${ACTION_WORDS[action]}: la mappa è «${stateLine(m)}».`);
    // an open doubt holds the yes on every path; the chat checks it again (ADR 0344)
    const doubt = m.plan && (action === 'approve' || action === 'keep' || action === 'start') ? approvalGate(m.plan) : null;
    if (doubt) throw new Error(doubt);
    if (this.busy.has(id)) throw new Error('Un’azione su questa mappa è già in corso.');
    this.busy.add(id);
    try { await this.run(m, action, a, by); } finally { this.busy.delete(id); }
    log.info('plans', 'action on a plan', { data: { id, action, by: by === 'user' ? 'user' : 'orchestrator' } });
    return this.clone(this.maps.get(id)!);
  }

  private async run(m: Plan, action: PlanAction, a: { at?: number; text?: string; cwd?: string }, by: string): Promise<void> {
    const { chats } = this.d, chat = this.ownerChat(m);
    switch (action) {
      case 'approve': case 'keep': {
        if (!Number.isFinite(a.at)) throw new Error('at: la revisione del piano che hai visto');
        await chats.planDecide(this.needChat(chat).id, 'approve', a.at!, undefined, 'pc', action === 'keep');
        return this.sync(m.id, by);
      }
      case 'start':
        if (!m.owner) return this.begin(m, by, undefined, a.cwd);
        await chats.planStart(this.needChat(chat).id);
        return this.sync(m.id, by);
      case 'stop':
        if (chat) await chats.planStop(chat.id);
        this.sync(m.id, by);
        this.edit(m.id, by, x => (x.state === 'finished' || x.stopped ? x : settle({ ...x, stopped: { at: this.now(), by: 'user' } })));
        return;
      case 'resume':
        // its chat is gone, or works on another job now: the job goes on in a new one
        if (!chat) return this.begin(m, by, undefined, a.cwd);
        await chats.planResume(chat.id, a.cwd);
        this.memory.alive(chat.id);
        this.dying.delete(chat.id);
        this.sync(m.id, by);
        this.edit(m.id, by, x => { if (!x.stopped) return x; const { stopped: _s, ...rest } = x; return settle(rest); });
        return;
      case 'replan': {
        const text = (a.text ?? '').trim();
        if (!text || text.length > PLAN_LIMITS.change) throw new Error(`Scrivi cosa cambiare (al massimo ${PLAN_LIMITS.change} caratteri).`);
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
      case 'delete':
        // the trash only: nothing of it changes; a chat at work on it is stopped first, as for «Ferma»
        if (chat && !chat.closedAt) await chats.planStop(chat.id);
        this.edit(m.id, by, x => settle({ ...x, deletedAt: this.now() }));
        return;
      case 'restore':
        this.edit(m.id, by, x => { const { deletedAt: _d, ...rest } = x; return settle(rest); });
        return;
      case 'seen': {
        const now = this.now();
        this.edit(m.id, by, x => settle({ ...x, seenAt: x.seenAt ?? now, archivedAt: now }));
      }
    }
  }

  private async begin(m: Plan, by: string, change?: string, cwd?: string): Promise<void> {
    if (!this.d.startStrategist) throw new Error('Qui non si può avviare uno Strategist.');
    const chat = await this.d.startStrategist(structuredClone(m), change, by, cwd);
    // its own events linked it already (ChatSummary.planId); one that did not is linked here
    this.edit(m.id, by, x => (x.owner?.chatId === chat.id ? x : this.moved(x, chat)));
    this.sync(m.id, by);
  }

  /** The chat of the map's job, when it still is on that job. */
  private ownerChat(m: Plan): ChatSummary | null {
    const all = this.d.chats.list();
    let c = m.owner && m.stopped?.by !== 'replaced' ? all.find(x => x.id === m.owner!.chatId) : undefined;
    // the chat went on in another one: that one works now, and «Riprendi» goes there, never to a second Strategist
    for (let n = 0; c?.continuedBy && n < 20; n++) c = all.find(x => x.id === c!.continuedBy!.id) ?? c;
    return c && (m.owner!.task === 'chat' || taskOf(c) === m.owner!.task || !!c.continuedFrom) ? c : null;
  }
  private needChat(c: ChatSummary | null): ChatSummary { if (!c) throw new Error('La chat di questo lavoro non c’è più: riprendilo.'); return c; }

  private edit(id: string, by: string, fn: (m: Plan) => Plan): void { this.put(fn(this.maps.get(id)!), by); }
  /** The map read again from its chat, in the name of who acted. */
  private sync(id: string, by: string): void {
    const m = this.maps.get(id)!, c = this.ownerChat(m);
    if (c) this.put(this.followed(m, c), by, this.alone(c));
  }
  private clone(m: Plan): Plan { return structuredClone(m); }
}
