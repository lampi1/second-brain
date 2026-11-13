// Which model a role's tier means on an engine: the user's choice in Impostazioni → Ruoli e deleghe (Settings.modelTiers),
// else the brain's model registry (harness/models.json: tier high = top, mid = mid, small = light, the first one the
// routing may pick), else the engine's default (null). Every role resolves its model this way, Sentinel too: a
// review's independence is its new session with a clean context, never another model (ADR 0091). Pure: used by
// agents/catalog.ts resolve() through wiring.ts.
import type { Harness, ModelRegistry } from '../../shared/contract';
import { MODEL_TIERS, tierRank, type ModelTier } from '../../shared/roles';

export type ModelTiers = Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
const REGISTRY_TIER: Record<ModelTier, string> = { top: 'high', mid: 'mid', light: 'small' };

/** The models of one tier on one engine, best first: the user's pick, then the registry's auto models, then its manual ones. */
export function tierCandidates(engine: Harness, tier: ModelTier, registry: ModelRegistry | null, overrides: ModelTiers | undefined): string[] {
  const own = overrides?.[engine]?.[tier]?.trim();
  const rows = (registry?.models ?? []).filter(m => m.harness === engine && m.tier === REGISTRY_TIER[tier]);
  const ids = [...rows.filter(m => m.routing === 'auto'), ...rows.filter(m => m.routing !== 'auto')].map(m => m.id);
  return [...new Set([...(own ? [own] : []), ...ids])];
}

/** The model a tier means on an engine; null = the engine's own default. */
export function tierModel(engine: Harness, tier: ModelTier, registry: ModelRegistry | null, overrides: ModelTiers | undefined): string | null {
  return tierCandidates(engine, tier, registry, overrides)[0] ?? null;
}

/** Whether `model` is one of the models (any, not only the first) of a tier no higher than `max` (ADR 0218): a model in
 *  no tier is never within. `models(t)` = tierCandidates of that engine. */
export function withinTierMax(models: (tier: ModelTier) => readonly string[], model: string, max: ModelTier): boolean {
  return MODEL_TIERS.some(t => tierRank(t) <= tierRank(max) && models(t).includes(model));
}

/** A tier no higher than `max`. */
export const cappedTier = (tier: ModelTier, max: ModelTier): ModelTier => (tierRank(tier) > tierRank(max) ? max : tier);
