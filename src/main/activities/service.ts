// «Attività pianificate» (ADR 0374): the engine. It owns the catalog, the timer and the run of every activity.
// A RUN: the activity's reader gives what the source shows now (zero tokens) → selectNew keeps what is after the cursor and
// passes the filter → nothing left: the run ends «idle», no model → else the daily cap is checked (reached: «capped», the
// activity waits for tomorrow, the cursor stays so nothing is lost) → ONE triage pass (triage.ts, cheapest model, no tool)
// → proposals: ONE grouped news to the Orchestrator (`notify`), which asks the user Sì/No one at a time; none: «quiet».
// Rules: the next run time is saved BEFORE the run starts (a crash never repeats it, nothing retries in a loop: a failed
// run waits for its next slot); a failed read or triage keeps the cursor, so the items come back next time; an activity
// runs one at a time; the timer only fires while the app is open (no catch-up burst after a long sleep: an overdue
// activity runs once). The model, the readers, the Orchestrator and the clock are injected: the unit tests use fakes.
// Used by ipc-handlers/activities.ts and (the tools part) appctl/activities.ts; wiring: see «Integration» in docs/tasks.
import { timersFor } from '../timers';
import { log, errText } from '../log';
import {
  ACTIVITIES_MAX, ACTIVITY_SOURCE_NAME, activityTemplates, clipForTriage, dayKey, describeSchedule, nextRunAt, selectNew, sumCost, triageToday, trimHistory, validateActivityInput,
  type ActivitiesState, type ActivityProposal, type ActivityResult, type ActivityRun, type ActivitySource, type ActivitySourceReader, type ActivityUsage, type ActivityView, type Activity,
} from '../../shared/activities';
import { ActivitiesStore, type ActivitiesSaved } from './store';
import { parseProposals, triagePrompt, type ActivityAi } from './triage';

const { setInterval, clearInterval } = timersFor('activities/service');
const TICK_MS = 60_000;

/** What the Orchestrator is told when a run proposes something (one news per run, the proposals grouped). */
export interface ActivityNews { activityId: string; activityName: string; source: ActivitySource; proposals: ActivityProposal[]; /** the text for the Orchestrator, in Italian */ text: string }

export interface ActivitiesDeps {
  /** userData/activities.json */
  file: string;
  /** the reader of a source (null/undefined = not connected: the run ends as an error) */
  reader: (source: ActivitySource) => ActivitySourceReader | null | undefined;
  /** the hidden no-tool pass on the cheapest model */
  ai: ActivityAi;
  /** one grouped news to the Orchestrator (OrchestratorWake): it asks the user Sì/No, one at a time */
  notify: (news: ActivityNews) => void;
  /** the whole state after every change and at every run's end (event 'activities:changed') */
  emit: (s: ActivitiesState) => void;
  /** the app has its own Gmail connector */
  gmailConnector?: () => boolean;
  now?: () => number;
  newId?: () => string;
  /** a random word for the data fence of the triage prompt */
  fence?: () => string;
}

