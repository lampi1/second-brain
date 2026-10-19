// Which model a role's tier means on an engine: the user's choice in Impostazioni → Ruoli e deleghe (Settings.modelTiers),
// else the brain's model registry (harness/models.json: tier high = top, mid = mid, small = light, the first one the
// routing may pick), else the engine's default (null). An independent role (Sentinel, Judge) gets a model other than the
// one its parent runs, when the tier or the next one up has one. Pure: used by agents/catalog.ts resolve().
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

/** For an independent role: a model of the tier (or a higher one) other than `avoid`; else the tier's own model, with
 *  `independent: false` so the run records that it shares its parent's model. */
export function independentModel(engine: Harness, tier: ModelTier, avoid: string | null, registry: ModelRegistry | null, overrides: ModelTiers | undefined): { model: string | null; independent: boolean } {
  const first = tierModel(engine, tier, registry, overrides);
  if (avoid === null) return { model: first, independent: first !== null };
  for (const t of MODEL_TIERS.filter(t => tierRank(t) >= tierRank(tier))) {
    const other = tierCandidates(engine, t, registry, overrides).find(m => m !== avoid);
    if (other) return { model: other, independent: true };
  }
  return { model: first, independent: false };
}

/** A tier no higher than `max`. */
export const cappedTier = (tier: ModelTier, max: ModelTier): ModelTier => (tierRank(tier) > tierRank(max) ? max : tier);
