// The status a project map shows for each piece (issue #456, ADR 0330). The owner (2026-11-20): «a parent element can
// show ok while its sub-steps are not complete … the parent status should be derived from its children: all done =
// fatto, any in progress = in corso, any blocked = bloccato»; and «for a step the ok status should read "fatto":
// "funziona" only fits systems».
// - A piece with nothing inside shows its own status (shownStatus: «da verificare» when nobody confirmed a work or
//   blocked status lately, or its files changed since).
// - A piece with pieces inside shows what they say together (rollUp), all the way down: its own saved status is never
//   read, so a phase cannot read done over steps still open. The saved file follows too (settle, at every save).
//   While somebody works on the box itself (`busy`, set by the app on the live view) it reads under way.
// - A status that comes from outside the piece (a plan's step, a chat linked to it: main/projectmap/service.ts) lands
//   on what holds a status: the piece itself, or, for a box, the pieces inside it that it can speak for (spread).
// - The words: `ok` reads «fatto» on a phase or a step and «funziona» on everything else (stateLabel).
// Pure, no I/O. Used by shared/project-map.ts (the map's text), main/projectmap/service.ts and the renderer
// (components/project-map/). Pinned by test/unit/project-map-status.test.ts.
import type { MapActor, MapElement, MapState } from './project-map';

/** A status nobody confirmed for this long reads «da verificare» (work and blocked only: a done part stays done
 *  unless its files change). */
export const STALE_MS = 2 * 3600_000;

/** What the drawing shows for a piece: its status, whether it fell to «da verificare», who must act when blocked. */
export interface ShownState { status: MapState; stale: boolean; actor?: MapActor }

/** What the drawing shows for an element or a link: its status, or «unknown» when nobody confirmed a work/blocked
 *  status lately, or its files changed after it was confirmed. `stale` = it fell to unknown that way. */
export function shownStatus(x: { status: MapState; confirmedAt: number }, now: number, changedAt?: number): { status: MapState; stale: boolean } {
  if (x.status === 'unknown') return { status: 'unknown', stale: false };
  // a planned piece has nothing to verify yet
  if (x.status === 'planned') return { status: 'planned', stale: false };
  if (changedAt !== undefined && changedAt > x.confirmedAt) return { status: 'unknown', stale: true };
  if ((x.status === 'work' || x.status === 'blocked') && now - x.confirmedAt > STALE_MS) return { status: 'unknown', stale: true };
  return { status: x.status, stale: false };
}

export const LABEL_IT: Record<MapState, string> = { ok: 'funziona', work: 'in lavorazione', blocked: 'bloccato', unknown: 'da capire', planned: 'previsto' };
/** The kinds that are work to do, not things that exist: their `ok` is «fatto». */
export const isStepKind = (kind: string | undefined): boolean => kind === 'phase' || kind === 'step';
/** A status in the user's words: «fatto» for a phase or a step that is ok, «funziona» for anything else. */
export function stateLabel(s: MapState | 'stale', kind?: string): string {
  if (s === 'stale') return 'da verificare';
  return s === 'ok' && isStepKind(kind) ? 'fatto' : LABEL_IT[s];
}

/** What the pieces inside a box say together: one stuck = stuck (it waits for the user when one of them does) · one
 *  under way = under way · one to verify = to verify · all done = done · some done and some still to start = under
 *  way · none started = planned · else nobody knows. */
export function rollUp(kids: readonly ShownState[]): ShownState {
  const stuck = kids.filter(k => k.status === 'blocked');
  if (stuck.length) { const actor = stuck.some(k => k.actor === 'user') ? 'user' : stuck.find(k => k.actor)?.actor; return { status: 'blocked', stale: false, ...(actor ? { actor } : {}) }; }
  if (kids.some(k => k.status === 'work')) return { status: 'work', stale: false };
  if (kids.some(k => k.stale)) return { status: 'unknown', stale: true };
  const has = (s: MapState) => kids.some(k => k.status === s);
  if (kids.length > 0 && kids.every(k => k.status === 'ok')) return { status: 'ok', stale: false };
  if (has('ok') && has('planned')) return { status: 'work', stale: false };
  if (has('planned') && !has('ok')) return { status: 'planned', stale: false };
  return { status: 'unknown', stale: false };
}

type Tree = readonly MapElement[];
const kidsBy = (elements: Tree): Map<string, MapElement[]> => {
  const out = new Map<string, MapElement[]>();
  for (const e of elements) if (e.parent) out.set(e.parent, [...(out.get(e.parent) ?? []), e]);
  return out;
};

