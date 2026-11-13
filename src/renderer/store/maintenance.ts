// The one-click «Manutenzione» (ADR 0132, 0153): the button's state (a pass or the invisible research running, its cost,
// the last one's end), read from main ('maintenance:status') and again on 'maintenance:changed'; one click
// ('maintenance:run'), «Ferma» ('maintenance:stop'); 'maintenance:done' brings the end notice
// (lib/maintenance-notice.ts). Used by components/brain-model/MaintenanceButton.tsx.
import { useEffect } from 'react';
import type { MaintenanceDone, MaintenanceStatus } from '@shared/maintenance-research';
import { announceMaintenanceDone } from '../lib/maintenance-notice';
import { sb } from '../sb';
import { createStore } from './createStore';
import { errText } from '../lib/ipc-error';

/** `justDone`: the end the button celebrates for a few seconds (null after) */
export const maintenance = createStore<{ status: MaintenanceStatus | null; error: string | null; justDone: MaintenanceDone | null }>({ status: null, error: null, justDone: null });
let started = false;
let doneTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshMaintenance(): Promise<void> {
  try { const status = await sb.invoke('maintenance:status', undefined); maintenance.set(s => ({ ...s, status })); }
  catch (e) { maintenance.set(s => ({ ...s, error: errText(e) })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('maintenance:changed', () => { void refreshMaintenance(); });
  sb.on('maintenance:done', d => {
    announceMaintenanceDone(d);
    maintenance.set(s => ({ ...s, justDone: d }));
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => { doneTimer = null; maintenance.set(s => ({ ...s, justDone: null })); }, 6000);
    void refreshMaintenance();
  });
}
export function useMaintenance() {
  useEffect(() => { start(); void refreshMaintenance(); }, []);
  return maintenance.use(s => s);
}

/** The click: the free cleanup, then the research in the background. An error text, or null. */
export async function runMaintenanceNow(): Promise<string | null> {
  start();
  // the button turns busy at once, before main answers
  maintenance.set(s => ({ ...s, error: null, status: s.status ? { ...s.status, running: true } : { running: true, research: null, last: null, canResearch: true } }));
  try { const status = await sb.invoke('maintenance:run', undefined); maintenance.set(s => ({ ...s, status })); return null; }
  catch (e) { const error = errText(e); maintenance.set(s => ({ ...s, error })); void refreshMaintenance(); return error; }
}
export async function stopMaintenance(): Promise<void> {
  try { const status = await sb.invoke('maintenance:stop', undefined); maintenance.set(s => ({ ...s, status })); } catch (e) { maintenance.set(s => ({ ...s, error: errText(e) })); }
}
