// Scheduled routines (ADR 0281; owner 2026-11-13: «pianificarne una tipo i pianificati di Claude direttamente dentro
// l'app»): the shapes shared by main (main/schedules/service.ts), the Routine page («Pianificate») and the
// Orchestrator's app_schedule tool. A scheduled routine is a request in the user's words plus when to make it: at its
// time the app hands the request to the Orchestrator, which does it with the agents like any other request. `nextDue`
// is the whole calendar: a pure function of the rule and a moment, in the PC's local time.

export type ScheduleWhen =
  /** only when the user presses «Esegui ora» */
  | { kind: 'manual' }
  /** every N minutes from the last run (15 minutes to 7 days) */
  | { kind: 'every'; minutes: number }
  /** at a local time «HH:MM» on the given week days (0 = Sunday … 6 = Saturday); no days = every day */
  | { kind: 'daily'; time: string; days?: number[] }
  /** once, at a moment (ms) */
  | { kind: 'once'; at: number };

export interface ScheduledRun {
  at: number;
  ok: boolean;
  /** the Orchestrator chat that received the request */
  chatId?: string;
  /** why it was not handed over (no Orchestrator open, its engine off) */
  error?: string;
  /** started by «Esegui ora» rather than by its time */
  manual?: boolean;
  /** its time passed while the app was closed: run once at the first chance, `late` minutes after */
  late?: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  /** the request, in the user's words: what the Orchestrator is asked at each run */
  prompt: string;
  when: ScheduleWhen;
  on: boolean;
  createdAt: number;
  /** who wrote it: the user in the page, or the Orchestrator when the user asked it to */
  by: 'user' | 'orchestrator';
  /** when it runs next (ms), or null (manual, paused, a «once» already run) */
  nextAt: number | null;
  /** its last runs, newest first (at most SCHEDULE_RUNS_KEPT) */
  runs: ScheduledRun[];
}

export interface SchedulesState { tasks: ScheduledTask[] }

export type ScheduleEdit =
  | { op: 'create'; name: string; prompt: string; when: ScheduleWhen }
  | { op: 'update'; id: string; name?: string; prompt?: string; when?: ScheduleWhen; on?: boolean }
  | { op: 'delete'; id: string }
  | { op: 'run'; id: string };

export const SCHEDULE_MAX = 50;
export const SCHEDULE_RUNS_KEPT = 20;
export const SCHEDULE_EVERY_MIN = 15;
export const SCHEDULE_EVERY_MAX = 7 * 24 * 60;
export const SCHEDULE_NAME_MAX = 80;
export const SCHEDULE_PROMPT_MAX = 4000;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A rule from outside (the page, a tool call), checked and cleaned; throws with what is wrong. */
export function parseWhen(raw: unknown, now: number): ScheduleWhen {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (o.kind === 'manual') return { kind: 'manual' };
  if (o.kind === 'every') {
    const m = Math.round(Number(o.minutes));
    if (!Number.isFinite(m) || m < SCHEDULE_EVERY_MIN || m > SCHEDULE_EVERY_MAX) throw new Error(`every: minutes between ${SCHEDULE_EVERY_MIN} and ${SCHEDULE_EVERY_MAX}`);
    return { kind: 'every', minutes: m };
  }
  if (o.kind === 'daily') {
    if (typeof o.time !== 'string' || !TIME.test(o.time)) throw new Error('daily: time as "HH:MM" (24 hours, local time)');
    if (Array.isArray(o.days) && o.days.some(d => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('daily: days as numbers 0 (Sunday) to 6 (Saturday)');
    const days = Array.isArray(o.days) ? [...new Set(o.days as number[])].sort((a, b) => a - b) : [];
    return { kind: 'daily', time: o.time, ...(days.length && days.length < 7 ? { days } : {}) };
  }
  if (o.kind === 'once') {
    const at = typeof o.at === 'string' ? Date.parse(o.at) : Number(o.at);
    if (!Number.isFinite(at)) throw new Error('once: at as a time in ms or an ISO date-time');
    if (at <= now) throw new Error('once: the moment is in the past');
    return { kind: 'once', at };
  }
  throw new Error('when.kind: manual, every, daily or once');
}

/** When a rule fires next, strictly after `after` (`last`: its last run, for «every»); null when it never does by itself. */
export function nextDue(when: ScheduleWhen, after: number, last?: number): number | null {
  if (when.kind === 'manual') return null;
  if (when.kind === 'once') return when.at > after ? when.at : null;
  if (when.kind === 'every') return Math.max(after + 1, (last ?? after) + when.minutes * 60_000);
  const m = TIME.exec(when.time);
  if (!m) return null;
  const from = new Date(after);
  // the next 8 local days cover every week-day rule (the Date constructor follows the PC's clock changes)
  for (let d = 0; d <= 8; d++) {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, Number(m[1]), Number(m[2]), 0, 0);
    if (at.getTime() > after && (!when.days?.length || when.days.includes(at.getDay()))) return at.getTime();
  }
  return null;
}

/** An edit from outside (the page over IPC, a tool call), checked field by field; the service cleans the texts. */
export function parseScheduleEdit(raw: unknown, now: number): ScheduleEdit {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const id = typeof o.id === 'string' ? o.id.slice(0, 40) : '';
  if (o.op === 'create') return { op: 'create', name: typeof o.name === 'string' ? o.name : '', prompt: typeof o.prompt === 'string' ? o.prompt : '', when: parseWhen(o.when, now) };
  if (o.op === 'update') return { op: 'update', id, ...(typeof o.name === 'string' ? { name: o.name } : {}), ...(typeof o.prompt === 'string' ? { prompt: o.prompt } : {}), ...(o.when !== undefined ? { when: parseWhen(o.when, now) } : {}), ...(typeof o.on === 'boolean' ? { on: o.on } : {}) };
  if (o.op === 'delete') return { op: 'delete', id };
  if (o.op === 'run') return { op: 'run', id };
  throw new Error('op: create, update, delete or run');
}