const dayStart = (at: number, plusDays = 0): number => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime(); };
const sumOrNull = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export class ActivitiesService {
  private s: ActivitiesSaved;
  private readonly store: ActivitiesStore;
  private readonly running = new Set<string>();
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** activities whose last read used the model (Gmail without a connector) */
  private readonly modelRead = new Set<string>();

  constructor(private readonly d: ActivitiesDeps) {
    this.now = d.now ?? Date.now;
    this.store = new ActivitiesStore(d.file);
    this.s = this.store.load();
  }

  // ---- state ----------------------------------------------------------------------------------------------------------

  state(): ActivitiesState {
    const now = this.now();
    return { activities: this.s.activities.map(a => this.view(a, now)), paused: this.s.paused, gmailConnector: this.d.gmailConnector?.() ?? false, templates: activityTemplates() };
  }

  private view(a: Activity, now: number): ActivityView {
    const runs = this.s.history[a.id] ?? [];
    const today = dayKey(now);
    const todayRuns = runs.filter(r => dayKey(r.at) === today);
    const running = this.running.has(a.id);
    return {
      ...a, scheduleText: describeSchedule(a.schedule), lastRun: runs[0] ?? null,
      nextAt: a.enabled && !this.s.paused && !running ? this.s.nextAt[a.id] ?? null : null, running,
      todayTriage: triageToday(runs, now), todayCostUsd: sumCost(todayRuns), usesModelToRead: this.modelRead.has(a.id),
    };
  }

  private commit(): ActivitiesState {
    this.store.save(this.s);
    const st = this.state();
    try { this.d.emit(st); } catch (e) { log.warn('activities', 'state listener failed', { cause: errText(e), hint: 'the page may show an old state until the next change' }); }
    return st;
  }

  private find(idOrName: string): Activity | undefined {
    return this.s.activities.find(a => a.id === idOrName) ?? this.s.activities.find(a => a.name.toLowerCase() === idOrName.trim().toLowerCase());
  }

  history(id: string): ActivityRun[] {
    const a = this.find(id);
    return a ? [...(this.s.history[a.id] ?? [])] : [];
  }

  // ---- catalog --------------------------------------------------------------------------------------------------------

  /** Creates (no id) or replaces (id) an activity; a wrong field is an error in the user's words. */
  save(a: { id?: string; input: unknown }): ActivityResult {
    const old = a.id ? this.find(a.id) : undefined;
    if (a.id && !old) return { ok: false, error: 'attività non trovata' };
    if (!old && this.s.activities.length >= ACTIVITIES_MAX) return { ok: false, error: `al massimo ${ACTIVITIES_MAX} attività` };
    const v = validateActivityInput(a.input, old);
    if (!v.ok) return { ok: false, error: v.errors.join(' · ') };
    const now = this.now();
    const schedChanged = !!old && (JSON.stringify(old.schedule) !== JSON.stringify(v.value.schedule) || old.source !== v.value.source);
    const next: Activity = old ? { ...old, ...v.value, updatedAt: now } : { ...v.value, id: (this.d.newId ?? (() => globalThis.crypto.randomUUID()))(), createdAt: now, updatedAt: now };
    this.s.activities = old ? this.s.activities.map(x => (x.id === old.id ? next : x)) : [...this.s.activities, next];
    if (old && old.source !== next.source) this.s.cursors[next.id] = { at: 0, keys: [] };   // another source: the old cursor means nothing
    this.s.cursors[next.id] ??= { at: 0, keys: [] };
    this.s.history[next.id] ??= [];
    if (!next.enabled) this.s.nextAt[next.id] = null;
    else if (!old?.enabled || schedChanged) this.s.nextAt[next.id] = nextRunAt(next.schedule, null, now);
    return { ok: true, id: next.id, state: this.commit() };
  }

  enable(a: { id: string; on: boolean }): ActivityResult {
    const act = this.find(a.id);
    if (!act) return { ok: false, error: 'attività non trovata' };
    if (act.enabled !== a.on) {
      this.s.activities = this.s.activities.map(x => (x.id === act.id ? { ...x, enabled: a.on, updatedAt: this.now() } : x));
      this.s.nextAt[act.id] = a.on ? nextRunAt(act.schedule, null, this.now()) : null;
    }
    return { ok: true, id: act.id, state: this.commit() };
  }

  remove(a: { id: string }): ActivityResult {
    const act = this.find(a.id);
    if (!act) return { ok: false, error: 'attività non trovata' };
    this.s.activities = this.s.activities.filter(x => x.id !== act.id);
    delete this.s.cursors[act.id]; delete this.s.nextAt[act.id]; delete this.s.history[act.id];
    this.modelRead.delete(act.id);
    return { ok: true, id: act.id, state: this.commit() };
  }

  pause(a: { paused: boolean }): ActivitiesState {
    this.s.paused = a.paused;
    if (!a.paused) {   // resuming: what came due meanwhile runs once at the next tick, never a burst
      const now = this.now();
      for (const x of this.s.activities) if (x.enabled && (this.s.nextAt[x.id] ?? Infinity) < now) this.s.nextAt[x.id] = nextRunAt(x.schedule, null, now);
    }
    return this.commit();
  }

  // ---- timer ----------------------------------------------------------------------------------------------------------

  /** Starts the minute timer (only while the app is open). The integrator may call `tick()` from the app's own minute tick instead. */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs every enabled activity that is due (the global pause stops it). Returns when those runs ended. */
  async tick(): Promise<void> {
    if (this.stopped || this.s.paused) return;
    const now = this.now();
    const due = this.s.activities.filter(a => a.enabled && !this.running.has(a.id) && (this.s.nextAt[a.id] ?? Infinity) <= now);
    await Promise.all(due.map(a => this.runNow(a.id, 'timer').catch(e => log.warn('activities', 'run failed', { cause: errText(e), hint: 'the run is recorded as an error in the activity history' }))));
  }

  // ---- run ------------------------------------------------------------------------------------------------------------

  /** «Esegui ora»: one run, counted against the daily cap; a run already going is not started twice. */
  async run(a: { id: string }): Promise<ActivityResult> {
    const act = this.find(a.id);
    if (!act) return { ok: false, error: 'attività non trovata' };
    if (this.running.has(act.id)) return { ok: false, error: 'questa attività sta già girando' };
    const run = await this.runNow(act.id, 'manual');
    return { ok: true, id: act.id, state: this.state(), run };
  }

  private async runNow(id: string, trigger: ActivityRun['trigger']): Promise<ActivityRun> {
    const act = this.s.activities.find(a => a.id === id)!;
    const t0 = this.now();
    // the next slot is saved BEFORE the run: a crash in the middle never repeats it, a failure never loops
    this.s.nextAt[id] = act.enabled ? nextRunAt(act.schedule, t0, t0) : null;
    this.running.add(id);
    this.commit();
    let run: ActivityRun;
    try { run = await this.execute(act, t0, trigger); }
    catch (e) { run = this.record(act, t0, trigger, { status: 'error', error: `errore inatteso: ${errText(e)}` }); log.warn('activities', 'run crashed', { cause: errText(e), hint: 'recorded as an error in the history; the next run is already planned' }); }
    this.running.delete(id);
    if (this.s.activities.some(a => a.id === id)) {   // not deleted meanwhile
      this.s.history[id] = trimHistory([run, ...(this.s.history[id] ?? [])]);
      this.commit();
    }
    return run;
  }

  private record(act: Activity, t0: number, trigger: ActivityRun['trigger'], p: Partial<ActivityRun> & Pick<ActivityRun, 'status'>): ActivityRun {
    return {
      id: (this.d.newId ?? (() => globalThis.crypto.randomUUID()))(), activityId: act.id, at: t0, durationMs: Math.max(0, this.now() - t0), trigger,
      read: 0, kept: 0, proposals: 0, usedModel: false, tokens: null, costUsd: null, model: null, ...p,
    };
  }

  private async execute(act: Activity, t0: number, trigger: ActivityRun['trigger']): Promise<ActivityRun> {
    const reader = this.d.reader(act.source);
    if (!reader) return this.record(act, t0, trigger, { status: 'error', error: `${ACTIVITY_SOURCE_NAME[act.source]} non è collegato` });
    const cursor = this.s.cursors[act.id] ?? { at: 0, keys: [] };
    let read;
    try { read = await reader.read(act, cursor, t0); }
    catch (e) { return this.record(act, t0, trigger, { status: 'error', error: `lettura non riuscita: ${errText(e)}` }); }
    const usage: ActivityUsage | undefined = read.usage;
    this.modelRead[usage ? 'add' : 'delete'](act.id);
    const readUse = usage ? { usedModel: true, tokens: usage.tokens, costUsd: usage.costUsd, model: usage.model } : {};
    if (read.error) return this.record(act, t0, trigger, { status: 'error', error: read.error, read: read.items.length, ...readUse });
    const sel = selectNew(read.items, cursor, act.filter);
    const base = { read: read.items.length, kept: sel.kept.length, ...readUse };
    if (!sel.kept.length) {   // nothing new and relevant: zero model calls
      this.s.cursors[act.id] = sel.cursor;
      return this.record(act, t0, trigger, { status: 'idle', ...base });
    }
    const used = triageToday(this.s.history[act.id] ?? [], t0);
    if (used >= act.dailyCap) {   // the cursor stays: what is new waits for tomorrow, nothing is lost
      this.s.nextAt[act.id] = act.enabled ? nextRunAt(act.schedule, null, dayStart(t0, 1)) : null;
      return this.record(act, t0, trigger, { status: 'capped', ...base, error: `Tetto giornaliero raggiunto (${used} passaggi su ${act.dailyCap}): riprende domani.` });
    }
    const clip = clipForTriage(sel.kept);
    const shown = sel.kept.filter(i => clip.items.some(c => c.key === i.key));
    const ai = await this.d.ai(triagePrompt(act, clip.items, (this.d.fence ?? (() => `FENCE-${globalThis.crypto.randomUUID()}`))()));
    if (!ai.ok) return this.record(act, t0, trigger, { status: 'error', ...base, usedModel: true, error: `triage non riuscito: ${ai.error}` });
    const tokens = sumOrNull(usage?.tokens ?? null, ai.tokens), costUsd = sumOrNull(usage?.costUsd ?? null, ai.costUsd);
    const used2 = { ...base, usedModel: true, tokens, costUsd, model: ai.model ?? usage?.model ?? null };
    let proposals: ActivityProposal[];
    try { proposals = parseProposals(ai.text, shown); }
    catch (e) { return this.record(act, t0, trigger, { status: 'error', ...used2, error: `triage non riuscito: ${errText(e)}` }); }
    this.s.cursors[act.id] = sel.cursor;   // the triage looked at it: not looked at again
    if (!proposals.length) return this.record(act, t0, trigger, { status: 'quiet', ...used2 });
    try { this.d.notify({ activityId: act.id, activityName: act.name, source: act.source, proposals, text: newsText(act, proposals, trigger) }); }
    catch (e) { return this.record(act, t0, trigger, { status: 'error', ...used2, proposals: proposals.length, error: `proposte non consegnate all'Orchestrator: ${errText(e)}` }); }
    return this.record(act, t0, trigger, { status: 'proposed', ...used2, proposals: proposals.length });
  }
}

/** The grouped news the Orchestrator reads: it asks the user Sì/No for each proposal, one at a time. */
export function newsText(act: Pick<Activity, 'name' | 'source'>, proposals: readonly ActivityProposal[], trigger: ActivityRun['trigger'] = 'timer'): string {
  const lines = proposals.map((p, i) => `${i + 1}. ${p.title}: ${p.action}${p.url ? ` (${p.url})` : ''}`);
  return [`Attività «${act.name}» (${ACTIVITY_SOURCE_NAME[act.source]}${trigger === 'manual' ? ', lanciata a mano' : ''}): ${proposals.length === 1 ? 'una proposta' : `${proposals.length} proposte`}. Chiedi a Davide Sì/No, una alla volta; non eseguire nulla senza il suo ok.`, ...lines].join('\n');
}

export type ActivitiesApi = Pick<ActivitiesService, 'state' | 'save' | 'enable' | 'remove' | 'pause' | 'run' | 'history'>;
