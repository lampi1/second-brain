// Live flow catalog and exact-brain decisions. A changed brain clears cached proposals before any replacement read.
import { useEffect } from 'react';
import type { FlowAutomationControl, FlowAutomationPause } from '@shared/flow-automation';
import type { FlowSnapshot, FlowStepTierEdit } from '@shared/flows';
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
    const snapshot = ask.type === 'flow-automation'
      ? await sb.invoke('flows:autoDecide', { ...common, id: ask.rule.id, expectedRevision: ask.rule.revision })
      : ask.type === 'flow-definition'
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

/** The user's tier pick on a step: only a new proposed revision, which the definition modal then activates or not. */
export async function editFlowStepTier(contextKey: string, edit: FlowStepTierEdit): Promise<boolean> {
  if (flowState.get().snapshot?.contextKey !== contextKey) return false;
  const ticket = read;
  try {
    const snapshot = await sb.invoke('flows:editStepTier', { ...edit, contextKey });
    if (ticket === read && flowState.get().snapshot?.contextKey === contextKey) { ++read; acceptSnapshot(snapshot); }
    return true;
  } catch {
    toast(t('flows.failedTierEdit'), 'err'); void reloadFlows(); return false;
  }
}

/** User controls retain the displayed brain and revision; a late response never replaces a newer snapshot. */
export async function controlFlowAutomation(contextKey: string, control: FlowAutomationControl | FlowAutomationPause): Promise<boolean> {
  if (flowState.get().snapshot?.contextKey !== contextKey) return false;
  const ticket = read;
  try {
    const snapshot = 'id' in control
      ? await sb.invoke('flows:autoPause', { ...control, contextKey })
      : await sb.invoke('flows:autoControl', { ...control, contextKey });
    if (ticket === read && flowState.get().snapshot?.contextKey === contextKey) { ++read; acceptSnapshot(snapshot); }
    return true;
  } catch {
    toast(t('flows.failedDecision'), 'err'); void reloadFlows(); return false;
  }
}

/** Import never approves or starts a flow. Late results cannot replace a different brain's state. */
export async function importFlowDefinition(contextKey: string, content: string): Promise<boolean> {
  if (flowState.get().snapshot?.contextKey !== contextKey) return false;
  const ticket = read;
  try {
    const snapshot = await sb.invoke('flows:import', { contextKey, content });
    if (flowState.get().snapshot?.contextKey !== contextKey) return false;
    if (ticket === read) { ++read; acceptSnapshot(snapshot); }
    toast(t('flows.imported'), 'info');
    return true;
  } catch { return false; }
}

/** The host exports only a portable definition; renderer downloads never serialize the live snapshot. */
export async function exportFlowDefinition(contextKey: string, flowId: string, version: number, format: 'json' | 'markdown'): Promise<void> {
  if (flowState.get().snapshot?.contextKey !== contextKey) return;
  try {
    const result = await sb.invoke('flows:export', { contextKey, flowId, version, format });
    if (flowState.get().snapshot?.contextKey !== contextKey) return;
    const url = URL.createObjectURL(new Blob([result.content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = result.filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast(t('flows.exportFailed'), 'err'); }
}
