// The one order of the engines (ADR 0357): the user sets it once (Impostazioni → Motori, or the Orchestrator for them) and
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
  const w = reading.windows.find(x => binding(x, model) && x.usedPercent >= threshold && (x.resetsAt === null || x.resetsAt > now));
  return w ? `${w.label} al ${Math.round(w.usedPercent)}%, soglia ${threshold}%` : null;
}

/** The order a role follows: its own exception, else the one order. */
export const roleOrder = (own: readonly Harness[] | undefined, all: readonly Harness[]): readonly Harness[] => own?.length ? own : all;

/** Whether one sentence of a text names these engines, all of them and in this order (their labels or ids, the first
 *  mention of each): a card that says «OpenAI, poi Cursor, Claude per ultimo» names that order. One sentence, so a
 *  mention elsewhere («Claude per ultimo?») neither makes nor breaks it. */
export function namesInOrder(text: string, engines: readonly (readonly string[])[]): boolean {
  const named = (line: string): boolean => {
    let last = -1;
    for (const names of engines) {
      const hits = names.map(n => line.indexOf(n.toLowerCase())).filter(i => i >= 0);
      const at = hits.length ? Math.min(...hits) : -1;
      if (at <= last) return false;
      last = at;
    }
    return true;
  };
  return engines.length > 0 && text.toLowerCase().split(/[\n?!;]|\.\s/).some(named);
}
