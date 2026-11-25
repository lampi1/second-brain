// Per-task model presets of a role (plan «Modello per compito», owner 2026-11-22, ADR 0336). A role card has three
// presets on its one engine: Minimo, Base, Massimo, each a model and an effort; Base is the card's own model and effort,
// Minimo and Massimo are optional (absent = the Base). Whoever delegates (app_create_chat, agent_delegate,
// agent_assign_task) picks one of the three with a one-line reason; the guards here keep that pick honest: only the three
// presets, no reason = Base (with a warning), and never a preset priced above the delegator's own model (one price per
// token from the one price table, harness/models.json, across engines too): above it the highest allowed preset, said
// in a warning. No automatic escalation: a failed task is the delegator's decision. Pure: used by main
// (agents/catalog.ts resolve and save, agents/delegation.ts, appctl/tools.ts), the renderer
// (RolePresets.tsx) and the tests (test/unit/agents/model-presets.test.ts).
import type { SkipNote } from './model-levels';
import type { Effort } from './contract';

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
/** The shape of a model id a card may hold (agents/catalog.ts refuses to read any other). */
export const CARD_MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

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
    if (typeof model !== 'string' || !CARD_MODEL.test(model)) throw new Error(`Preset ${id}: un modello del motore del ruolo.`);
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

/** The preset fields of a tool call, checked: only the three presets, presetWhy one line, taskKind a short label.
 *  The old `tier` field is gone (owner, 2026-11-23): the callers refuse it. Throws. */
export function presetAskOf(a: Record<string, unknown>, where = ''): PresetAsk {
  const at = (k: string) => where ? `${where}.${k}` : k;
  if (a.preset !== undefined && !isPresetId(a.preset)) throw new Error(`${at('preset')}: one of ${PRESET_IDS.join(' | ')} (the role's card presets; no other model).`);
  const oneLine = (v: unknown, k: string, max: number): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || /[\r\n]/.test(v) || v.trim().length > max) throw new Error(`${at(k)}: one line, at most ${max} characters.`);
    return v.trim() || undefined;
  };
  const presetWhy = oneLine(a.presetWhy, 'presetWhy', PRESET_WHY_MAX), taskKind = oneLine(a.taskKind, 'taskKind', TASK_KIND_MAX);
  const preset = a.preset as PresetId | undefined;
  return { ...(preset ? { preset } : {}), ...(presetWhy ? { presetWhy } : {}), ...(taskKind ? { taskKind } : {}) };
}

/** What a part of an approved plan asks (ADR 0346): its own preset, else its step's (the one the user approved on the
 *  map). The model behind it is never the plan's: the role's card gives it when the part starts. */
export function stepAsk(ask: PresetAsk, planned: PresetId | undefined): PresetAsk {
  if (ask.preset || !planned || planned === 'base') return ask;
  return { ...ask, preset: planned, presetWhy: ask.presetWhy ?? 'the preset of the approved plan step' };
}

/** Who delegates: its role and the model its own chat runs on (null = the engine's default: unknown price). */
export interface Delegator { role?: string; model: string | null }

/** The preset a run starts on, with what decided it (the per-run record) and what the delegator must read. */
export interface PresetChoice {
  preset: PresetId; model: string | null; effort?: Effort;
  /** the engine of the model the level's list gave (ADR 0347); absent = the card's own engine */
  engine?: string;
  /** why that model of the level (its room, the ones skipped), one line (ADR 0347) */
  route?: string;
  /** the models of the level passed over before it, each with its reason, source, reading time and expected end (ADR 0354) */
  skipped?: SkipNote[];
  /** every model of the level is out: it starts on the first all the same (a launch), the nearest return is in route */
  allOut?: true;
  /** with allOut: each usable model of the level and its room (the waiting chat says which are out and until when) */
  rooms?: { engine: string; model: string | null; why: string; until: number | null }[];
  /** what the delegator asked, when it differs from the preset used */
  asked?: PresetId;
  presetWhy?: string; taskKind?: string; delegatorRole?: string;
  /** said in the tool's result: a preset taken down, a missing reason, a ceiling that could not be checked */
  warnings: string[];
}

/** The preset part of a run's record (AgentRun.presetChoice): what ran and what decided it, no model (the run has it). */
export interface RunPresetChoice { preset: PresetId; effort?: Effort; asked?: PresetId; presetWhy?: string; taskKind?: string; delegatorRole?: string;
  /** which engine it started on and why, one line (ADR 0357: «OpenAI Sol: primo disponibile») */
  route?: string }
export const ROUTE_MAX = 400;
/** How a route ends when the user named the model for that work: «Riprendi» and reuse keep it. */
export const USER_ASKED = 'chiesto da te per questo lavoro';

/** A choice as the run keeps it. */
export function runPresetOf(c: PresetChoice): RunPresetChoice {
  return { preset: c.preset, ...(c.effort ? { effort: c.effort } : {}), ...(c.asked ? { asked: c.asked } : {}), ...(c.presetWhy ? { presetWhy: c.presetWhy } : {}),
    ...(c.taskKind ? { taskKind: c.taskKind } : {}), ...(c.delegatorRole ? { delegatorRole: c.delegatorRole } : {}), ...(c.route ? { route: c.route.slice(0, ROUTE_MAX) } : {}) };
}

const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\r\n]/.test(v);
/** A stored run's preset record, read back: undefined when absent or malformed (the run itself stays readable). */
export function readRunPreset(v: unknown): RunPresetChoice | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (!isPresetId(r.preset) || (r.asked !== undefined && !isPresetId(r.asked)) || (r.effort !== undefined && !EFFORT_IDS.includes(r.effort as Effort))
    || (r.presetWhy !== undefined && !shortText(r.presetWhy, PRESET_WHY_MAX)) || (r.taskKind !== undefined && !shortText(r.taskKind, TASK_KIND_MAX))
    || (r.delegatorRole !== undefined && !shortText(r.delegatorRole, 40)) || (r.route !== undefined && !shortText(r.route, ROUTE_MAX))) return undefined;
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
    } else if (!fits) {
      // already at Minimo and still above the ceiling: nothing cheaper on the card, said all the same
      warnings.push(`preset ${preset} (${a.presets[preset].model}) costs more than your own model ${own}: it is the cheapest preset of the card, used anyway.`);
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

/** The preset a named model (and effort) is, among `ids`: the exact effort first, else the first with that model.
 *  Presets equal in model and effort are one preset: Base when it is one of them (an empty Minimo or Massimo is a copy
 *  of Base, so a Base pick is never recorded as Minimo), else the last of them. */
export function presetNamed(p: FullPresets, model: string, effort: Effort | undefined, ids: readonly PresetId[] = PRESET_IDS): PresetId | null {
  const same = ids.filter(id => p[id].model === model);
  const first = same.find(id => effort !== undefined && p[id].effort === effort) ?? same[0];
  if (!first) return null;
  const twins = same.filter(id => p[id].effort === p[first].effort);
  return twins.includes('base') ? 'base' : twins[twins.length - 1]!;
}
