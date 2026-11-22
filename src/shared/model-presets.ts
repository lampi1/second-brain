// Per-task model presets of a role (plan «Modello per compito», owner 2026-11-22, ADR 0336). A role card has three
// presets on its one engine: Minimo, Base, Massimo, each a model and an effort; Base is the card's own model and effort,
// Minimo and Massimo are optional (absent = the Base). Whoever delegates (app_create_chat, agent_delegate,
// agent_assign_task) picks one of the three with a one-line reason; the guards here keep that pick honest: only the three
// presets, no reason = Base (with a warning), and never a preset priced above the delegator's own model (one price per
// token from the one price table, harness/models.json, across engines too): above it the highest allowed preset, said
// in a warning. No automatic escalation: a failed task is the delegator's decision. Pure: used by main
// (agents/catalog.ts resolve and save, agents/balanced-mode.ts, agents/delegation.ts, appctl/tools.ts), the renderer
// (RolePresets.tsx) and the tests (test/unit/agents/model-presets.test.ts).
import type { Effort } from './contract';
import { tierRank, type ModelTier } from './roles';

export const PRESET_IDS = ['min', 'base', 'max'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const isPresetId = (v: unknown): v is PresetId => typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
/** One preset: a model of the role's engine (null only on Base: the model of the role's tier) and its effort. */
export interface ModelPreset { model: string | null; effort?: Effort }
/** What a card stores besides its Base (the card's model and effort): absent = the Base. */
export interface RolePresets { min?: ModelPreset; max?: ModelPreset }
export type FullPresets = Record<PresetId, ModelPreset>;
export const PRESET_WHY_MAX = 200;
export const TASK_KIND_MAX = 60;
const EFFORT_IDS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

/** The three presets of a card: Base = its model (else `tierModel`, the model of its tier) and effort; Minimo and
 *  Massimo = their own, else the Base. */
export function cardPresets(card: { model: string | null; effort?: Effort; presets?: RolePresets }, tierModel: string | null = null): FullPresets {
  const base: ModelPreset = { model: card.model ?? tierModel, ...(card.effort ? { effort: card.effort } : {}) };
  const own = (p: ModelPreset | undefined): ModelPreset => p ? { model: p.model, ...(p.effort ? { effort: p.effort } : {}) } : { ...base };
  return { min: own(card.presets?.min), base, max: own(card.presets?.max) };
}

/** A stored or edited presets value, checked: only min and max, each a model id and an optional effort. Throws. */
export function checkedPresets(v: unknown): RolePresets | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Preset non validi: { min?, max? }.');
  const o = v as Record<string, unknown>;
  const extra = Object.keys(o).find(k => k !== 'min' && k !== 'max');
  if (extra) throw new Error(`Preset non validi: «${extra}» non è un preset (min, max; il base è il modello della scheda).`);
  const out: RolePresets = {};
  for (const id of ['min', 'max'] as const) {
    const p = o[id];
    if (p === undefined || p === null) continue;
    if (typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => k !== 'model' && k !== 'effort')) throw new Error(`Preset ${id}: { model, effort? }.`);
    const { model, effort } = p as Record<string, unknown>;
    if (typeof model !== 'string' || !MODEL.test(model)) throw new Error(`Preset ${id}: un modello del motore del ruolo.`);
    if (effort !== undefined && effort !== null && !(EFFORT_IDS as readonly unknown[]).includes(effort)) throw new Error(`Preset ${id}: effort non valido.`);
    out[id] = { model, ...(typeof effort === 'string' ? { effort: effort as Effort } : {}) };
  }
  return out.min || out.max ? out : undefined;
}

/** One price per token of a model (input + output, USD per million), null = not in the price table. */
export type UnitPrice = (model: string) => number | null;

