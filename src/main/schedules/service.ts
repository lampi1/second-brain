// Scheduled routines in main (ADR 0281): the user's planned requests and their clock. A scheduled routine is a request
// in the user's words and a rule (every N minutes, at a time on some week days, once, or only by hand). `tick()` is
// called by the app's minute timer (wiring.ts): every routine whose time has come is handed to the Orchestrator through
// `run` (one app line into its conversation: it then works with the agents as for any request) and its next time is
// computed from now. A time that passed while the app was closed runs once at the first tick (never once per missed
// time), and says how late it is. Nothing here executes a routine package: the terminal stays the only executor of
// those (ADR 0179). The list is one JSON file in userData, written on every change. Edited by the Routine page (IPC
// schedules:*) and by the Orchestrator's app_schedule tool (appctl/schedules.ts); tests: test/unit/schedules.test.ts.
import { randomUUID } from 'node:crypto';
import { readLocal, writeLocal } from '../agents/local-store';
import { errText, log } from '../log';
import {
  SCHEDULE_MAX, SCHEDULE_NAME_MAX, SCHEDULE_PROMPT_MAX, SCHEDULE_RUNS_KEPT, nextDue, parseWhen,
  type ScheduleEdit, type ScheduledRun, type ScheduledTask, type SchedulesState, type ScheduleWhen,
} from '../../shared/schedules';

export interface SchedulesDeps {
  file: string;
  /** hands the request to the Orchestrator; resolves with the chat that took it, rejects with why it could not */
  run(task: ScheduledTask, late: number): Promise<{ chatId: string }>;
  changed(state: SchedulesState): void;
  now?(): number;
}

