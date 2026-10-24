// The label of who takes an agent step (FlowStepAgent): «Ruolo · tier · model», the model from the roles the host
// resolved through the routing table; «scelto dal ruolo» where the step leaves the role or tier open. Pure, unit tested.
import type { FlowRoleInfo, FlowStep } from '@shared/flows';
import { t } from '../i18n';

/** «Scout · mid · model» / «Artisan · scelto dal ruolo» / «scelto dal ruolo». */
export function stepAgentLabel(step: FlowStep, role: FlowRoleInfo | undefined): string {
  const byRole = t('flows.byRole');
  if (!step.role) return byRole;
  const name = role?.name ?? step.role;
  if (!step.tier) return `${name} · ${byRole}`;
  // the role's own fixed model wins over its tier (agents/catalog.ts resolve), else the tier's model on its engine
  const model = role ? role.model ?? role.models[step.tier] ?? t('flows.engineDefault') : null;
  return [name, step.tier, model].filter(Boolean).join(' · ');
}

