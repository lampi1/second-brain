// Live workflow projection: token-free reads; explicit user decisions use the typed main bridge.
import { createStore } from './createStore';
import type { WorkThread } from '@shared/workflows';
import { toast } from './ui';
const state = createStore<{ rows: WorkThread[]; error: string | null }>({ rows: [], error: null });
let started = false;
export async function reloadWorkflows(): Promise<void> {
  try { const rows = await window.sb.invoke('work:list', undefined); state.set({ rows, error: null }); }
  catch (e) { state.set(s => ({ ...s, error: String(e) })); }
}
export function useWorkflows() {
  if (!started && typeof window !== 'undefined' && window.sb) {
    started = true;
    let received = false;
    window.sb.on('work:changed', rows => { received = true; state.set({ rows, error: null }); });
    void window.sb.invoke('work:list', undefined).then(rows => { if (!received) state.set({ rows, error: null }); }, e => state.set({ rows: [], error: String(e) }));
  }
  return state.use(s => s);
}
export async function decideWork(row: WorkThread, approve: boolean): Promise<void> {
  if (!row.proposal) return;
  try { await window.sb.invoke('work:decide', { id: row.id, expectedVersion: row.version, proposalId: row.proposal.id, approve }); }
  catch (e) { toast(`Decisione non registrata: ${String(e)}`, 'err'); }
}
