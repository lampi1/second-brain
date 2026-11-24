// Several models per level, across engines (owner, 2026-11-24, ADR 0347): a role card keeps, for each of its three levels
// (Minimo / Base / Massimo, the presets of ADR 0336), an ordered list of models, each on its own engine. The order is
// the user's: the first is the best for that role. When a chat starts, the app takes the first model of the level whose
// engine is on and whose plan still has room; a model whose plan is spent, or would run out before it renews at the
// pace of now, is skipped while another one has room (the old «Balanced mode», ADR 0218, is gone: this is always on).
// A card without lists reads as today's: one model per level on the card's engine (cardPresets), so no file migration.
// Pure: used by main (agents/catalog.ts resolve and save, the room of each engine from the usage panel and the credit
// book) and by the renderer (the role page's level rows), tested in test/unit/shared/model-levels.test.ts.
import type { Effort, Harness, HarnessUsage, HarnessUsageWindow } from './contract';
import { CARD_MODEL, PRESET_IDS, type FullPresets, type PresetId } from './model-presets';

/** One model of a level: its engine, the model id (null = the engine's own default), the effort. */
export interface LevelModel { engine: Harness; model: string | null; effort?: Effort }
/** What a card stores: an ordered list per level; a level absent or empty = the card's own preset on its engine. */
export type RoleLevels = Partial<Record<PresetId, LevelModel[]>>;
export type FullLevels = Record<PresetId, LevelModel[]>;
/** At most this many models in one level: a short list stays readable. */
export const LEVEL_MAX = 8;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const ENGINE = /^[a-z][a-z0-9_-]{0,59}$/;

/** A stored or edited levels value, checked: only the three levels, each a list of { engine, model, effort? }, no
 *  duplicate engine + model in one level. Throws. Empty = undefined (the card's own presets). */
export function checkedLevels(v: unknown): RoleLevels | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Livelli non validi: { min?, base?, max? }.');
  const out: RoleLevels = {};
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (!(PRESET_IDS as readonly string[]).includes(k)) throw new Error(`Livelli non validi: «${k}» non è un livello (min, base, max).`);
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list) || list.length > LEVEL_MAX) throw new Error(`Livello ${k}: una lista di al massimo ${LEVEL_MAX} modelli.`);
    const seen = new Set<string>();
    const items = list.map((x, i): LevelModel => {
      if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(f => f !== 'engine' && f !== 'model' && f !== 'effort')) throw new Error(`Livello ${k}, modello ${i + 1}: { engine, model, effort? }.`);
      const { engine, model, effort } = x as Record<string, unknown>;
      if (typeof engine !== 'string' || !ENGINE.test(engine)) throw new Error(`Livello ${k}, modello ${i + 1}: motore non valido.`);
      if (!(model === null || typeof model === 'string' && CARD_MODEL.test(model))) throw new Error(`Livello ${k}, modello ${i + 1}: modello non valido.`);
      if (effort !== undefined && effort !== null && !EFFORTS.includes(effort as Effort)) throw new Error(`Livello ${k}, modello ${i + 1}: effort non valido.`);
      const key = `${engine}\u0000${model ?? ''}`;
      if (seen.has(key)) throw new Error(`Livello ${k}: ${model ?? 'il predefinito'} su ${engine} è già nella lista.`);
      seen.add(key);
      return { engine, model: model as string | null, ...(typeof effort === 'string' ? { effort: effort as Effort } : {}) };
    });
    if (items.length) out[k as PresetId] = items;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The three lists a card really has: its own list for a level, else its preset of that level on its engine. */
export function levelsOf(card: { engine: Harness; levels?: RoleLevels }, presets: FullPresets): FullLevels {
  const own = (id: PresetId): LevelModel[] => card.levels?.[id]?.length ? card.levels[id]!.map(x => ({ ...x }))
    : [{ engine: card.engine, model: presets[id].model, ...(presets[id].effort ? { effort: presets[id].effort } : {}) }];
  return { min: own('min'), base: own('base'), max: own('max') };
}

/** The first model of each level as the card's presets (the price ceiling of a delegation, ADR 0336, reads these). */
export function headPresets(levels: FullLevels): FullPresets {
  const head = (id: PresetId) => { const x = levels[id][0]!; return { model: x.model, ...(x.effort ? { effort: x.effort } : {}) }; };
  return { min: head('min'), base: head('base'), max: head('max') };
}

/** How much an engine's plan has left now: ok, `pace` (at today's pace it ends before it renews), `out` (spent), or
 *  unknown (nothing readable: Cursor Enterprise, an engine with no usage reading). */
export interface Room { state: 'ok' | 'pace' | 'out' | 'unknown'; why: string; resetsAt: number | null }
const HOUR = 3600e3;
const WINDOW_MS: Partial<Record<HarnessUsageWindow['kind'], number>> = { 'five-hour': 5 * HOUR, daily: 24 * HOUR, weekly: 7 * 24 * HOUR, plan: 30 * 24 * HOUR };
/** At or above this a window counts as spent. */
export const SPENT_PCT = 98;

