// The one model catalog every model picker shows (owner, 2026-10-31: one selector for the Orchestrator, the Agenti page
// and the Grindhouse strip, the four engines in it): the agent catalog's models per engine (main: wiring-shared.ts
// createAgentCatalog, the same list a role card may hold), grouped by engine with its state (ready, empty, off, not
// selectable, with the reason), each model with its effort levels and context window, the chosen id kept even when the
// engine no longer lists it. The first row of a group is its default: «Predefinito della CLI» for a chat (the engine's
// own model), «Modello del livello» for a role (resolved at launch from the role's tier): two different things, never
// the same label. Pure functions, no React: ModelPicker.tsx renders them, test/unit/model-catalog.test.ts checks them.
import type { Effort, Harness } from '@shared/contract';
import type { AgentModelChoice } from '@shared/agents';
import { effortOn } from '@shared/agents';

/** One row: a model of an engine, or (id null) the engine's default for this scope. */
export interface CatalogRow {
  engine: Harness;
  /** null = the default row of the group */
  id: string | null;
  name: string;
  efforts?: Effort[];
  defaultEffort?: Effort | null;
  contextWindow?: number;
  /** the chosen id is not in the engine's list any more: kept so it still reads, marked as such */
  missing?: boolean;
}
/** Why a whole engine cannot take a choice now (null = it can). */
export type GroupBlock = 'off' | 'untrusted' | 'not-selectable' | null;
export interface EngineGroup {
  engine: Harness; label: string;
  /** where the list comes from: seen at the CLI's last chat, the brain's registry, or nothing known */
  source: AgentModelChoice['source'];
  block: GroupBlock;
  /** the adapter's own words when it cannot apply a model (AgentModelChoice.modelReason) */
  reason: string | null;
  /** the engine takes an effort level */
  effort: boolean;
  /** the engine honours a role's context limit */
  maxContext: boolean;
  /** the models only (no default row): empty = the engine listed none */
  models: CatalogRow[];
  rows: CatalogRow[];
}

export interface CatalogCurrent { engine: Harness; model: string | null }

/** The groups, the current engine first, then the catalog's order; `current` keeps its model as a row even when the
 *  engine stopped listing it. */
export function catalogGroups(choices: readonly AgentModelChoice[], current: CatalogCurrent, defaultName: string): EngineGroup[] {
  const groups = choices.map((c): EngineGroup => {
    const models: CatalogRow[] = c.models.map(m => ({ engine: c.engine, id: m.id, name: m.name || m.id,
      ...(m.efforts ? { efforts: m.efforts } : {}), ...(m.defaultEffort !== undefined ? { defaultEffort: m.defaultEffort } : {}),
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}) }));
    if (c.engine === current.engine && current.model && !models.some(m => m.id === current.model))
      models.push({ engine: c.engine, id: current.model, name: current.model, missing: true });
    const block: GroupBlock = !c.enabled ? 'off' : !c.trusted ? 'untrusted' : !c.modelSelectable ? 'not-selectable' : null;
    return { engine: c.engine, label: c.label, source: c.source, block, reason: c.modelReason, effort: c.effort, maxContext: !!c.maxContext,
      models, rows: [{ engine: c.engine, id: null, name: defaultName }, ...models] };
  });
  return [...groups.filter(g => g.engine === current.engine), ...groups.filter(g => g.engine !== current.engine)];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The groups whose engine or models match the search; a group that matches by its engine's name keeps every row. */
export function searchGroups(groups: readonly EngineGroup[], query: string): EngineGroup[] {
  const q = norm(query.trim());
  if (!q) return [...groups];
  return groups.flatMap(g => {
    if (norm(g.label).includes(q) || norm(g.engine).includes(q)) return [g];
    const models = g.models.filter(m => norm(m.name).includes(q) || norm(m.id ?? '').includes(q));
    return models.length ? [{ ...g, models, rows: models }] : [];
  });
}

/** The effort levels a row offers: the model's own when the registry knows them, else every level (clamped at launch). */
export function rowEfforts(row: CatalogRow | undefined, all: readonly Effort[]): readonly Effort[] {
  return row?.efforts ?? all;
}

/** The effort a choice really runs with on that row (shared/agents.ts effortOn: the launch's rule). */
export function realEffort(asked: Effort | null, row: CatalogRow | undefined): Effort | null {
  return effortOn(asked, row?.efforts);
}

/** Tokens as a short size: 200000 → "200k", 1000000 → "1M". */
export const kTokens = (n: number): string => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;

/** The row a pick points at, or undefined. */
export function findRow(groups: readonly EngineGroup[], engine: Harness, id: string | null): CatalogRow | undefined {
  return groups.find(g => g.engine === engine)?.rows.find(r => r.id === id);
}
