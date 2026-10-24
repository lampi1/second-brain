// Who takes an agent step: the role's avatar and «Ruolo · tier · model», the model read from the roles the host resolved
// through the routing table (FlowSnapshot.roles), never written by hand; «scelto dal ruolo» where the step leaves the
// role or tier open; a running step shows the avatar of the chat it is bound to. With `edit` (the catalog's definition
// view only, never the approval modal) a role step gets a tier menu limited to the role's tierMax: a pick only proposes
// a new draft revision, activated in the existing definition modal. Used by the flow diagram (nodes and inspector) and
// the full definition (catalog and approval modal).
import type { FlowStep } from '@shared/flows';
import type { ModelTier } from '@shared/roles';
import { stepAgentLabel, stepTierOptions } from '../lib/flow-step-agent';
import { flowState } from '../store/flows';
import { useApp } from '../store/store';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';

/** Locked = a proposal is already pending: the menu stays visible but disabled until the user decides it. */
export interface FlowStepTierControl { locked: boolean; pick: (stepId: string, tier: ModelTier | null) => void }

export function FlowStepAgent({ step, chatId, compact = false, edit }: { step: FlowStep; chatId?: string; compact?: boolean; edit?: FlowStepTierControl }) {
  const role = flowState.use(s => (step.role ? s.snapshot?.roles?.[step.role] : undefined));
  const bound = useApp(s => (chatId ? s.chats[chatId]?.agent : undefined));
  if (step.kind !== 'agent' || (compact && !step.role && !bound?.avatar)) return null;
  const label = stepAgentLabel(step, role);
  const avatar = bound?.avatar ?? role?.avatar ?? (step.role ? { kind: 'character' as const, value: step.role } : undefined);
  const options = edit && !compact && step.role ? stepTierOptions(role) : [];
  return <span className="flow-step-agent" data-compact={compact || undefined} data-testid={compact ? 'flow-node-agent' : 'flow-step-agent'} title={label}>
    {avatar && <AgentAvatar avatar={avatar} name={bound?.name ?? role?.name ?? step.role ?? ''} size={20} />}
    {!compact && options.length === 0 && <span>{label}</span>}
    {options.length > 0 && <>
      <span>{role?.name ?? step.role}</span>
      <select className="flow-step-tier" data-testid="flow-step-tier" aria-label={t('flows.tierPick')} title={edit!.locked ? t('flows.tierLocked') : t('flows.tierPick')}
        disabled={edit!.locked} value={step.tier ?? ''} onChange={e => edit!.pick(step.id, (e.target.value || null) as ModelTier | null)}>
        <option value="">{t('flows.byRole')}</option>
        {options.map(o => <option key={o.tier} value={o.tier}>{o.label}</option>)}
      </select>
    </>}
  </span>;
}
