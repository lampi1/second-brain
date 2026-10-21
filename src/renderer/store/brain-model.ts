// The Brain pages' shared state (ADR 0077): skills and their agents, rules, memory, the maintenance change log and the
// migration report, read from main ('brainmodel:state') and refreshed on 'brainmodel:changed' (a job, an undo, a file
// changed on disk) and 'agents:changed'. The maintenance button, an undo and a skill toggle go through the typed IPC and
// put the fresh state back. Used by the Agenti, Skill, Regole, Memoria and Mappa pages and the agent flip card.
import { useEffect } from 'react';
import type { BrainModelState, MaintenanceJobId } from '@shared/brain-model';
import { sb } from '../sb';
import { createStore } from './createStore';

export const brainModel = createStore<{ state: BrainModelState | null; error: string | null; busy: boolean }>({ state: null, error: null, busy: false });
let started = false, revision = 0;
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export async function refreshBrainModel(): Promise<void> {
  const r = ++revision;
  try { const state = await sb.invoke('brainmodel:state', undefined); if (r === revision) brainModel.set(s => ({ ...s, state, error: null })); }
  catch (e) { if (r === revision) brainModel.set(s => ({ ...s, error: errText(e) })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('brainmodel:changed', () => { void refreshBrainModel(); });
  sb.on('agents:changed', () => { void refreshBrainModel(); });
  void refreshBrainModel();
}
export function useBrainModel() { useEffect(start, []); return brainModel.use(s => s); }

async function act(run: () => Promise<BrainModelState>): Promise<string | null> {
  if (brainModel.get().busy) return null;
  brainModel.set(s => ({ ...s, busy: true }));
  try { const state = await run(); revision++; brainModel.set(s => ({ ...s, state, error: null, busy: false })); return null; }
  catch (e) { brainModel.set(s => ({ ...s, busy: false })); return errText(e); }
}
/** The maintenance button: every job now (or one). Resolves to an error text, or null. */
export const runMaintenance = (job?: MaintenanceJobId) => act(() => sb.invoke('brainmodel:maintain', job ? { job } : undefined));
/** "Noto, ignora" on a log group of the maintenance (#150): listed apart, never handed to the Orchestrator again. */
export const markLogGroup = (key: string, known: boolean) => act(() => sb.invoke('brainmodel:noise', { key, known }));
export const rollbackChange = (id: string) => act(() => sb.invoke('brainmodel:rollback', { id }));
export const linkSkill = (skill: string, agentId: string, on: boolean) => act(() => sb.invoke('brainmodel:link', { skill, agentId, on }));