/** Saving a card: Minimo <= Base <= Massimo by price, when the prices are known. Null = fine, else the reason. */
export function presetOrderProblem(p: FullPresets, price: UnitPrice): string | null {
  const of = (x: ModelPreset) => x.model ? price(x.model) : null;
  const [min, base, max] = [of(p.min), of(p.base), of(p.max)];
  if (min !== null && base !== null && min > base) return 'Il preset Minimo costa più del Base.';
  if (max !== null && base !== null && max < base) return 'Il preset Massimo costa meno del Base.';
  if (min !== null && max !== null && min > max) return 'Il preset Minimo costa più del Massimo.';
  return null;
}

/** What a delegation asks: one of the three presets, why in one line, and a short label of the task. */
export interface PresetAsk { preset?: PresetId; presetWhy?: string; taskKind?: string }

/** The old request field `tier` (light / mid / top) as a preset: below the card's tier = Minimo, the same = Base, above
 *  = Massimo. Kept so older prompts still work; `preset` is the field now. */
export const presetOfTier = (asked: ModelTier, card: ModelTier): PresetId => tierRank(asked) < tierRank(card) ? 'min' : tierRank(asked) > tierRank(card) ? 'max' : 'base';

/** The preset fields of a tool call, checked: only the three presets, presetWhy one line, taskKind a short label. The
 *  old `tier` is read as its preset (presetOfTier) when no preset is given; both together are refused. Throws. */
export function presetAskOf(a: Record<string, unknown>, where = '', tierAlias?: { tier: unknown; card: ModelTier }): PresetAsk {
  const at = (k: string) => where ? `${where}.${k}` : k;
  if (a.preset !== undefined && !isPresetId(a.preset)) throw new Error(`${at('preset')}: one of ${PRESET_IDS.join(' | ')} (the role's card presets; no other model).`);
  const oneLine = (v: unknown, k: string, max: number): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || /[\r\n]/.test(v) || v.trim().length > max) throw new Error(`${at(k)}: one line, at most ${max} characters.`);
    return v.trim() || undefined;
  };
  const presetWhy = oneLine(a.presetWhy, 'presetWhy', PRESET_WHY_MAX), taskKind = oneLine(a.taskKind, 'taskKind', TASK_KIND_MAX);
  let preset = a.preset as PresetId | undefined;
  if (tierAlias && tierAlias.tier !== undefined) {
    if (preset !== undefined) throw new Error(`${at('tier')} and ${at('preset')}: pass only preset (tier is its old name).`);
    if (tierAlias.tier !== 'light' && tierAlias.tier !== 'mid' && tierAlias.tier !== 'top') throw new Error(`${at('tier')}: light | mid | top (old name of preset).`);
    preset = presetOfTier(tierAlias.tier, tierAlias.card);
  }
  return { ...(preset ? { preset } : {}), ...(presetWhy ? { presetWhy } : {}), ...(taskKind ? { taskKind } : {}) };
}

/** Who delegates: its role and the model its own chat runs on (null = the engine's default: unknown price). */
export interface Delegator { role?: string; model: string | null }

/** The preset a run starts on, with what decided it (the per-run record) and what the delegator must read. */
export interface PresetChoice {
  preset: PresetId; model: string | null; effort?: Effort;
  /** what the delegator asked, when it differs from the preset used */
  asked?: PresetId;
  presetWhy?: string; taskKind?: string; delegatorRole?: string;
  /** said in the tool's result: a preset taken down, a missing reason, a ceiling that could not be checked */
  warnings: string[];
}

/** The preset part of a run's record (AgentRun.presetChoice): what ran and what decided it, no model (the run has it). */
export interface RunPresetChoice { preset: PresetId; effort?: Effort; asked?: PresetId; presetWhy?: string; taskKind?: string; delegatorRole?: string }

/** A choice as the run keeps it. */
export function runPresetOf(c: PresetChoice): RunPresetChoice {
  return { preset: c.preset, ...(c.effort ? { effort: c.effort } : {}), ...(c.asked ? { asked: c.asked } : {}), ...(c.presetWhy ? { presetWhy: c.presetWhy } : {}),
    ...(c.taskKind ? { taskKind: c.taskKind } : {}), ...(c.delegatorRole ? { delegatorRole: c.delegatorRole } : {}) };
}

