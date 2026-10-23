// The maintenance with research and «Idee dell'app» (ADR 0132): the dialog's data (engines, the prompt the user last ran,
// the fixed frame, the estimate, the research running now or the last one) and the app ideas, read from main
// ('maintenance:setup', 'maintenance:ideas') and both read again on 'maintenance:changed'. Used by
// components/brain-model/MaintenanceButton.tsx and AppIdeasTab.tsx.
import { useEffect } from 'react';
import type { AppIdeasState, MaintenanceSetup, ResearchOptions } from '@shared/maintenance-research';
import { sb } from '../sb';
import { createStore } from './createStore';

export const maintenance = createStore<{ setup: MaintenanceSetup | null; ideas: AppIdeasState | null; error: string | null }>({ setup: null, ideas: null, error: null });
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
let started = false;

export async function refreshSetup(): Promise<void> {
  try { const setup = await sb.invoke('maintenance:setup', undefined); maintenance.set(s => ({ ...s, setup, error: null })); }
  catch (e) { maintenance.set(s => ({ ...s, error: errText(e) })); }
}
export async function refreshIdeas(): Promise<void> {
  try { const ideas = await sb.invoke('maintenance:ideas', undefined); maintenance.set(s => ({ ...s, ideas })); }
  catch (e) { maintenance.set(s => ({ ...s, error: errText(e) })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('maintenance:changed', () => { void refreshSetup(); if (maintenance.get().ideas) void refreshIdeas(); });
  sb.on('chat:updated', c => { if (c.isOrchestrator && maintenance.get().ideas) void refreshIdeas(); });
}
/** The dialog's data, read when `open` turns true. */
export function useMaintenance(open = true) {
  useEffect(() => { start(); if (open) void refreshSetup(); }, [open]);
  return maintenance.use(s => s);
}
export function useAppIdeas() {
  useEffect(() => { start(); void refreshIdeas(); }, []);
  return maintenance.use(s => s.ideas);
}

/** Starts the research (after the free cleanup): an error text, or null. */
export async function startResearch(o: ResearchOptions): Promise<string | null> {
  try { await sb.invoke('maintenance:research', o); await refreshSetup(); return null; } catch (e) { return errText(e); }
}
export async function stopResearch(): Promise<void> {
  try { const setup = await sb.invoke('maintenance:stop', undefined); maintenance.set(s => ({ ...s, setup })); } catch (e) { maintenance.set(s => ({ ...s, error: errText(e) })); }
}
/** «Apri issue» / «Apri tutte»: null when the Orchestrator got them, else why not. */
export async function openIssues(ids: string[]): Promise<string | null> {
  try {
    const r = await sb.invoke('maintenance:openIssues', { ids });
    maintenance.set(s => ({ ...s, ideas: r.state }));
    return r.sent ? null : r.why ?? '';
  } catch (e) { return errText(e); }
}
export async function dismissIdea(id: string): Promise<string | null> {
  try { const ideas = await sb.invoke('maintenance:dismissIdea', { id }); maintenance.set(s => ({ ...s, ideas })); return null; } catch (e) { return errText(e); }
}
