// «Attività pianificate» (ADR 0374): the IPC area of the scheduled activities page, which replaces «Task». One area of
// the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape here first, then
// both sides). The shapes and rules are in src/shared/activities.ts; handlers: src/main/ipc-handlers/activities.ts; the
// event 'activities:changed' (in contract.ts' EventMap) carries the whole state after every change and every run's end.
import type { ActivitiesState, ActivityInput, ActivityResult, ActivityRun } from '../activities';

/** renderer → main, activities: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface ActivitiesInvokeMap {
  /** the catalog with each activity's last run, next time, today's triage count and cost, the global pause */
  'activities:state': [void, ActivitiesState];
  /** creates an activity (no `id`) or replaces the one with `id` by `input` (validated by validateActivityInput: a wrong
   *  field is an error, never fixed silently); a new one starts off unless `input.enabled` says otherwise */
  'activities:save': [{ id?: string; input: ActivityInput }, ActivityResult];
  /** the activity's switch */
  'activities:enable': [{ id: string; on: boolean }, ActivityResult];
  /** deletes the activity with its cursor and history */
  'activities:remove': [{ id: string }, ActivityResult];
  /** the global pause: nothing runs on the timer while paused, «Esegui ora» still works */
  'activities:pause': [{ paused: boolean }, ActivitiesState];
  /** «Esegui ora»: one run now, counted against the daily cap; the result carries the finished run */
  'activities:run': [{ id: string }, ActivityResult];
  /** the last ACTIVITY_HISTORY_MAX runs of an activity, newest first */
  'activities:history': [{ id: string }, ActivityRun[]];
}