const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\r\n]/.test(v);
/** A stored run's preset record, read back: undefined when absent or malformed (the run itself stays readable). */
export function readRunPreset(v: unknown): RunPresetChoice | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (!isPresetId(r.preset) || (r.asked !== undefined && !isPresetId(r.asked)) || (r.effort !== undefined && !EFFORT_IDS.includes(r.effort as Effort))
    || (r.presetWhy !== undefined && !shortText(r.presetWhy, PRESET_WHY_MAX)) || (r.taskKind !== undefined && !shortText(r.taskKind, TASK_KIND_MAX))
    || (r.delegatorRole !== undefined && !shortText(r.delegatorRole, 40))) return undefined;
  return runPresetOf({ ...(r as unknown as RunPresetChoice), model: null, warnings: [] });
}

const DOWN: readonly PresetId[] = ['max', 'base', 'min'];

/** The preset a delegation really runs on: missing = Base; not Base without presetWhy = Base and a warning; above the
 *  delegator's own model by price = the highest preset that is not (else Minimo), said in a warning. A preset or a
 *  delegator whose price is unknown is not capped (said when it matters). No escalation ever happens here. */
export function choosePreset(a: { presets: FullPresets; ask: PresetAsk; delegator?: Delegator; price: UnitPrice }): PresetChoice {
  const warnings: string[] = [];
  const asked = a.ask.preset ?? 'base';
  let preset: PresetId = asked;
  if (preset !== 'base' && !a.ask.presetWhy) {
    warnings.push(`preset ${preset} without presetWhy: base used (pass presetWhy, one line, to use another preset).`);
    preset = 'base';
  }
  const own = a.delegator?.model ?? null;
  const cap = own ? a.price(own) : null;
  const cost = (id: PresetId): number | null => { const m = a.presets[id].model; return m ? a.price(m) : null; };
  if (cap !== null) {
    const below = DOWN.slice(DOWN.indexOf(preset));
    const fits = below.find(id => { const c = cost(id); return c === null || c <= cap; });
    const used = fits ?? 'min';
    if (used !== preset) {
      warnings.push(`preset ${preset} (${a.presets[preset].model}) costs more than your own model ${own}: ${fits ? used : 'min (the cheapest)'} used (${a.presets[used].model}).`);
      preset = used;
    }
    if (cost(preset) === null && a.presets[preset].model) warnings.push(`preset ${preset}: ${a.presets[preset].model} has no price in harness/models.json, the ceiling was not checked.`);
  } else if (preset !== 'base' && preset === asked && cost(preset) !== null) {
    warnings.push(`preset ${preset}: your own model${own ? ` ${own}` : ''} has no known price, the ceiling was not checked.`);
  }
  const p = a.presets[preset];
  return { preset, model: p.model, ...(p.effort ? { effort: p.effort } : {}), ...(asked !== preset ? { asked } : {}),
    ...(a.ask.presetWhy ? { presetWhy: a.ask.presetWhy } : {}), ...(a.ask.taskKind ? { taskKind: a.ask.taskKind } : {}),
    ...(a.delegator?.role ? { delegatorRole: a.delegator.role } : {}), warnings };
}

/** The presets a pick may come from (Balanced mode, the user's own model): Minimo up to `upTo`, in that order. */
export const presetsUpTo = (upTo: PresetId): PresetId[] => PRESET_IDS.slice(0, PRESET_IDS.indexOf(upTo) + 1);

/** The preset a named model (and effort) is, among `ids`: the exact effort first, else the first with that model. */
export function presetNamed(p: FullPresets, model: string, effort: Effort | undefined, ids: readonly PresetId[] = PRESET_IDS): PresetId | null {
  const same = ids.filter(id => p[id].model === model);
  return same.find(id => effort !== undefined && p[id].effort === effort) ?? same[0] ?? null;
}
