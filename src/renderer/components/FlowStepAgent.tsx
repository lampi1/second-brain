// Who takes an agent step: the role's avatar and «Ruolo · tier · model», the model read from the roles the host resolved
// through the routing table (FlowSnapshot.roles), never written by hand; «scelto dal ruolo» where the step leaves the
// role or tier open; a running step shows the avatar of the chat it is bound to. Used by the flow diagram (nodes and
// inspector) and the full definition (catalog and approval modal).
import type { FlowStep } from '@shared/flows';
import { stepAgentLabel } from '../lib/flow-step-agent';
import { flowState } from '../store/flows';
import { useApp } from '../store/store';
import { AgentAvatar } from './AgentAvatar';

export function FlowStepAgent({ step, chatId, compact = false }: { step: FlowStep; chatId?: string; compact?: boolean }) {
  const role = flowState.use(s => (step.role ? s.snapshot?.roles?.[step.role] : undefined));
  const bound = useApp(s => (chatId ? s.chats[chatId]?.agent : undefined));
  if (step.kind !== 'agent' || (compact && !step.role && !bound?.avatar)) return null;
  const label = stepAgentLabel(step, role);
  const avatar = bound?.avatar ?? role?.avatar ?? (step.role ? { kind: 'character' as const, value: step.role } : undefined);
  return <span className="flow-step-agent" data-compact={compact || undefined} data-testid={compact ? 'flow-node-agent' : 'flow-step-agent'} title={label}>
    {avatar && <AgentAvatar avatar={avatar} name={bound?.name ?? role?.name ?? step.role ?? ''} size={20} />}
    {!compact && <span>{label}</span>}
  </span>;
}
