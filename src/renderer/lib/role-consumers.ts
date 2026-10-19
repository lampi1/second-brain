// Which roles a new chat can start as, for the start dialog and the catalog page: the eight work roles in the
// catalog's order, and whether a role's engine and model can run now. Never grants a permission.
import type { AgentCatalog, AgentModelChoice, AgentProfile } from '@shared/agents';
import { WORK_ROLE_IDS } from '@shared/roles';

export function workRoles(catalog: AgentCatalog | null): AgentProfile[] {
  if (!catalog) return [];
  return WORK_ROLE_IDS.flatMap(id => catalog.profiles.find(p => p.id === id) ?? []);
}
export function profileCanStart(profile: AgentProfile | undefined, choice: AgentModelChoice | undefined): boolean {
  return !!profile && !!choice && choice.enabled && choice.trusted && choice.installed !== false && choice.authenticated !== false
    && (profile.model ? choice.modelSelectable && choice.models.some(model => model.id === profile.model) : choice.defaultModel) && (!profile.effort || choice.effort);
}
