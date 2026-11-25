// Several models per level, across engines (owner, 2026-11-24, ADR 0347): a role card keeps, for each of its three levels
// (Minimo / Base / Massimo, the presets of ADR 0336), an ordered list of models, each on its own engine. The order is
// the user's: the first is the best for that role. When a chat starts, the app takes the first model of the level whose
// engine is connected and whose plan still has room. With an engine order (ADR 0361) the order decides which engine comes
// first and a plan past the user's threshold is skipped while another has room; without an order a plan that would run
// out before it renews at the pace of now is skipped too (ADR 0347). Every plan spent: the launch says
// so and the chat waits (ADR 0354).
// A card without lists reads as today's: one model per level on the card's engine (cardPresets), so no file migration.
// Pure: used by main (agents/catalog.ts resolve and save, the room of each engine from the usage panel and the credit
// book) and by the renderer (the role page's level rows), tested in test/unit/shared/model-levels.test.ts.
import type { Effort, Harness } from './contract';
import { CARD_MODEL, PRESET_IDS, type FullPresets, type PresetId } from './model-presets';
import { inOrder } from './engine-order';
import { SPENT_PCT, clock, type CreditSource, type CreditVerdict } from './credit-rule';

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

/** How much an engine's plan has left now, as a level's pick reads it: the one rule's verdict (shared/credit-rule.ts,
 *  ADR 0354) mapped to ok · pace · over · out · probation · unknown, with its reason, source and expected end. `over`: past the
 *  threshold the user gave that engine (ADR 0361). */
export interface Room { state: 'ok' | 'pace' | 'over' | 'out' | 'probation' | 'unknown'; why: string; resetsAt: number | null; source?: CreditSource; readingAt?: number | null }
export { SPENT_PCT };

/** A verdict of the one rule as a level's room: no rule of its own here. `past` = why the plan is past the user's
 *  threshold (engine-order.ts pastThreshold): it turns a plan that still has credit into `over`, never a spent one. */
export function roomOf(v: CreditVerdict, past: string | null = null): Room {
  if (past && (v.state === 'free' || v.state === 'pace')) return { state: 'over', why: past, resetsAt: v.until, source: v.source, readingAt: v.readingAt };
  return { state: v.state === 'free' ? 'ok' : v.state, why: v.why, resetsAt: v.until, source: v.source, readingAt: v.readingAt };
}

/** One candidate the pick looked at, and why it was or was not taken. */
export interface Considered { at: LevelModel; room: Room; usable: boolean; unusable?: string }
/** A model the pick passed over, as the chat and the tools' answers tell it (ADR 0354). `kind`: off = the engine is off
 *  or refused (not a credit matter), price = above the delegator's model, credit = its plan has no room now. */
export interface SkipNote { engine: Harness; model: string | null; kind: 'off' | 'price' | 'credit'; why: string; state?: Room['state']; source?: CreditSource; readingAt?: number | null; until?: number | null }
/** How the reasons name a model and its engine, and the engine order that decides (ADR 0361; empty = the list's own). */
export interface PickWords { model?: (x: LevelModel) => string; engine?: (x: LevelModel) => string; order?: readonly Harness[]; now?: number; fmt?: (at: number) => string }
export interface LevelPick { chosen: LevelModel; considered: Considered[]; reason: string; skipped: SkipNote[]; allOut: boolean }

const PRICE_WORDS = /^costa più/;
/** Why a candidate was passed over, in the few words a chat shows. */
const passed = (c: Considered): string => c.unusable ?? (c.room.state === 'out' ? 'al limite' : c.room.state === 'over' ? 'oltre la soglia' : c.room.state === 'pace' ? 'sta per finire il limite' : 'non scelto');

/** The model a level starts on: in the engine order (else the list's), the first usable one with room (ok, probation or
 *  unknown; with an order also one on pace: the user's threshold says when to move on); else the first usable one on
 *  pace; else the first past its threshold; else the first usable one (spent: a launch starts there, hits its limit and the chat waits, #462; `allOut`
 *  says so, with the nearest return). No usable model = null. */
export function pickInLevel(list: readonly LevelModel[], usable: (x: LevelModel) => string | null, room: (x: LevelModel) => Room, o: PickWords = {}): LevelPick | null {
  const considered: Considered[] = inOrder(list, o.order ?? []).map(at => { const why = usable(at); return { at, room: why === null ? room(at) : { state: 'unknown', why: '', resetsAt: null }, usable: why === null, ...(why ? { unusable: why } : {}) }; });
  const ok = considered.filter(c => c.usable);
  if (!ok.length) return null;
  const ordered = !!o.order?.length;
  const free = (c: Considered) => c.room.state === 'ok' || c.room.state === 'unknown' || c.room.state === 'probation' || ordered && c.room.state === 'pace';
  const take = ok.find(free) ?? ok.find(c => c.room.state === 'pace') ?? ok.find(c => c.room.state === 'over') ?? ok[0]!;
  const allOut = take.room.state === 'out';
  const before = considered.filter(c => c !== take && considered.indexOf(c) < considered.indexOf(take));
  const model = o.model ?? ((x: LevelModel) => `${x.engine} ${x.model ?? 'predefinito'}`), engine = o.engine ?? ((x: LevelModel) => x.engine);
  const skipped: SkipNote[] = before.map(c => c.unusable
    ? { engine: c.at.engine, model: c.at.model, kind: PRICE_WORDS.test(c.unusable) ? 'price' : 'off', why: c.unusable }
    : { engine: c.at.engine, model: c.at.model, kind: 'credit', why: c.room.why, state: c.room.state, ...(c.room.source ? { source: c.room.source } : {}), readingAt: c.room.readingAt ?? null, until: c.room.resetsAt });
  const back = allOut ? ok.map(c => c.room.resetsAt).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] : undefined;
  // the line every chat shows (ADR 0361): «OpenAI Sol: primo disponibile», «Claude Opus: OpenAI al limite, Antigravity non collegato»
  const whys = [...new Set(before.map(c => `${engine(c.at)} ${passed(c)}`))].join(', ');
  const last = take.room.state === 'over' ? 'oltre la soglia, ma nessun altro è libero'
    : allOut ? `tutti i motori del livello sono al limite${back !== undefined ? `, il primo torna alle ${clock(back, o.now ?? back, o.fmt)}` : ''}` : '';
  const reason = `${model(take.at)}: ${[whys, last].filter(Boolean).join(', ') || 'primo disponibile'}`;
  return { chosen: take.at, considered, reason, skipped, allOut };
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

/** One skipped model as the chat, the tools' answers and the digest say it (ADR 0354): «gpt-5.5 (opencode) saltato:
 *  credito finito, 5h al 100%, torna alle 22:40»; an engine that is off says so, never «credito». */
export function skipText(s: SkipNote): string {
  const name = `${s.model ?? 'predefinito'} (${s.engine})`;
  return `${name} saltato: ${s.kind === 'off' ? `motore spento o non permesso (${s.why})` : s.kind === 'price' ? s.why : s.state === 'pace' ? `ritmo alto, ${s.why}` : s.state === 'over' ? s.why : `credito finito, ${s.why}`}`;
}
/** The line of a chat's pick: each skipped model, and when every model was out, that it started on the first anyway. */
export function pickLines(p: { chosen: string; skipped: readonly SkipNote[]; allOut?: true }, _now: number): string {
  const lines = p.skipped.map(skipText);
  if (p.allOut) lines.push(`⚠ tutti i motori del livello sono al limite: parte su ${p.chosen} e aspetta il rinnovo`);
  else lines.push(`parte su ${p.chosen}`);
  return lines.join(' · ');
}
