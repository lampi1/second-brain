// How far a project is, read from its map (ADR 0326). The owner (2026-11-19): «le mappe servono per tracciare
// l'andamento di un piano, sarebbe bello ci fosse anche un progressivo, una percentuale, e più dettagli nella parte dx».
// - The count: the pieces of work with nothing inside them (a step, a part, a system or a document without pieces;
//   people and external systems are context, never work, and so is whatever stands beside phases and steps: an
//   environment, a document). Done = status `ok`, as saved: a file edited later turns the box «da verificare» on the
//   drawing but does not take the step back. Percentage = done / all, 100 only when all are. A level made of one piece
//   only (a project box that holds the phases) is read as what is inside it.
// - The groups: the top-level pieces (the phases), each with its own count. When they come one after the other (a
//   level drawn as a line, phases and steps in their saved order, or boxes chained by their links from the first to
//   the last) the map also says where the project is (the first phase not closed) and what comes next.
// - What stops it: the pieces and links that are blocked, the ones that wait for the user first. Only the pieces with
//   nothing inside are read (#456, ADR 0330): a box that holds pieces says what they say together, never its own
//   saved status (project-map-status.ts).
// - Which maps have a progress (progressOf): the ones told as phases and steps, and the ones whose top-level pieces are
//   chained in order with something still to do. Any other map is a picture of how things are, not a plan: there the
//   progress shown is the one of the Strategist's plan drawn on it. countOf counts any level (a phase's own bar).
// A Strategist's plan drawn on the map has its own count (planProgress), read from its steps.
// Pure, no I/O. Used by the renderer (components/project-map/MapProgress.tsx, PlanCard.tsx, MapDetail.tsx) and by the
// map's text for the Orchestrator and the agents (main/projectmap/tools.ts). Pinned by test/unit/project-map-progress.test.ts.
import { layoutOf, type MapElement, type MapFlowStep, type MapLink, type MapPlan, type ProjectMap, type ProjectMapView } from './project-map';

/** The kinds that are context around the work, never work to do. */
const CONTEXT: ReadonlySet<string> = new Set(['person', 'external']);
/** The kinds that tell a sequence: their pieces are counted as «passi». */
const SEQUENCE: ReadonlySet<string> = new Set(['phase', 'step']);

/** closed = every piece done · now = started or under way · blocked = something in it is stuck · todo = not started */
export type ProgressState = 'done' | 'now' | 'blocked' | 'todo';
export interface ProgressGroup { id: string; name: string; done: number; total: number; pct: number; state: ProgressState }
/** A piece (or a link) named by the progress: `within` = the top-level piece that holds it, when it is not itself one. */
export interface ProgressItem { id: string; name: string; within?: string; note?: string; link?: true }
export interface MapProgress {
  done: number; total: number; pct: number;
  /** pieces nobody knows the status of (they count as not done) */
  unknown: number;
  /** the pieces counted are steps of a sequence («passi»: the level is made of phases or steps, or every piece counted
   *  is one), not parts of a system («parti») */
  steps: boolean;
  /** the top-level pieces, each with its count; in the order of the work when `ordered` */
  groups: ProgressGroup[];
  /** the groups come one after the other */
  ordered: boolean;
  /** ordered: the group the project is at (the first not closed); absent when all are closed */
  at?: number;
  /** the pieces under way now (a box with pieces inside too, when somebody works on it and on none of its pieces) */
  now: ProgressItem[];
  /** ordered: the first piece still to start */
  next?: ProgressItem;
  /** blocked and waiting for the user · blocked on somebody else */
  you: ProgressItem[]; blocked: ProgressItem[];
}

/** done / total as a whole percentage: 100 only when everything is done, never 0 once something is. */
export function pctOf(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return done <= 0 ? 0 : Math.min(99, Math.max(1, Math.round((done / total) * 100)));
}

type Tree = Pick<ProjectMap, 'elements' | 'links' | 'layout'>;

/** The top-level pieces in the order their links chain them (a → b → c, no fork, every piece on the chain), or null. */
function chainOf(map: Tree, top: MapElement[]): MapElement[] | null {
  if (top.length < 2) return null;
  const ids = new Set(top.map(e => e.id)), next = new Map<string, string>(), prev = new Map<string, string>();
  for (const l of map.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    // a way back (a link against the chain already taken) or a fork: not a plain sequence
    if (next.has(l.from) || prev.has(l.to)) { if (next.get(l.from) === l.to) continue; return null; }
    next.set(l.from, l.to); prev.set(l.to, l.from);
  }
  const starts = top.filter(e => !prev.has(e.id));
  if (starts.length !== 1) return null;
  const out: MapElement[] = [], byId = new Map(top.map(e => [e.id, e]));
  for (let cur: string | undefined = starts[0]!.id; cur && out.length <= top.length; cur = next.get(cur)) out.push(byId.get(cur)!);
  return out.length === top.length ? out : null;
}

