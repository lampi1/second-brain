// "Da approvare" inbox at the top of the Agenti page: every pending change to a role's reach or cost in one place (an
// open trial, a tier suggestion), decided only by the user's click (ADR 0083). Wires the cards of
// AgentApprovalCards.tsx to the typed decision channels (lib/agent-approvals.ts). Mounted by AgentCatalogPage.tsx; the
// sidebar shows the same count (store/agent-approvals.ts).
import { useState } from 'react';
import { decideApproval, type ApprovalDecision, type ApprovalItem } from '../lib/agent-approvals';
import { t } from '../i18n';
import { refreshAgents } from '../store/agents';
import { approvalsClient, refreshApprovals, useApprovals } from '../store/agent-approvals';
import { AgentApprovalsView, type ApprovalDone } from './AgentApprovalCards';

function doneText(item: ApprovalItem, d: ApprovalDecision): string {
  const name = item.type === 'lifecycle' ? item.agents.map(a => a.name).join(', ') : item.type === 'pulse' ? item.agent?.name ?? item.proposal.title : item.agent.name;
  if (d.type === 'pulse') return t('alive.approval.done', { name });
  if (d.type === 'queue') return t(d.decision === 'dismiss' ? 'approvals.done.dismissed' : 'approvals.done.trialStarted', { name });
  return t(d.decision === 'keep' ? 'approvals.done.kept' : 'approvals.done.rolledBack', { name });
}
const reason = (e: unknown) => e instanceof Error ? e.message : String(e);

export function AgentApprovals() {
  const { state, error } = useApprovals();
  const [busy, setBusy] = useState<string | null>(null), [done, setDone] = useState<ApprovalDone | null>(null), [failure, setFailure] = useState<string | null>(null);
  const decide = async (item: ApprovalItem, decision: ApprovalDecision) => {
    if (busy) return;
    setBusy(item.key); setFailure(null);
    try { await decideApproval(approvalsClient, item, decision); setDone({ text: doneText(item, decision) }); }
    catch (e) { setFailure(reason(e)); }
    finally { setBusy(null); await Promise.all([refreshApprovals(), refreshAgents()]); }
  };
  return <AgentApprovalsView state={state} error={error} busy={busy} done={done} failure={failure}
    onDecide={(item, d) => void decide(item, d)} onDismiss={() => setDone(null)} onRefresh={() => void refreshApprovals()} />;
}
