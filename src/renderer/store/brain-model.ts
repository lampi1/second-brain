// The Brain pages' shared state (ADR 0077): skills and their agents, rules, memory, the maintenance change log and the
// migration report, read from main ('brainmodel:state') and refreshed on 'brainmodel:changed' (a job, an undo, a file
// changed on disk) and 'agents:changed'. The maintenance button, an undo and a skill toggle go through the typed IPC and
// put the fresh state back; the Memoria hub's trash too (removeBrainItem). Used by the Agenti, Skill, Regole, Memoria and Mappa pages and the agent flip card.
import { useEffect } from 'react';
import type { BrainModelState } from '@shared/brain-model';
import { sb } from '../sb';
import { createStore } from './createStore';
import { errText } from '../lib/ipc-error';

export const brainModel = createStore<{ state: BrainModelState | null; error: string | null; busy: boolean }>({ state: null, error: null, busy: false });
let started = false, revision = 0;

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
/** live = false: the store as it is, without reading the brain model now (the Orchestrator's maintenance icon, #150:
 *  its pass brings the state back) */
export function useBrainModel(live = true) { useEffect(() => { if (live) start(); }, [live]); return brainModel.use(s => s); }

async function act(run: () => Promise<BrainModelState>): Promise<string | null> {
  if (brainModel.get().busy) return null;
  brainModel.set(s => ({ ...s, busy: true }));
  try { const state = await run(); revision++; brainModel.set(s => ({ ...s, state, error: null, busy: false })); return null; }
  catch (e) { brainModel.set(s => ({ ...s, busy: false })); return errText(e); }
}
export const rollbackChange = (id: string) => act(() => sb.invoke('brainmodel:rollback', { id }));
export const linkSkill = (skill: string, agentId: string, on: boolean) => act(() => sb.invoke('brainmodel:link', { skill, agentId, on }));
/** The Memoria hub's trash (ADR 0122): removes a brain skill, a rules/ file or a script through the change log.
 *  Resolves to the change id («Annulla» = rollbackChange of it) or an error text. */
export async function removeBrainItem(kind: 'skill' | 'rule' | 'script', target: string): Promise<{ changeId: string } | { error: string }> {
  try {
    const r = await sb.invoke('brainmodel:remove', { kind, target });
    revision++; brainModel.set(s => ({ ...s, state: r.state, error: null }));
    return { changeId: r.changeId };
  } catch (e) { return { error: errText(e) }; }
}