const fmtLeft = (ms: number): string => ms >= 24 * HOUR ? `${Math.floor(ms / (24 * HOUR))}g ${Math.floor(ms % (24 * HOUR) / HOUR)}h` : ms >= HOUR ? `${Math.floor(ms / HOUR)}h ${Math.floor(ms % HOUR / 60e3)}m` : `${Math.max(1, Math.round(ms / 60e3))}m`;

/** One engine's room from its usage reading (the usage panel, ADR 0334) and whether the app saw it hit its limit (the
 *  credit book's limit signal, ADR 0218 §1). Pace: the share used against the share of the window gone by; a window
 *  used under half never counts as pace, and neither does one with less than a tenth of its time gone (too early). */
export function roomOf(usage: HarnessUsage | undefined, hitLimit: { until: number | null } | null, now: number): Room {
  if (hitLimit && (hitLimit.until === null || hitLimit.until > now)) return { state: 'out', why: hitLimit.until ? `limite finito, riparte tra ${fmtLeft(hitLimit.until - now)}` : 'limite finito', resetsAt: hitLimit.until };
  if (!usage || usage.status !== 'ok' || !usage.windows.length) return { state: 'unknown', why: usage?.message ? 'limite non letto' : 'limite non letto', resetsAt: null };
  let worst: Room = { state: 'ok', why: '', resetsAt: null };
  for (const w of usage.windows) {
    if (w.kind === 'spend' || w.model) continue; // on-demand money and model-scoped windows do not stop the plan
    const left = w.resetsAt !== null ? w.resetsAt - now : null;
    if (w.usedPercent >= SPENT_PCT) return { state: 'out', why: `${w.label} al ${Math.round(w.usedPercent)}%${left !== null && left > 0 ? `, riparte tra ${fmtLeft(left)}` : ''}`, resetsAt: w.resetsAt };
    const span = WINDOW_MS[w.kind];
    if (span && left !== null && left > 0 && w.usedPercent >= 50) {
      const gone = Math.min(1, Math.max(0, (span - left) / span));
      if (gone >= 0.1 && w.usedPercent / gone > 100 && worst.state === 'ok') worst = { state: 'pace', why: `${w.label} al ${Math.round(w.usedPercent)}% con ${fmtLeft(left)} al rinnovo: a questo ritmo finisce prima`, resetsAt: w.resetsAt };
    }
  }
  if (worst.state === 'ok') {
    const top = usage.windows.filter(w => w.kind !== 'spend' && !w.model).reduce<HarnessUsageWindow | null>((a, w) => !a || w.usedPercent > a.usedPercent ? w : a, null);
    worst = { state: 'ok', why: top ? `${top.label} al ${Math.round(top.usedPercent)}%` : '', resetsAt: top?.resetsAt ?? null };
  }
  return worst;
}

/** One candidate the pick looked at, and why it was or was not taken. */
export interface Considered { at: LevelModel; room: Room; usable: boolean; unusable?: string }
export interface LevelPick { chosen: LevelModel; considered: Considered[]; reason: string }

/** The model a level starts on: the first usable one with room (ok or unknown); else the first usable one on pace;
 *  else the first usable one (spent: it starts, hits its limit and the chat waits, #462). No usable model = null. */
export function pickInLevel(list: readonly LevelModel[], usable: (x: LevelModel) => string | null, room: (x: LevelModel) => Room): LevelPick | null {
  const considered: Considered[] = list.map(at => { const why = usable(at); return { at, room: room(at), usable: why === null, ...(why ? { unusable: why } : {}) }; });
  const ok = considered.filter(c => c.usable);
  if (!ok.length) return null;
  const take = ok.find(c => c.room.state === 'ok' || c.room.state === 'unknown') ?? ok.find(c => c.room.state === 'pace') ?? ok[0]!;
  const skipped = considered.filter(c => c !== take && considered.indexOf(c) < considered.indexOf(take));
  const name = (c: Considered) => `${c.at.model ?? 'predefinito'} (${c.at.engine})`;
  const reason = [
    `${name(take)}${take.room.why ? `: ${take.room.why}` : ''}`,
    ...skipped.map(c => `saltato ${name(c)}: ${c.unusable ?? c.room.why}`),
    ...(take.room.state === 'out' ? ['tutti i modelli del livello hanno finito il limite'] : []),
  ].join(' · ');
  return { chosen: take.at, considered, reason };
}

/** Which level and position of a card a model is (the user's own pick of a model for one run, ADR 0296). */
export function levelNamed(levels: FullLevels, model: string, engine?: Harness): { preset: PresetId; at: LevelModel } | null {
  for (const id of ['base', 'max', 'min'] as const) {
    const at = levels[id].find(x => x.model === model && (!engine || x.engine === engine));
    if (at) return { preset: id, at };
  }
  return null;
}

/** The engines a card can run on, in order of first appearance (the card back shows them as marks). */
export function levelEngines(levels: FullLevels): Harness[] {
  return [...new Set(PRESET_IDS.flatMap(id => levels[id].map(x => x.engine)))];
}
