// The renderer's state of the «Attività pianificate» (ADR 0374): main pushes the whole ActivitiesState on 'activities:changed'
// (after every change and every run's end); this store starts itself on the first use of the page, loads 'activities:state'
// once and keeps the last value. Actions: save, switch, remove, global pause, «Esegui ora» and a activity's history; each
// says its outcome with a toast and returns whether it worked (the form stays open on an error). Used by
// brain/pages/Activities.tsx.
import type { ActivitiesState, ActivityInput, ActivityResult, ActivityRun } from '@shared/activities';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';
import { errText } from '../lib/ipc-error';

export const activities = createStore<ActivitiesState | null>(null);

let listening = false;
let loading = false;
function start(): void {
  if (activities.get() || loading) return;
  try {
    if (!listening) { window.sb.on('activities:changed', s => activities.set(s)); listening = true; }
    loading = true;
    void window.sb.invoke('activities:state', undefined).then(s => { activities.set(x => x ?? s); }, e => toast(`${t('activities.runFailed', { error: errText(e) })}`, 'err')).finally(() => { loading = false; });
  } catch { /* no bridge (brain test route) */ }
}

export function useActivities<T>(sel: (s: ActivitiesState | null) => T): T {
  start();
  return activities.use(sel);
}

/** A result of the channels that answer ActivityResult: the new state goes in the store; an error is said. */
function take(r: ActivityResult, okText?: string): boolean {
  if (!r.ok) { toast(t('activities.runFailed', { error: r.error }), 'err'); return false; }
  activities.set(r.state);
  if (okText) toast(okText, 'ok');
  return true;
}

async function call(f: () => Promise<ActivityResult>, okText?: string): Promise<boolean> {
  try { return take(await f(), okText); } catch (e) { toast(t('activities.runFailed', { error: errText(e) }), 'err'); return false; }
}

export const saveActivity = (input: ActivityInput, id?: string): Promise<boolean> =>
  call(() => window.sb.invoke('activities:save', id ? { id, input } : { input }), t('activities.saved'));
export const setActivityOn = (id: string, on: boolean): Promise<boolean> => call(() => window.sb.invoke('activities:enable', { id, on }));
export const removeActivity = (id: string): Promise<boolean> => call(() => window.sb.invoke('activities:remove', { id }), t('activities.removed'));
export const runActivity = (id: string, name: string): Promise<boolean> => call(() => window.sb.invoke('activities:run', { id }), t('activities.runDone', { name }));

export async function setPaused(paused: boolean): Promise<void> {
  try { activities.set(await window.sb.invoke('activities:pause', { paused })); toast(paused ? t('activities.paused') : t('activities.resumed'), 'ok'); }
  catch (e) { toast(t('activities.runFailed', { error: errText(e) }), 'err'); }
}

/** The last runs of one activity, newest first; [] when main cannot say. */
export async function activityHistory(id: string): Promise<ActivityRun[]> {
  try { return await window.sb.invoke('activities:history', { id }); } catch { return []; }
}
