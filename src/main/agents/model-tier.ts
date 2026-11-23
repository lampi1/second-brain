// Which model a role's internal tier means on an engine when its card names none: the brain's model registry
// (harness/models.json: tier high = top, mid = mid, small = light, the first one the routing may pick), else the
// engine's default (null). The user picks a role's models on its card (Minimo/Base/Massimo, ADR 0336); the Settings'
// per-tier models (modelTiers) are gone since 2026-11-23 and reach this only once, as `overrides`, in the one-off
// migration that wrote them onto the cards (agents/legacy-cards.ts). Pure: used by agents/catalog.ts through
// wiring-shared.ts and by the migration.
import type { Harness, ModelRegistry } from '../../shared/contract';
import type { ModelTier } from '../../shared/roles';

export type ModelTiers = Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
const REGISTRY_TIER: Record<ModelTier, string> = { top: 'high', mid: 'mid', light: 'small' };

/** The models of one tier on one engine, best first: the migration's old Settings pick, then the registry's auto
 *  models, then its manual ones. */
export function tierCandidates(engine: Harness, tier: ModelTier, registry: ModelRegistry | null, overrides?: ModelTiers): string[] {
  const own = overrides?.[engine]?.[tier]?.trim();
  const rows = (registry?.models ?? []).filter(m => m.harness === engine && m.tier === REGISTRY_TIER[tier]);
  const ids = [...rows.filter(m => m.routing === 'auto'), ...rows.filter(m => m.routing !== 'auto')].map(m => m.id);
  return [...new Set([...(own ? [own] : []), ...ids])];
}

/** The model a tier means on an engine; null = the engine's own default. */
export function tierModel(engine: Harness, tier: ModelTier, registry: ModelRegistry | null, overrides?: ModelTiers): string | null {
  return tierCandidates(engine, tier, registry, overrides)[0] ?? null;
}