/** What every element of a map shows now: a piece with nothing inside its own status, a piece with pieces inside what
 *  they say together. `changed` = element id → when one of its files was last edited by an agent. */
export function statusesOf(map: { elements: Tree }, now: number, changed: Record<string, number> = {}): Map<string, ShownState> {
  const kids = kidsBy(map.elements), out = new Map<string, ShownState>();
  const visit = (e: MapElement, path: Set<string>): ShownState => {
    const hit = out.get(e.id);
    if (hit) return hit;
    const own = kids.get(e.id);
    let s: ShownState;
    if (!own?.length || path.has(e.id)) { const x = shownStatus(e, now, changed[e.id]); s = { ...x, ...(x.status === 'blocked' && e.actor ? { actor: e.actor } : {}) }; }
    else {
      path.add(e.id);
      s = rollUp(own.map(k => visit(k, path)));
      path.delete(e.id);
      // somebody works on the box itself right now: under way, unless a piece inside is stuck
      if (e.busy && s.status !== 'blocked') s = { status: 'work', stale: false };
      // its own files (the ones no piece inside covers) changed after everything in it was done: to verify
      else if (s.status === 'ok' && changed[e.id] !== undefined && changed[e.id]! > e.confirmedAt) s = { status: 'unknown', stale: true };
    }
    out.set(e.id, s);
    return s;
  };
  for (const e of map.elements) visit(e, new Set());
  return out;
}

/** The pieces under an element that hold a status of their own (nothing inside them), in the saved order; the element
 *  itself when it has nothing inside. */
export function leavesOf(elements: Tree, id: string): MapElement[] {
  const kids = kidsBy(elements), out: MapElement[] = [], seen = new Set<string>();
  const walk = (x: string) => {
    if (seen.has(x)) return;
    seen.add(x);
    const own = kids.get(x);
    if (own?.length) for (const k of own) walk(k.id);
    else { const e = elements.find(y => y.id === x); if (e) out.push(e); }
  };
  walk(id);
  return out;
}

/** The saved statuses with every box that holds pieces set to what they say together (as saved, no «da verificare»):
 *  the file tells the same thing the drawing shows. The same array when nothing changes. */
export function settle(elements: Tree): MapElement[] {
  const kids = kidsBy(elements), memo = new Map<string, ShownState>();
  const visit = (e: MapElement, path: Set<string>): ShownState => {
    const hit = memo.get(e.id);
    if (hit) return hit;
    const own = kids.get(e.id);
    let s: ShownState;
    if (!own?.length || path.has(e.id)) s = { status: e.status, stale: false, ...(e.status === 'blocked' && e.actor ? { actor: e.actor } : {}) };
    else { path.add(e.id); s = rollUp(own.map(k => visit(k, path))); path.delete(e.id); }
    memo.set(e.id, s);
    return s;
  };
  let moved = false;
  const out = elements.map(e => { const s = visit(e, new Set()); if (s.status === e.status) return e; moved = true; return { ...e, status: s.status }; });
  return moved ? out : elements as MapElement[];
}

/** A status that comes from outside a piece (a plan's step on it, a chat linked to it), as changes on what holds a
 *  status. A piece with nothing inside: itself. A box with pieces inside holds none, so:
 *  work = nothing is saved (which piece is under way is not known: the box reads under way while the work lasts,
 *  `busy`) · ok = its pieces under way turn done, and so do its steps not started (a finished phase has finished
 *  steps; the parts of a system that nobody worked on keep what they say) · blocked = its pieces under way turn
 *  stuck, else its first step still open. A done or stuck piece is always left alone. `skip` = pieces somebody else
 *  speaks for (a chat linked to them directly). Only real changes are returned. */
export function spread(elements: Tree, id: string, want: 'work' | 'ok' | 'blocked', skip: ReadonlySet<string> = new Set()): { id: string; status: MapState }[] {
  const leaves = leavesOf(elements, id);
  if (leaves.length === 1 && leaves[0]!.id === id) return leaves[0]!.status === want ? [] : [{ id, status: want }];
  if (want === 'work') return [];
  const open = leaves.filter(e => !skip.has(e.id)), now = open.filter(e => e.status === 'work');
  const todo = open.filter(e => isStepKind(e.kind) && (e.status === 'planned' || e.status === 'unknown'));
  return (want === 'ok' ? [...now, ...todo] : now.length ? now : todo.slice(0, 1)).map(e => ({ id: e.id, status: want }));
}
