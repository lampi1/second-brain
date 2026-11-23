// One-off move of the retired model Settings onto the role cards (2026-11-23, the owner: the preset is chosen «solo ed
// esclusivamente dalle card degli agenti oppure che lo setti l'orchestrator, non dalle impostazioni»; Code Mode per
// role, on every engine). What moves: the per-tier models (modelTiers.*) become the model of each card that named none;
// the global Code Mode switch goes to every work role; the Orchestrator's «Chat aperte dall'Orchestrator» model, effort,
// Cursor reasoning and fast go to the Orchestrator's card (its engine stays the setting orchestratorChats.harness).
// brain/config.ts captures the old values from config.json into userData/legacy-model-settings.json before it drops
// them (legacyOf, writeLegacy); wiring.ts applies them once (catalog.migrateLegacy, a marker file). Pure but for the
// two file helpers; tests: test/unit/agents/legacy-cards.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Harness } from '../../shared/contract';
import type { AgentProfile } from '../../shared/agents';
import { MODEL_TIERS, type ModelTier } from '../../shared/roles';
import type { ModelTiers } from './model-tier';

export interface LegacyModelSettings {
  modelTiers?: ModelTiers;
  codeMode?: boolean;
  orchestrator?: { harness?: string; claudeModel?: string; cursorModel?: string; claudeEffort?: string; cursorReasoning?: string; cursorFast?: boolean };
}

const LEGACY_FILE = 'legacy-model-settings.json';
export const LEGACY_MARK = 'migrated-role-cards';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);
const MODEL = /^[\w.:@/[\]=,-]{1,200}$/;

/** The retired keys config.json still holds; null = none (nothing to migrate). */
export function legacyOf(raw: unknown): LegacyModelSettings | null {
  const r = obj(raw);
  if (!r) return null;
  const out: LegacyModelSettings = {};
  const tiers = obj(r.modelTiers);
  if (tiers) {
    const t: ModelTiers = {};
    for (const [engine, v] of Object.entries(tiers)) {
      const o = obj(v); if (!o) continue;
      const row: Partial<Record<ModelTier, string>> = {};
      for (const tier of MODEL_TIERS) { const m = str(o[tier]); if (m && MODEL.test(m)) row[tier] = m; }
      if (Object.keys(row).length) t[engine as Harness] = row;
    }
    if (Object.keys(t).length) out.modelTiers = t;
  }
  if (r.codeMode === true) out.codeMode = true;
  const oc = obj(r.orchestratorChats);
  if (oc) {
    const o: NonNullable<LegacyModelSettings['orchestrator']> = {};
    for (const k of ['harness', 'claudeModel', 'cursorModel', 'claudeEffort', 'cursorReasoning'] as const) { const v = str(oc[k]); if (v) o[k] = v; }
    if (oc.cursorFast === true) o.cursorFast = true;
    if (o.claudeModel || o.cursorModel || o.claudeEffort || o.cursorReasoning || o.cursorFast) out.orchestrator = o;
  }
  // a file that only held the old defaults still moves: its cards get the model their tier resolved to that day
  return out.modelTiers || out.codeMode || out.orchestrator || hasLegacyKeys(raw) ? out : null;
}

/** Whether config.json still names a retired key (its next save drops them). */
export const hasLegacyKeys = (raw: unknown): boolean => {
  const r = obj(raw), oc = obj(r?.orchestratorChats);
  return !!r && ('modelTiers' in r || 'codeMode' in r || 'balancedMode' in r || !!oc && ['claudeModel', 'cursorModel', 'claudeEffort', 'cursorReasoning', 'cursorFast'].some(k => k in oc));
};

/** Kept beside config.json until the cards took them (never overwritten: the first capture is the user's values). */
export function writeLegacy(userData: string, legacy: LegacyModelSettings): void {
  const file = path.join(userData, LEGACY_FILE);
  if (fs.existsSync(file) || fs.existsSync(path.join(userData, LEGACY_MARK))) return;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
}

/** The captured values, or null when there are none or the cards already took them. The file holds the captured shape
 *  (`orchestrator`, not config.json's `orchestratorChats`): read back through the same checks as config.json. */
export function readLegacy(userData: string): LegacyModelSettings | null {
  if (fs.existsSync(path.join(userData, LEGACY_MARK))) return null;
  try {
    const captured = obj(JSON.parse(fs.readFileSync(path.join(userData, LEGACY_FILE), 'utf8')));
    if (!captured) return null;
    // a capture that held only the old defaults is `{}`: still a move (the cards get the registry's models)
    return legacyOf({ modelTiers: captured.modelTiers, codeMode: captured.codeMode, orchestratorChats: captured.orchestrator }) ?? {};
  } catch { return null; }
}

/** Marks the move done (the captured file stays as a record of what moved). */
export function markLegacyDone(userData: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, LEGACY_MARK), `${new Date().toISOString()}\n`);
}

const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies readonly Effort[];
const effortOf = (v: string | undefined): Effort | undefined => (v && EFFORTS.includes(v) ? v as Effort : undefined);

/** The cards after the move: only the ones it changed. `tierModel(engine, tier, overrides)` = what a tier resolved to
 *  with the old Settings (model-tier.ts). A card the user already gave a model keeps it; the Orchestrator never gets
 *  Code Mode. Only run when config.json had a retired key (an install from today on has nothing to move). */
export function migratedCards(profiles: readonly AgentProfile[], legacy: LegacyModelSettings, tierModel: (engine: Harness, tier: ModelTier, overrides?: ModelTiers) => string | null): AgentProfile[] {
  const out: AgentProfile[] = [];
  for (const p of profiles) {
    let next: AgentProfile = p;
    const o = legacy.orchestrator;
    if (p.id === 'orchestrator' && o) {
      const engine = (o.harness ?? p.engine) as Harness;
      const model = engine === 'claude' ? o.claudeModel : engine === 'cursor' ? o.cursorModel : undefined;
      const effort = effortOf(engine === 'claude' ? o.claudeEffort : engine === 'cursor' ? o.cursorReasoning : undefined);
      if (next.model === null && (model || effort || (engine === 'cursor' && o.cursorFast))) {
        // the card moves to the engine the Orchestrator runs on: its presets lived on its old engine (ADR 0336)
        const moved = engine !== p.engine;
        next = { ...next, engine, ...(moved ? { presets: undefined } : {}), model: model ?? null,
          ...(effort ? { effort } : moved ? { effort: undefined } : {}), ...(engine === 'cursor' && o.cursorFast ? { fast: true } : {}) };
      }
    }
    // a card with no model gets the one its tier resolved to before the move (the old Settings' pick, else the registry's)
    if (next.model === null) {
      const before = tierModel(next.engine, next.tier, legacy.modelTiers);
      if (before) next = { ...next, model: before };
    }
    if (legacy.codeMode && p.id !== 'orchestrator' && next.codeMode !== true) next = { ...next, codeMode: true };
    if (next !== p) out.push(next);
  }
  return out;
}
