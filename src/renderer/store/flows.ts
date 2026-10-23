// Live flow catalog and exact-brain decisions. A changed brain clears cached proposals before any replacement read.
import { useEffect } from 'react';
import type { FlowSnapshot } from '@shared/flows';
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
  flowState.set(() => ({ snapshot, error: snapshot.storageError ?? null, loading: false }));
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
    const common = { contextKey: ask.contextKey, answer, ...(feedback ? { feedback } : {}) };
    const snapshot = ask.type === 'flow-definition'
      ? await sb.invoke('flows:definitionDecide', { ...common, id: ask.draft.definition.id, expectedRevision: ask.draft.revision })
      : await sb.invoke('flows:decide', { ...common, runId: ask.run.id, expectedRevision: ask.run.revision, stepId: ask.run.steps[ask.run.currentStep]!.stepId });
    if (ticket === read && flowState.get().snapshot?.contextKey === ask.contextKey) {
      ++read;
      acceptSnapshot(snapshot);
    }
    return true;
  } catch {
    toast(t('flows.failedDecision'), 'err');
    void reloadFlows();
    return false;
  }
}