/** The pieces somebody works on right now on a live view: a plan's step under way, an agent at work. */
export function workingOf(view: Pick<ProjectMapView, 'works' | 'agents'>): Set<string> {
  const on = new Set<string>();
  for (const [id, ws] of Object.entries(view.works)) if (ws.some(w => w.state === 'now')) on.add(id);
  for (const a of view.agents) if (a.mark === 'run') for (const id of a.elements) on.add(id);
  return on;
}

/** The count of one level: the whole map (root null) or the pieces inside one of its pieces; null with nothing inside.
 *  `working` = the pieces somebody works on right now (workingOf), beside status `work`. */
export function countOf(map: Tree, root: string | null = null, working: ReadonlySet<string> = new Set()): MapProgress | null {
  const kidsOf = (id: string) => map.elements.filter(e => e.parent === id);
  const leaves = (e: MapElement, seen = new Set<string>()): MapElement[] => {
    if (seen.has(e.id)) return [];
    seen.add(e.id);
    const kids = kidsOf(e.id);
    return kids.length ? kids.flatMap(k => leaves(k, seen)) : [e];
  };
  /** the boxes with pieces inside, from `e` down */
  const holdersOf = (e: MapElement, seen = new Set<string>()): MapElement[] => {
    if (seen.has(e.id)) return [];
    seen.add(e.id);
    const kids = kidsOf(e.id);
    return kids.length ? [e, ...kids.flatMap(k => holdersOf(k, seen))] : [];
  };
  // the work of a level: its phases and steps when it has any (what stands beside them is around the work), else
  // every piece that is not a person or an external system
  const workOf = (id: string | null): MapElement[] => {
    const all = map.elements.filter(e => (e.parent ?? null) === id && !CONTEXT.has(e.kind));
    const seq = all.filter(e => SEQUENCE.has(e.kind));
    return seq.length ? seq : all;
  };
  // a level made of one piece only is read as what is inside that piece
  let lvl = root, own = workOf(root);
  for (let n = 0; n < 10 && own.length === 1 && workOf(own[0]!.id).length > 0; n++) { lvl = own[0]!.id; own = workOf(lvl); }
  // in order: a level drawn as a line, or made of phases and steps (their saved order is their order), or boxes
  // chained by their links
  const ordered0 = layoutOf(map, lvl) === 'linear' || (own.length > 0 && own.every(e => SEQUENCE.has(e.kind))) ? own : chainOf(map, own);
  const top = ordered0 ?? own;
  const groups = top.map(e => ({ e, units: leaves(e) }));
  const units = groups.flatMap(g => g.units);
  if (!units.length) return null;
  const steps = own.some(e => SEQUENCE.has(e.kind)) || units.every(u => SEQUENCE.has(u.kind));
  const isDone = (u: MapElement) => u.status === 'ok', isNow = (u: MapElement) => !isDone(u) && u.status !== 'blocked' && (u.status === 'work' || working.has(u.id));
  const done = units.filter(isDone).length;
  const item = (u: MapElement, g: MapElement): ProgressItem => ({ id: u.id, name: u.name, ...(g.id !== u.id ? { within: g.name } : {}), ...(u.note ? { note: u.note } : {}) });
  // under way in a group: its pieces, and a box with pieces inside that somebody works on while none of its pieces is
  // under way yet (an agent bound to the phase, not to a step)
  const nowOf = (g: { e: MapElement; units: MapElement[] }): MapElement[] => [
    ...holdersOf(g.e).filter(h => { if (!working.has(h.id)) return false; const ls = leaves(h); return !ls.every(isDone) && !ls.some(isNow) && !ls.some(u => u.status === 'blocked'); }),
    ...g.units.filter(isNow),
  ];
  const stateOf = (g: { e: MapElement; units: MapElement[] }): ProgressState => {
    // a chat on the box itself waits and no piece inside says so (the live view's `waits`, #456)
    if (holdersOf(g.e).some(h => h.waits)) return 'blocked';
    const d = g.units.filter(isDone).length;
    if (d === g.units.length) return 'done';
    if (g.units.some(u => u.status === 'blocked')) return 'blocked';
    return d > 0 || nowOf(g).length > 0 ? 'now' : 'todo';
  };
  const list = groups.map(g => { const d = g.units.filter(isDone).length; return { id: g.e.id, name: g.e.name, done: d, total: g.units.length, pct: pctOf(d, g.units.length), state: stateOf(g) }; });
  const ordered = !!ordered0 && top.length > 1;
  const at = ordered ? list.findIndex(g => g.state !== 'done') : -1;
  const firstTodo = ordered ? groups.flatMap(g => g.units.map(u => ({ u, g: g.e }))).find(({ u }) => !isDone(u) && !isNow(u) && u.status !== 'blocked') : undefined;
  // what is stuck, anywhere under the root: a piece of any kind and depth, and (for the whole map) a link
  const under = new Set<string>();
  const walk = (id: string) => { for (const k of kidsOf(id)) if (!under.has(k.id)) { under.add(k.id); walk(k.id); } };
  for (const e of map.elements.filter(x => (x.parent ?? null) === root)) { under.add(e.id); walk(e.id); }
  const holder = (e: MapElement): MapElement => { let cur = e; for (let n = 0; n < 50 && cur.parent && cur.parent !== lvl && cur.parent !== root; n++) { const p = map.elements.find(x => x.id === cur.parent); if (!p) break; cur = p; } return cur; };
  // the stuck pieces themselves, not the boxes that hold them
  const stuckEls = map.elements.filter(e => under.has(e.id) && e.status === 'blocked' && !kidsOf(e.id).length);
  // and the boxes a linked chat waits on while no piece inside can say so (the live view's `waits`)
  const waitEls = map.elements.filter(e => under.has(e.id) && e.waits && kidsOf(e.id).length);
  const stuckLinks: MapLink[] = root === null ? map.links.filter(l => l.status === 'blocked' && l.kind !== 'next') : [];
  const linkItem = (l: MapLink): ProgressItem => ({ id: l.id, name: l.label || `${l.from} → ${l.to}`, ...(l.note ? { note: l.note } : {}), link: true });
  return {
    done, total: units.length, pct: pctOf(done, units.length), unknown: units.filter(u => u.status === 'unknown').length, steps, groups: list, ordered,
    ...(at >= 0 ? { at } : {}),
    now: groups.flatMap(g => nowOf(g).map(u => item(u, g.e))),
    ...(firstTodo ? { next: item(firstTodo.u, firstTodo.g) } : {}),
    you: [...stuckEls.filter(e => e.actor === 'user').map(e => item(e, holder(e))), ...waitEls.filter(e => e.waits === 'user').map(e => item(e, holder(e))), ...stuckLinks.filter(l => l.actor === 'user').map(linkItem)],
    blocked: [...stuckEls.filter(e => e.actor !== 'user').map(e => item(e, holder(e))), ...waitEls.filter(e => e.waits !== 'user').map(e => item(e, holder(e))), ...stuckLinks.filter(l => l.actor !== 'user').map(linkItem)],
  };
}

