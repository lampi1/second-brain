// The work roles as a flow step will launch them: name, avatar, default tier, tierMax, the role's own fixed model and,
// per tier, the model the routing table gives on the role's engine (the same lookup agents/catalog.ts resolve() makes
// for a launch that asks a tier). Pure: wiring.ts feeds it the catalog and tierModel; the Flussi page and the tierMax
// check on propose read the result.
import type { AgentProfile } from '../../shared/agents';
import type { Harness } from '../../shared/contract';
import type { FlowRoleInfo } from '../../shared/flows';
import { MODEL_TIERS, isWorkRole, tierRank, type ModelTier, type WorkRoleId } from '../../shared/roles';

export function flowRoles(profiles: readonly AgentProfile[], tierModel: (engine: Harness, tier: ModelTier) => string | null): Partial<Record<WorkRoleId, FlowRoleInfo>> {
  const out: Partial<Record<WorkRoleId, FlowRoleInfo>> = {};
  for (const p of profiles) {
    if (!isWorkRole(p.id)) continue;
    const models = Object.fromEntries(MODEL_TIERS.filter(tier => tierRank(tier) <= tierRank(p.tierMax)).map(tier => [tier, tierModel(p.engine, tier)]));
    out[p.id] = { name: p.name, avatar: p.avatar, tier: p.tier, tierMax: p.tierMax, model: p.model ?? null, models };
  }
  return out;
}
