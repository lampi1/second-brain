// The one order of the engines (ADR 0359): the user sets it once (Impostazioni → Motori, or the Orchestrator for them) and
// it holds for every role. A level's list (ADR 0347) says which MODEL each engine runs; the order says which ENGINE comes
// first. A role may have its own order, an exception shown on its page. Each engine may have a threshold (% used of its
// plan): past it the next engine of the order starts, before the credits end. No order saved = the lists' own order.
// The order never changes a model, an effort or a permission. Pure: used by shared/model-levels.ts (the pick),
// main/agents/catalog.ts, main/brain/settings-schema.ts, main/appctl/config.ts and the renderer (EngineOrder.tsx);
// tests in test/unit/shared/engine-order.test.ts.
import type { Harness } from './contract';
import { binding, type CreditReading } from './credit-rule';

/** 98% counts as spent already (model-levels SPENT_PCT): a threshold is below it. */
export const THRESHOLD = { min: 10, max: 97 } as const;
export const ENGINE_ORDER_MAX = 32;
const ENGINE = /^[a-z][a-z0-9_-]{0,59}$/;

/** A stored or asked order, checked: engine ids, none twice. Throws. */
export function checkedOrder(v: unknown): Harness[] {
  if (!Array.isArray(v) || v.length > ENGINE_ORDER_MAX || !v.every((x): x is string => typeof x === 'string' && ENGINE.test(x))) throw new Error('Ordine dei motori: una lista di motori, dal primo all’ultimo.');
  if (new Set(v).size !== v.length) throw new Error('Ordine dei motori: lo stesso motore due volte.');
  return [...v] as Harness[];
}

/** A list of things on engines in the order's order (stable); an engine the order does not name comes after. */
export function inOrder<T extends { engine: Harness }>(list: readonly T[], order: readonly Harness[]): T[] {
  if (!order.length) return [...list];
  const at = (x: T) => { const i = order.indexOf(x.engine); return i < 0 ? order.length : i; };
  return list.map((x, i) => ({ x, i })).sort((a, b) => at(a.x) - at(b.x) || a.i - b.i).map(e => e.x);
}

/** Why a plan is past the user's threshold (the first window that stops this model, at or above it); null = it is not, it
 *  has no threshold or nothing was read. */
export function pastThreshold(reading: CreditReading | null, model: string | null, threshold: number | null | undefined, now: number): string | null {
  if (!threshold || !reading?.ok) return null;
  const w = reading.windows.find(x => binding(x, model, reading.pool) && x.usedPercent >= threshold && (x.resetsAt === null || x.resetsAt > now));
  return w ? `${w.label} al ${Math.round(w.usedPercent)}%, soglia ${threshold}%` : null;
}

/** The order a role follows: its own exception, else the one order. */
export const roleOrder = (own: readonly Harness[] | undefined, all: readonly Harness[]): readonly Harness[] => own?.length ? own : all;

/** A text as whole words: accents, case, punctuation and spaces do not count. */
export const wordsOf = (text: string): string => ` ${text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9%.+/:_-]+/g, ' ').replace(/[.:-]+(?= |$)/g, '').trim()} `;

/** A text as its sentences (a line, ?, !, ; or a full stop end one), each as whole words: a canonical sentence must fill one, so
 *  «Lingua: Italiano e inglese.» is no yes to «Lingua: Italiano.». */
export const sentencesOf = (text: string): string[] => text.split(/[\n?!;]|\.\s|\.$/).map(wordsOf);

/** Whether one sentence of a text names these engines, all of them, in this order and no other known one (their labels or
 *  ids as whole words, the first mention of each): a card that says «OpenAI, poi Cursor, Claude per ultimo» names that
 *  order. One sentence, with no «non» or «mai» in it, so a mention elsewhere neither makes nor breaks it. `and` = words
 *  the same sentence must hold too (one of them), `never` = words it must not. */
export function namesInOrder(text: string, engines: readonly (readonly string[])[], o: { others?: readonly (readonly string[])[]; and?: readonly string[]; never?: readonly string[] } = {}): boolean {
  const has = (line: string, name: string) => line.indexOf(wordsOf(name));
  const named = (line: string): boolean => {
    if (/ (non|mai|senza|not|never|nicht|nie) /.test(line)) return false;
    let last = -1;
    for (const names of engines) {
      const hits = names.map(n => has(line, n)).filter(i => i >= 0);
      const at = hits.length ? Math.min(...hits) : -1;
      if (at <= last) return false;
      last = at;
    }
    const any = (list: readonly string[]) => list.some(n => has(line, n) >= 0);
    return !(o.others ?? []).some(any) && !(o.never && any(o.never)) && (!o.and || any(o.and));
  };
  return engines.length > 0 && text.split(/[\n?!;]|\.\s/).map(wordsOf).some(named);
}