/** How far the project is, for a map that tells a plan: phases and steps, or top-level pieces in order with something
 *  still to do (not done and not unknown). Null for any other map. */
export function progressOf(map: Tree, working: ReadonlySet<string> = new Set()): MapProgress | null {
  const p = countOf(map, null, working);
  if (!p) return null;
  return p.steps || (p.ordered && (p.done + p.unknown < p.total || p.now.length > 0)) ? p : null;
}

/** A plan's own count: its steps done, the ones under way, the ones stuck, the ones that wait for the user (a chat
 *  working on the step asked something: `waiting` = those chats), the first still to start. */
export interface PlanProgress { done: number; total: number; pct: number; now: MapFlowStep[]; blocked: MapFlowStep[]; you: MapFlowStep[]; next?: MapFlowStep }
export function planProgress(plan: Pick<MapPlan, 'flow'>, waiting: ReadonlySet<string> = new Set()): PlanProgress {
  const { flow } = plan, done = flow.filter(f => f.state === 'done').length, next = flow.find(f => f.state === 'todo');
  return { done, total: flow.length, pct: pctOf(done, flow.length), now: flow.filter(f => f.state === 'now'), blocked: flow.filter(f => f.state === 'blocked'),
    you: flow.filter(f => f.state !== 'done' && (f.chatIds ?? []).some(id => waiting.has(id))), ...(next ? { next } : {}) };
}

/** The progress in one line of text, for the Orchestrator and the agents (the number the user sees on the map); '' when
 *  the map has nothing to track. */
export function progressLine(map: Tree, working: ReadonlySet<string> = new Set()): string {
  const p = progressOf(map, working);
  if (!p) return '';
  const at = p.at !== undefined ? `; siamo a «${p.groups[p.at]!.name}»` : '';
  const names = (xs: ProgressItem[]) => xs.map(x => x.name).join(', ');
  return `Avanzamento: ${p.done} di ${p.total} ${p.steps ? 'passi' : 'parti'} (${p.pct}%)${at}${p.now.length ? `; in corso: ${names(p.now)}` : ''}${p.you.length ? `; aspettano l'utente: ${names(p.you)}` : ''}${p.next ? `; poi: ${p.next.name}` : ''}`;
}
