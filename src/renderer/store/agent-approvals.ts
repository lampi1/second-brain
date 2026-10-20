// Shared state of the "Da approvare" inbox: one read of every pending agent change, kept fresh on catalog and lifecycle
// queue changes (agents:changed, agents:lifecycleChanged) with a slow safety poll, so the Agenti page and the sidebar's
// count agree.
// Used by components/AgentApprovals.tsx and components/Sidebar.tsx.
import { useEffect } from 'react';
import { gatherApprovals, type ApprovalsClient, type ApprovalsState } from '../lib/agent-approvals';
import { lifecycleClient } from '../lib/agent-lifecycle';
import { sb } from '../sb';
import { createStore } from './createStore';

export const approvalsClient: ApprovalsClient = { invoke: (channel, arg) => sb.invoke(channel, arg), lifecycle: lifecycleClient };
export const approvals = createStore<{ state: ApprovalsState | null; error: boolean }>({ state: null, error: false });
let started = false, revision = 0;

export async function refreshApprovals(): Promise<void> {
  const mine = ++revision;
  try { const state = await gatherApprovals(approvalsClient); if (mine === revision) approvals.set({ state, error: false }); }
  catch { if (mine === revision) approvals.set(s => ({ ...s, error: true })); }
}
let soon: ReturnType<typeof setTimeout> | null = null;
/** Bursts of queue writes (an evaluation, then its proposal) become one read. */
function refreshSoon(): void { if (soon) return; soon = setTimeout(() => { soon = null; void refreshApprovals(); }, 300); }
function start(): void {
  if (started) return; started = true;
  sb.on('agents:changed', refreshSoon);
  sb.on('agents:lifecycleChanged', refreshSoon);
  sb.on('approvals:changed', refreshSoon); // the Battito's proposals (ADR 0102)
  // safety net only: metrics and learned rules written outside the queue send no event
  setInterval(() => void refreshApprovals(), 5 * 60_000);
  void refreshApprovals();
}
export function useApprovals() { useEffect(start, []); return approvals.use(s => s); }
/** The sidebar's number: pending items only (a definition overtaken by an edit still waits to be closed). */
export function useApprovalCount(): number { useEffect(start, []); return approvals.use(s => s.state?.items.length ?? 0); }
