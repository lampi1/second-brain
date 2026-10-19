// "Da approvare" inbox at the top of the Agenti page: every pending change to an agent in one place, decided only by
// the user's click (owner: everything that changes an agent goes through their approval). Wires the cards of
// AgentApprovalCards.tsx to the typed decision channels (lib/agent-approvals.ts) and to the editor for "Modifica prima
// di approvare". Mounted by AgentCatalogPage.tsx; the sidebar shows the same count (store/agent-approvals.ts).
import { useState } from 'react';
import { decideApproval, lifecycleTarget, type ApprovalDecision, type ApprovalItem } from '../lib/agent-approvals';
import { rememberAgentEditor } from '../lib/agent-drafts';
import { go } from '../actions';
import { t } from '../i18n';
import { refreshAgents } from '../store/agents';
import { approvalsClient, refreshApprovals, useApprovals } from '../store/agent-approvals';
import { AgentApprovalsView, type ApprovalDone } from './AgentApprovalCards';

function doneText(item: ApprovalItem, d: ApprovalDecision): string {
  if (item.type === 'classifier') return d.type === 'classifier' && d.decision === 'apply' ? t('approvals.done.clsApplied', { v: item.calibration.suggested }) : t('approvals.done.clsDismissed');
  const name = item.type === 'definition' ? item.proposal.draft.name : item.type === 'lifecycle' ? item.agents.map(a => a.name).join(', ') : item.agent.name;
  if (d.type === 'queue') {
    const label = name || t('approvals.toDefine');
    if (d.decision === 'dismiss') return t('approvals.done.dismissed', { name: label });
    return t(item.type === 'lifecycle' && item.proposal.kind === 'model-trial' ? 'approvals.done.trialStarted' : 'approvals.done.draftAsked', { name: label });
  }
  if (d.type === 'definition') return t(d.accept ? 'approvals.done.approved' : 'approvals.done.rejected', { name });
  if (d.type === 'trial') return t(d.decision === 'keep' ? 'approvals.done.kept' : 'approvals.done.rolledBack', { name });
  return t(d.decision === 'keep' ? 'approvals.done.keptAgent' : 'approvals.done.retired', { name });
}
const reason = (e: unknown) => e instanceof Error ? e.message : String(e);

export function AgentApprovals() {
  const { state, error } = useApprovals();
  const [busy, setBusy] = useState<string | null>(null), [done, setDone] = useState<ApprovalDone | null>(null), [failure, setFailure] = useState<string | null>(null);
  const settle = () => Promise.all([refreshApprovals(), refreshAgents()]);
  const decide = async (item: ApprovalItem, decision: ApprovalDecision) => {
    if (busy) return;
    setBusy(item.key); setFailure(null);
    try { const undo = await decideApproval(approvalsClient, item, decision); setDone({ text: doneText(item, decision), undo }); }
    catch (e) { setFailure(reason(e)); }
    finally { setBusy(null); await settle(); }
  };
  const undo = async () => {
    if (busy || !done?.undo) return;
    setBusy('undo'); setFailure(null);
    try { await done.undo.run(); setDone({ text: t('approvals.done.undone'), undo: null }); }
    catch (e) { setFailure(reason(e)); }
    finally { setBusy(null); await settle(); }
  };
  // Opening the editor never saves: the user's own Salva is the approval of the edited definition.
  const edit = (item: ApprovalItem) => {
    if (item.type === 'definition') {
      const id = item.proposal.agentId && item.agent ? item.agent.id : undefined;
      rememberAgentEditor({ ...(id ? { id, baseRevision: item.agent!.updatedAt } : {}), draft: structuredClone(item.proposal.draft), message: '', history: [], suggestion: null });
      go({ page: 'agenti', arg: id ?? 'studio' });
    } else if (item.type === 'lifecycle') go({ page: 'agenti', arg: lifecycleTarget(item) });
  };
  return <AgentApprovalsView state={state} error={error} busy={busy} done={done} failure={failure}
    onDecide={(item, d) => void decide(item, d)} onEdit={edit} onUndo={() => void undo()} onDismiss={() => setDone(null)} onRefresh={() => void refreshApprovals()} />;
}
