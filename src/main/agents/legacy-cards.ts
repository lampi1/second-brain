// One-off move of the retired model Settings onto the role cards (2026-11-23, the owner: the preset is chosen «solo ed
// esclusivamente dalle card degli agenti oppure che lo setti l'orchestrator, non dalle impostazioni»; Code Mode per
// role, on every engine). What moves: the per-tier models (modelTiers.*) become the model of each card that named none;
// the global Code Mode switch goes to every work role; the Orchestrator's «Chat aperte dall'Orchestrator» model, effort,
// Cursor reasoning and fast go to the Orchestrator's card (its engine stays the setting orchestratorChats.harness); the
// last two, which applied to every Cursor chat, also to the work cards on Cursor. A value out of shape is left out: a
// card holding one would make the whole catalog unreadable at the next start. brain/config.ts captures the old values from config.json into userData/legacy-model-settings.json before it drops
// them (legacyOf, writeLegacy); wiring.ts applies them once (catalog.migrateLegacy, a marker file). Pure but for the
// two file helpers; tests: test/unit/agents/legacy-cards.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Harness } from '../../shared/contract';
import type { AgentProfile } from '../../shared/agents';
import { CARD_MODEL, type ModelPreset } from '../../shared/model-presets';
import { MODEL_TIERS, type ModelTier } from '../../shared/roles';
import { ENGINE_ID, REMOVED_ENGINES } from '../engines/registry';
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
const modelOf = (v: unknown): string | undefined => { const m = str(v); return m && CARD_MODEL.test(m) ? m : undefined; };
const engineIdOf = (v: unknown): string | undefined => { const e = str(v); return e && ENGINE_ID.test(e) && !REMOVED_ENGINES.has(e) ? e : undefined; };
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies readonly Effort[];
const effortOf = (v: unknown): Effort | undefined => { const e = str(v); return e && EFFORTS.includes(e) ? e as Effort : undefined; };
/** The check of each text value of orchestratorChats: one that fails it is left out. */
const TEXTS = { harness: engineIdOf, claudeModel: modelOf, cursorModel: modelOf, claudeEffort: effortOf, cursorReasoning: effortOf } as const;

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
      for (const tier of MODEL_TIERS) { const m = modelOf(o[tier]); if (m) row[tier] = m; }
      if (Object.keys(row).length) t[engine as Harness] = row;
    }
    if (Object.keys(t).length) out.modelTiers = t;
  }
  if (r.codeMode === true) out.codeMode = true;
  const oc = obj(r.orchestratorChats);
  if (oc) {
    const o: NonNullable<LegacyModelSettings['orchestrator']> = {};
    for (const k of Object.keys(TEXTS) as (keyof typeof TEXTS)[]) { const v = TEXTS[k](oc[k]); if (v) o[k] = v; }
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

/** The effort and fast a card has none of; null = it has them (nothing to change). A preset with no effort of its own
 *  ran at Cursor's reasoning too. */
function withEffort(p: AgentProfile, effort: Effort | undefined, fast: boolean, presets = false): AgentProfile | null {
  const patch: Partial<AgentProfile> = { ...(effort && !p.effort ? { effort } : {}), ...(fast && !p.fast ? { fast: true } : {}) };
  if (effort && presets && p.presets) {
    const own = (x: ModelPreset | undefined): ModelPreset | undefined => (x && !x.effort ? { ...x, effort } : x);
    const { min, max } = { min: own(p.presets.min), max: own(p.presets.max) };
    if (min !== p.presets.min || max !== p.presets.max) patch.presets = { ...(min ? { min } : {}), ...(max ? { max } : {}) };
  }
  return Object.keys(patch).length ? { ...p, ...patch } : null;
}

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
      const fast = engine === 'cursor' && o.cursorFast === true;
      // a card already on that engine keeps its own model, effort and fast, and takes the ones it has none of
      if (engine === p.engine) {
        if (model && p.model === null) next = { ...p, model };
        next = withEffort(next, effort, fast) ?? next;
      }
      // else the card moves to the engine the Orchestrator runs on, unless it names a model of its own engine: its
      // presets, effort and fast lived on its old engine (ADR 0336)
      else if (p.model === null && (model || effort || fast)) next = { ...p, engine, model: model ?? null, presets: undefined, effort, fast: fast || undefined };
    }
    // Cursor's reasoning and fast applied to every Cursor chat, whatever its role
    if (p.id !== 'orchestrator' && o && p.engine === 'cursor') next = withEffort(next, effortOf(o.cursorReasoning), o.cursorFast === true, true) ?? next;
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