const LATE_MIN = 5;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The rule in plain English, for the line the Orchestrator reads. */
export function whenWords(w: ScheduleWhen): string {
  if (w.kind === 'manual') return 'run by hand';
  if (w.kind === 'once') return 'once';
  if (w.kind === 'every') return w.minutes % 1440 === 0 ? `every ${w.minutes / 1440} day(s)` : w.minutes % 60 === 0 ? `every ${w.minutes / 60} hour(s)` : `every ${w.minutes} minutes`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${w.days?.length ? w.days.map(d => names[d]).join(', ') : 'every day'} at ${w.time}`;
}

/** The app line the Orchestrator receives: whose request it is, then the request itself, unchanged. */
export function scheduledText(task: Pick<ScheduledTask, 'name' | 'prompt' | 'when'> & { by?: ScheduledTask['by'] }, late: number): string {
  return `[scheduled routine «${task.name}» · ${whenWords(task.when)}${late >= LATE_MIN ? ` · ${late} min late: the app was closed at its time` : ''}] ${task.by === 'orchestrator' ? 'You planned this request with app_schedule, for the user, to be made at this time: do it now and report the result here as usual. It is the app\'s line, not a new message of the user.' : 'The user planned this request in the app (Routine → Pianificate) to be made at this time. It is their own request, written in advance: do it now as if they had just asked, without asking them to confirm it, and report the result here as usual.'}\n\n${task.prompt}`;
}

export class SchedulesService {
  private tasks: ScheduledTask[] = [];
  private readonly busy = new Set<string>();
  constructor(private readonly d: SchedulesDeps) {
    try {
      const saved = readLocal(d.file);
      if (Array.isArray(saved)) this.tasks = (saved as ScheduledTask[]).filter(t => t && typeof t.id === 'string' && typeof t.prompt === 'string' && t.when && typeof t.when === 'object').map(t => ({ ...t, runs: Array.isArray(t.runs) ? t.runs : [] }));
    } catch (e) { log.warn('schedules', 'scheduled routines unreadable', { cause: errText(e), hint: 'the list starts empty; the file is left as it is until the next change' }); }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private save(): void {
    try { writeLocal(this.d.file, this.tasks); } catch (e) { log.warn('schedules', 'scheduled routines not saved', { cause: errText(e), hint: 'the next change retries' }); }
    this.d.changed(this.state());
  }
  state(): SchedulesState { return { tasks: this.tasks.map(t => ({ ...t, runs: [...t.runs] })) }; }
  private need(id: string): ScheduledTask {
    const t = this.tasks.find(x => x.id === id);
    if (!t) throw new Error('routine pianificata sconosciuta');
    return t;
  }

  /** Create, change (pause and resume too), delete, or run now. */
  edit(e: ScheduleEdit, by: ScheduledTask['by'] = 'user'): SchedulesState {
    const now = this.now();
    if (e.op === 'create') {
      if (this.tasks.length >= SCHEDULE_MAX) throw new Error(`Al massimo ${SCHEDULE_MAX} routine pianificate: eliminane una prima.`);
      const name = text(e.name, SCHEDULE_NAME_MAX), prompt = text(e.prompt, SCHEDULE_PROMPT_MAX);
      if (!prompt) throw new Error('Serve la richiesta: cosa deve fare l\'Orchestrator a ogni esecuzione.');
      const when = parseWhen(e.when, now);
      this.tasks = [...this.tasks, { id: randomUUID().slice(0, 8), name: name || prompt.split('\n')[0]!.slice(0, 60), prompt, when, on: true, createdAt: now, by, nextAt: nextDue(when, now), runs: [] }];
    } else if (e.op === 'update') {
      const t = this.need(e.id);
      const name = e.name !== undefined ? text(e.name, SCHEDULE_NAME_MAX) : t.name, prompt = e.prompt !== undefined ? text(e.prompt, SCHEDULE_PROMPT_MAX) : t.prompt;
      if (!name || !prompt) throw new Error('Nome e richiesta non possono essere vuoti.');
      const when = e.when !== undefined ? parseWhen(e.when, now) : t.when;
      const on = typeof e.on === 'boolean' ? e.on : t.on;
      // a changed rule or a resume counts from now: a paused routine never fires for the time it was paused
      const again = e.when !== undefined || on && !t.on;
      Object.assign(t, { name, prompt, when, on, nextAt: !on ? null : again ? nextDue(when, now) : t.nextAt });
    } else if (e.op === 'delete') {
      this.need(e.id);
      this.tasks = this.tasks.filter(t => t.id !== e.id);
    } else if (e.op === 'run') {
      const t = this.need(e.id);
      if (this.busy.has(t.id)) throw new Error('Questa routine sta già partendo.');
      void this.fire(t, true);
    }
    this.save();
    return this.state();
  }

  /** The minute tick: every routine whose time has come goes to the Orchestrator, once. */
  tick(): void {
    const now = this.now();
    for (const t of this.tasks) if (t.on && t.nextAt !== null && t.nextAt <= now) void this.fire(t, false);
  }

  private async fire(t: ScheduledTask, manual: boolean): Promise<void> {
    if (this.busy.has(t.id)) return;
    this.busy.add(t.id);
    const at = this.now();
    const late = manual || t.nextAt === null ? 0 : Math.max(0, Math.round((at - t.nextAt) / 60_000));
    // the next time is set before the hand-over: a slow or failed one never fires twice for the same time
    if (!manual) {
      t.nextAt = nextDue(t.when, at, at);
      if (t.when.kind === 'once') t.on = false;
      this.save();
    }
    let run: ScheduledRun;
    try {
      const r = await this.d.run({ ...t }, late);
      run = { at, ok: true, chatId: r.chatId, ...(manual ? { manual: true } : {}), ...(late >= LATE_MIN ? { late } : {}) };
    } catch (e) {
      run = { at, ok: false, error: errText(e).slice(0, 200), ...(manual ? { manual: true } : {}), ...(late >= LATE_MIN ? { late } : {}) };
      log.warn('schedules', 'scheduled routine not handed to the Orchestrator', { cause: errText(e), hint: 'open an Orchestrator and press «Esegui ora», or wait for its next time', data: { routine: t.id } });
    } finally { this.busy.delete(t.id); }
    // deleted while it ran: nothing to record
    const still = this.tasks.find(x => x.id === t.id);
    if (!still) return;
    still.runs = [run, ...still.runs].slice(0, SCHEDULE_RUNS_KEPT);
    this.save();
  }
}
