// Live flow catalog and exact-brain decisions. A changed brain clears cached proposals before any replacement read.
import { shareSnapshot } from '../lib/share-snapshot';
import { useEffect } from 'react';
import type { FlowCancel, FlowRestart, FlowSnapshot } from '@shared/flows';
import type { FlowAsk } from '../lib/flow-ask';
import { clearDecisionDrafts } from '../lib/decision-drafts';
import { flowAsks } from '../lib/flow-ask';
import { sb } from '../sb';
import { t } from '../i18n';
import { createStore } from './createStore';
import { app } from './store';
import { toast } from './ui';
export const flowState = createStore<{ snapshot: FlowSnapshot | null; error: string | null; loading: boolean }>({ snapshot: null, error: null, loading: true });
let started = false, read = 0;
function acceptSnapshot(snapshot: FlowSnapshot): void {
  const previous = flowState.get().snapshot?.contextKey;
  if (previous && previous !== snapshot.contextKey) clearDecisionDrafts('flow/');
  flowState.set(state => {
    const shared = previous === snapshot.contextKey ? shareSnapshot(state.snapshot, snapshot) : snapshot;
    const error = snapshot.storageError ?? null;
    return shared === state.snapshot && error === state.error && !state.loading ? state : { snapshot: shared, error, loading: false };
  });
}
export async function reloadFlows(): Promise<void> {
  const ticket = ++read;
  try {
    const snapshot = await sb.invoke('flows:list', undefined);
    if (ticket === read) acceptSnapshot(snapshot);
  } catch (error) {
    if (ticket === read) flowState.set(s => ({ ...s, error: String(error), loading: false }));
  }
}
export function useFlows() {
  useEffect(() => {
    if (started || typeof window === 'undefined' || !window.sb) return;
    started = true;
    let brain = app.get().info?.brainRoot;
    app.subscribe(() => {
      const next = app.get().info?.brainRoot;
      if (next === brain) return;
      brain = next; ++read;
      clearDecisionDrafts('flow/');
      flowState.set(() => ({ snapshot: null, error: null, loading: true }));
      void reloadFlows();
    });
    sb.on('flows:changed', snapshot => {
      ++read;
      acceptSnapshot(snapshot);
    });
    void reloadFlows();
  }, []);
  return flowState.use(s => s);
}
export const flowAskKeys = (): string[] => flowAsks(flowState.get().snapshot).map(ask => `${ask.chatId}/${ask.id}`);
export async function decideFlow(ask: FlowAsk, answer: 'yes' | 'no' | 'other', feedback?: string): Promise<boolean> {
  if (flowState.get().snapshot?.contextKey !== ask.contextKey) return false;
  const ticket = read;
  try {
    if (ask.type === 'flow-reconcile') {
      if (answer === 'other') return false;
      await sb.invoke('flows:reconcileDecide', { contextKey: ask.contextKey, runId: ask.run.id, expectedRevision: ask.run.revision, answer });
      await reloadFlows(); return true;
    }
    const common = { contextKey: ask.contextKey, answer, ...(feedback ? { feedback } : {}) };
    const snapshot = ask.type === 'flow-automation'
      ? await sb.invoke('flows:autoDecide', { ...common, id: ask.rule.id, expectedRevision: ask.rule.revision })
      : ask.type === 'flow-definition'
      ? await sb.invoke('flows:definitionDecide', { ...common, id: ask.draft.definition.id, expectedRevision: ask.draft.revision })
      : ask.type === 'flow-cancel'
      ? await sb.invoke('flows:cancelDecide', { ...common, runId: ask.run.id, expectedRevision: ask.run.revision })
      : ask.type === 'flow-restart'
      ? await sb.invoke('flows:restartDecide', { ...common, runId: ask.run.id, expectedRevision: ask.run.revision })
      : await sb.invoke('flows:decide', { ...common, runId: ask.run.id, expectedRevision: ask.run.revision, stepId: ask.run.steps[ask.run.currentStep]!.stepId });
    if (ticket === read && flowState.get().snapshot?.contextKey === ask.contextKey) {
      ++read;
      acceptSnapshot(snapshot);
    }
    return true;
  } catch (error) {
    toast(ask.type === 'flow-definition' ? plain(error) : t('flows.failedDecision'), 'err');
    void reloadFlows();
    return false;
  }
}

export interface FlowRunControlResult { ok: boolean; runId?: string; error?: string }
/** Direct user controls pin brain, run revision and target definition. Late replies never replace a newer brain. */
export async function controlFlowRun(contextKey: string, control: FlowCancel | FlowRestart): Promise<FlowRunControlResult> {
  const current = flowState.get().snapshot;
  if (current?.contextKey !== contextKey || !current.runs.some(run => run.id === control.runId && run.revision === control.expectedRevision)) return { ok: false, error: t('flows.recoveryStale') };
  const ticket = read;
  try {
    const snapshot = 'mode' in control
      ? await sb.invoke('flows:restart', { ...control, contextKey })
      : await sb.invoke('flows:cancel', { ...control, contextKey });
    if (flowState.get().snapshot?.contextKey !== contextKey) return { ok: false, error: t('flows.recoveryStale') };
    if (ticket === read) { ++read; acceptSnapshot(snapshot); }
    const restarted = 'mode' in control ? snapshot.runs.filter(run => run.restartOf?.runId === control.runId && run.restartOf.expectedRevision === control.expectedRevision && run.restartOf.mode === control.mode).sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
    return { ok: true, runId: restarted?.id ?? control.runId };
  } catch (error) {
    void reloadFlows();
    return { ok: false, error: `${t('flows.recoveryFailed')} ${String(error)}` };
  }
}

/** The text of an IPC error without Electron's "Error invoking remote method" prefix. */
export const plain = (error: unknown): string => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
