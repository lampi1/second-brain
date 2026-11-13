// The project map (issue #385, ADR 0271): a drawing of a project in place of its code, in the C4 style. The owner
// (2026-11-12): «a me serve qualcosa da vedere al posto del codice … la struttura di un progetto nei vari sistemi
// connessione utenti … e l'avanzamento di ogni agente con un colpo d'occhio»; «sia tutto sempre aggiornato, navigabile
// dall'inizio alla fine e riconsultabile chiedendolo all'Orchestrator».
// - Elements: people, systems (yours, external), environments, documents and the parts inside a system (parent = the
//   system, one level deep: clicking a system zooms into it). Links: who calls whom, with a label. Each element and link has a status
//   and when it was last confirmed; evidence = the project files it was read from (paths relative to the map's root).
// - An agent draws it (project_map_save) and keeps it current (project_map_update); every save is a version, so the
//   history plays the project from its first map to now. The app lays it out, binds the agents at work to the elements
//   they work on, and turns a status nobody confirmed lately, or whose files changed since, into «da verificare».
// - Planning (ADR 0276): a piece that does not exist yet is `planned` (drawn dashed). The Orchestrator adds, changes and
//   removes pieces without a redraw (applyEdit); a Strategist's plan names the element each step works on, and the view
//   carries those steps as the element's works, read live from the plan (never copied into the map file).
// Shared by main (projectmap/: store, service, tools) and the renderer (components/project-map/); pure, no I/O.
// Pinned by test/unit/project-map.test.ts.

export const MAP_KINDS = ['person', 'system', 'external', 'env', 'doc', 'part'] as const;
export type MapKind = (typeof MAP_KINDS)[number];
/** ok = works / done · work = being built · blocked = stuck (someone must act) · unknown = nobody knows ·
 *  planned = not there yet, a piece of the plan (ADR 0276) */
export const MAP_STATES = ['ok', 'work', 'blocked', 'unknown', 'planned'] as const;
export type MapState = (typeof MAP_STATES)[number];
/** who must act on a blocked element: the user, an agent, someone else (a colleague, a team) */
export const MAP_ACTORS = ['user', 'agent', 'other'] as const;
export type MapActor = (typeof MAP_ACTORS)[number];

export interface MapElement {
  id: string; kind: MapKind; name: string; description?: string;
  /** the system this part sits in (zoom); absent = the project's top level */
  parent?: string;
  status: MapState;
  /** one short line on the status: what is missing, what the user must do */
  note?: string;
  /** who must act when it is blocked */
  actor?: MapActor;
  /** project files it was read from, relative to the map's root (a file or a folder ending in /) */
  evidence: string[];
  /** when its status was last confirmed (ms) */
  confirmedAt: number;
  /** the Strategist chat whose plan added it (ADR 0276): a plan proposed again, or dropped, takes its unstarted pieces back */
  plan?: string;
  /** when the Orchestrator or a plan added it to an existing drawing (ms): the drawing marks it «nuovo» for a while */
  addedAt?: number;
}
export interface MapLink { id: string; from: string; to: string; label: string; status: MapState; note?: string; actor?: MapActor; confirmedAt: number }

export interface ProjectMap {
  /** the folder name under the brain's projects/ (lowercase, digits, dashes) */
  project: string;
  title: string;
  /** the project's folder on this PC (a repo): evidence paths are relative to it */
  root?: string;
  version: number; updatedAt: number;
  /** who saved this version (a chat's title, «utente», «app») and what changed */
  by: string; summary: string;
  elements: MapElement[]; links: MapLink[];
  /** the user's corrections, kept across redraws: every new drawing must respect them */
  corrections: string[];
}
export interface MapVersionInfo { version: number; at: number; by: string; summary: string }
export interface ProjectMapInfo { project: string; title: string; version: number; updatedAt: number; elements: number; waiting: number }

/** An agent on the map: one open chat bound to elements (it said so, or it edited their files). */
export type MapAgentMark = 'wait' | 'error' | 'run' | 'queue' | 'done' | 'idle';
export interface MapAgent {
  chatId: string; title: string; role?: string;
  mark: MapAgentMark;
  /** steps done and in all (its plan or todo list); total 0 = no list */
  done: number; total: number;
  now?: string; ask?: string;
  /** when it started working (ms) */
  since?: number;
  elements: string[];
  /** the user's last change sent to it while it worked (ADR 0276): when it was sent and when the agent took it */
  change?: { text: string; at: number; seenAt?: number };
}
/** A step of a Strategist's plan on the element it works on (ADR 0276): read live from the plan, never saved in the map. */
export interface MapWork {
  title: string; state: 'todo' | 'now' | 'done' | 'blocked'; role?: string;
  /** the Strategist's chat and the step's number in its plan (from 1) */
  chatId: string; step: number;
  /** the chats delegated for it */
  chatIds: string[];
  /** added while the plan was under way */
  added?: boolean;
}
/** A Strategist's plan drawn on this map: `proposed` waits for the user's «Approva e parti». */
export interface MapPlan { chatId: string; title: string; phase: 'proposed' | 'revising' | 'running' | 'done'; at: number; steps: number; done: number; doneWhen?: string }
export interface ProjectMapView {
  map: ProjectMap;
  history: MapVersionInfo[];
  agents: MapAgent[];
  /** element id → when one of its evidence files was last edited by an agent (ms) */
  changed: Record<string, number>;
  /** element id → the plan steps that work on it (ADR 0276) */
  works: Record<string, MapWork[]>;
  plans: MapPlan[];
}
/** a piece added to a drawing reads «nuovo» this long */
export const NEW_MS = 3600_000;

/** A status nobody confirmed for this long reads «da verificare» (work and blocked only: a done part stays done
 *  unless its files change). */
export const STALE_MS = 2 * 3600_000;
export const MAP_LIMITS = { elements: 200, links: 400, name: 80, description: 300, note: 200, label: 80, evidence: 20, path: 300, corrections: 30, correction: 300, summary: 300, title: 80 } as const;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const isMapId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
export const isMapState = (v: unknown): v is MapState => typeof v === 'string' && (MAP_STATES as readonly string[]).includes(v);
const isKind = (v: unknown): v is MapKind => typeof v === 'string' && (MAP_KINDS as readonly string[]).includes(v);
const isActor = (v: unknown): v is MapActor => typeof v === 'string' && (MAP_ACTORS as readonly string[]).includes(v);

/** A project name → its folder name: «Server MCP per il gestionale» → server-mcp-per-il-gestionale. */
export function projectSlug(title: string): string {
  const s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || 'progetto';
}

const text = (v: unknown, key: string, max: number, required = true): string | undefined => {
  if (v === undefined || v === null || v === '') { if (required) throw new Error(`${key}: required`); return undefined; }
  if (typeof v !== 'string') throw new Error(`${key}: text`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t && required) throw new Error(`${key}: required`);
  if (t.length > max) throw new Error(`${key}: at most ${max} characters`);
  return t || undefined;
};
const evidenceOf = (v: unknown, key: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAP_LIMITS.evidence) throw new Error(`${key}: up to ${MAP_LIMITS.evidence} paths`);
  return v.map((p, i) => {
    const s = text(p, `${key}[${i}]`, MAP_LIMITS.path)!.replace(/\\/g, '/').replace(/^\.\//, '');
    if (s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').includes('..')) throw new Error(`${key}[${i}]: a path relative to the project's root`);
    return s;
  });
};

/** The drawing an agent sends (project_map_save), checked field by field; a status it gives is confirmed now, one it
 *  leaves out keeps the previous version's (or reads unknown). */
export function checkMap(input: unknown, now: number, prev?: ProjectMap | null): Pick<ProjectMap, 'elements' | 'links'> {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (!Array.isArray(o.elements) || !o.elements.length) throw new Error('elements: at least one');
  if (o.elements.length > MAP_LIMITS.elements) throw new Error(`elements: at most ${MAP_LIMITS.elements}`);
  const links = o.links === undefined ? [] : o.links;
  if (!Array.isArray(links) || links.length > MAP_LIMITS.links) throw new Error(`links: at most ${MAP_LIMITS.links}`);
  const before = new Map(prev?.elements.map(e => [e.id, e]) ?? []);
  const elements: MapElement[] = o.elements.map((raw, i) => {
    const e = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const key = `elements[${i}]`;
    if (!isMapId(e.id)) throw new Error(`${key}.id: lowercase letters, digits and dashes (e.g. "server-mcp")`);
    if (!isKind(e.kind)) throw new Error(`${key}.kind: ${MAP_KINDS.join(' | ')}`);
    if (e.status !== undefined && !isMapState(e.status)) throw new Error(`${key}.status: ${MAP_STATES.join(' | ')}`);
    if (e.actor !== undefined && !isActor(e.actor)) throw new Error(`${key}.actor: ${MAP_ACTORS.join(' | ')}`);
    if (e.parent !== undefined && !isMapId(e.parent)) throw new Error(`${key}.parent: an element id`);
    const old = before.get(e.id);
    const status = (e.status as MapState | undefined) ?? old?.status ?? 'unknown';
    const note = text(e.note, `${key}.note`, MAP_LIMITS.note, false), description = text(e.description, `${key}.description`, MAP_LIMITS.description, false);
    return {
      id: e.id, kind: e.kind, name: text(e.name, `${key}.name`, MAP_LIMITS.name)!,
      ...(description ? { description } : {}), ...(e.parent ? { parent: e.parent as string } : {}),
      status, ...(note ? { note } : {}), ...(e.actor ? { actor: e.actor as MapActor } : {}),
      evidence: evidenceOf(e.evidence, `${key}.evidence`),
      confirmedAt: e.status !== undefined ? now : old?.confirmedAt ?? now,
      ...(old?.plan ? { plan: old.plan } : {}), ...(old?.addedAt ? { addedAt: old.addedAt } : {}),
    };
  });
  const ids = new Set<string>();
  for (const e of elements) { if (ids.has(e.id)) throw new Error(`elements: id "${e.id}" twice`); ids.add(e.id); }
  for (const e of elements) {
    if (!e.parent) continue;
    if (!ids.has(e.parent)) throw new Error(`element "${e.id}": parent "${e.parent}" is not an element`);
    if (e.kind !== 'part') throw new Error(`element "${e.id}": only a part has a parent (kind "part")`);
    // one level of parts: a part sits in a system, a part inside a part is a redraw with smaller systems
    const holder = elements.find(x => x.id === e.parent)!;
    if (holder.kind !== 'system' && holder.kind !== 'external') throw new Error(`element "${e.id}": a part's parent is a system (kind "system" or "external"), not a ${holder.kind}`);
    // no cycles: a part's chain of parents ends at the top
    const seen = new Set<string>([e.id]);
    for (let p: string | undefined = e.parent; p; p = elements.find(x => x.id === p)?.parent) { if (seen.has(p)) throw new Error(`element "${e.id}": its parents loop`); seen.add(p); }
  }
  const oldLinks = new Map(prev?.links.map(l => [l.id, l]) ?? []);
  const linkIds = new Set<string>();
  const out: MapLink[] = links.map((raw, i) => {
    const l = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const key = `links[${i}]`;
    const id = l.id === undefined ? `${String(l.from)}--${String(l.to)}`.slice(0, 48) : l.id;
    if (!isMapId(id)) throw new Error(`${key}.id: lowercase letters, digits and dashes`);
    if (linkIds.has(id)) throw new Error(`links: id "${id}" twice (give each link an id)`);
    if (ids.has(id)) throw new Error(`${key}.id: "${id}" is an element's id (a status update could not tell them apart)`);
    linkIds.add(id);
    if (!isMapId(l.from) || !ids.has(l.from)) throw new Error(`${key}.from: an element id`);
    if (!isMapId(l.to) || !ids.has(l.to)) throw new Error(`${key}.to: an element id`);
    if (l.from === l.to) throw new Error(`${key}: from and to are the same element`);
    if (l.status !== undefined && !isMapState(l.status)) throw new Error(`${key}.status: ${MAP_STATES.join(' | ')}`);
    if (l.actor !== undefined && !isActor(l.actor)) throw new Error(`${key}.actor: ${MAP_ACTORS.join(' | ')}`);
    const old = oldLinks.get(id);
    const note = text(l.note, `${key}.note`, MAP_LIMITS.note, false);
    return { id, from: l.from, to: l.to, label: text(l.label, `${key}.label`, MAP_LIMITS.label)!, status: (l.status as MapState | undefined) ?? old?.status ?? 'unknown',
      ...(note ? { note } : {}), ...(l.actor ? { actor: l.actor as MapActor } : {}), confirmedAt: l.status !== undefined ? now : old?.confirmedAt ?? now };
  });
  return { elements, links: out };
}

export interface MapChange { id: string; status?: MapState; note?: string; actor?: MapActor | null }

/** A status update (project_map_update): each named element or link gets its new status, note and actor, confirmed now. */
export function applyChanges(map: Pick<ProjectMap, 'elements' | 'links'>, changes: unknown, now: number): { elements: MapElement[]; links: MapLink[]; touched: string[] } {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('changes: 1 to 100 entries');
  const elements = map.elements.map(e => ({ ...e })), links = map.links.map(l => ({ ...l }));
  const touched: string[] = [];
  changes.forEach((raw, i) => {
    const c = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const key = `changes[${i}]`;
    const target = elements.find(e => e.id === c.id) ?? links.find(l => l.id === c.id);
    if (!target) throw new Error(`${key}.id: no element or link "${String(c.id).slice(0, 48)}" (project_map_read lists them)`);
    if (c.status !== undefined && !isMapState(c.status)) throw new Error(`${key}.status: ${MAP_STATES.join(' | ')}`);
    if (c.actor !== undefined && c.actor !== null && !isActor(c.actor)) throw new Error(`${key}.actor: ${MAP_ACTORS.join(' | ')} or null`);
    if (c.status !== undefined) target.status = c.status as MapState;
    if (c.note !== undefined) { const n = text(c.note, `${key}.note`, MAP_LIMITS.note, false); if (n) target.note = n; else delete target.note; }
    if (c.actor === null) delete target.actor; else if (c.actor !== undefined) target.actor = c.actor as MapActor;
    target.confirmedAt = now;
    touched.push(target.id);
  });
  return { elements, links, touched };
}

export const EDIT_OPS = ['add', 'set', 'remove', 'link', 'unlink'] as const;
/** One change to a drawing without a redraw (ADR 0276): add = a new piece (planned unless a status is given) · set =
 *  rename, describe, move under a system, change status or note · remove = the piece, its parts and their links ·
 *  link / unlink = an arrow. */
export interface MapEditOp { op: (typeof EDIT_OPS)[number]; id?: string; kind?: MapKind; name?: string; description?: string; parent?: string | null; status?: MapState; note?: string; actor?: MapActor; from?: string; to?: string; label?: string }

/** The drawing after the ops, checked as a whole drawing is (checkMap); what it did, one line each, for the history.
 *  `plan` = the Strategist chat a new piece belongs to. Untouched elements keep their status and when it was confirmed. */
export function applyEdit(map: ProjectMap, ops: unknown, now: number, plan?: string): { elements: MapElement[]; links: MapLink[]; did: string[]; added: string[] } {
  if (!Array.isArray(ops) || !ops.length || ops.length > 40) throw new Error('ops: 1 to 40 changes');
  type Raw = Record<string, unknown>;
  // untouched pieces travel without a status: checkMap then keeps theirs, and when it was confirmed
  let els: Raw[] = map.elements.map(({ status: _s, confirmedAt: _c, plan: _p, addedAt: _a, ...e }) => ({ ...e }));
  let links: Raw[] = map.links.map(({ status: _s, confirmedAt: _c, ...l }) => ({ ...l }));
  const did: string[] = [], added: string[] = [];
  const nameOf = (id: unknown) => String(els.find(e => e.id === id)?.name ?? id);
  ops.forEach((raw, i) => {
    const o = raw && typeof raw === 'object' ? raw as Raw : {};
    const key = `ops[${i}]`;
    if (!(EDIT_OPS as readonly string[]).includes(o.op as string)) throw new Error(`${key}.op: ${EDIT_OPS.join(' | ')}`);
    if (o.op === 'add') {
      const name = text(o.name, `${key}.name`, MAP_LIMITS.name)!;
      let id = isMapId(o.id) ? o.id : projectSlug(name);
      if (o.id !== undefined && !isMapId(o.id)) throw new Error(`${key}.id: lowercase letters, digits and dashes`);
      if (o.id !== undefined && els.some(e => e.id === id)) throw new Error(`${key}.id: "${id}" is already on the map (op "set" changes it)`);
      for (let n = 2; els.some(e => e.id === id) || links.some(l => l.id === id); n++) id = `${projectSlug(name).slice(0, 44)}-${n}`;
      els.push({ id, kind: o.kind ?? (o.parent ? 'part' : 'system'), name, ...(o.description ? { description: o.description } : {}), ...(o.parent ? { parent: o.parent } : {}),
        status: o.status ?? 'planned', ...(o.note ? { note: o.note } : {}), ...(o.actor ? { actor: o.actor } : {}), evidence: [] });
      added.push(id);
      did.push(`+ ${name}`);
      return;
    }
    if (o.op === 'link') {
      const id = o.id === undefined ? `${String(o.from)}--${String(o.to)}`.slice(0, 48) : o.id;
      if (links.some(l => l.id === id)) throw new Error(`${key}: the link "${String(id)}" is already on the map`);
      links.push({ id, from: o.from, to: o.to, label: o.label, ...(o.status ? { status: o.status } : {}) });
      did.push(`+ ${nameOf(o.from)} → ${nameOf(o.to)}`);
      return;
    }
    if (o.op === 'unlink') {
      if (!links.some(l => l.id === o.id)) throw new Error(`${key}.id: no link "${String(o.id).slice(0, 48)}"`);
      links = links.filter(l => l.id !== o.id);
      did.push(`− collegamento ${String(o.id)}`);
      return;
    }
    const el = els.find(e => e.id === o.id);
    if (!el) throw new Error(`${key}.id: no element "${String(o.id).slice(0, 48)}" (the map's text lists them)`);
    if (o.op === 'remove') {
      const gone = new Set<unknown>([el.id]);
      for (const e of els) if (e.parent === el.id) gone.add(e.id);
      els = els.filter(e => !gone.has(e.id));
      links = links.filter(l => !gone.has(l.from) && !gone.has(l.to));
      did.push(`− ${String(el.name)}`);
      return;
    }
    // set
    for (const k of ['name', 'description', 'kind', 'status', 'note', 'actor'] as const) if (o[k] !== undefined) { if (o[k] === '' || o[k] === null) delete el[k]; else el[k] = o[k]; }
    if (o.parent !== undefined) { if (o.parent === null || o.parent === '') delete el.parent; else el.parent = o.parent; }
    did.push(`~ ${String(el.name)}${isMapState(o.status) ? `: ${LABEL_IT[o.status]}` : ''}`);
  });
  const out = checkMap({ elements: els, links }, now, map);
  const elements = out.elements.map(e => (added.includes(e.id) ? { ...e, addedAt: now, ...(plan ? { plan } : {}) } : e.status !== 'planned' && e.plan ? (({ plan: _p, ...rest }) => rest)(e) : e));
  return { elements, links: out.links, did, added };
}

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

/** The element whose evidence covers a file (the longest match wins), for the edits of an agent. `file` relative to the root. */
export function elementOfFile(elements: readonly MapElement[], file: string): string | null {
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
  let best: { id: string; n: number } | null = null;
  for (const e of elements) for (const p of e.evidence) {
    const hit = p.endsWith('/') ? f.startsWith(p) : f === p || f.startsWith(`${p}/`);
    if (hit && (!best || p.length > best.n)) best = { id: e.id, n: p.length };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------- one level of the drawing

export interface LevelNode { id: string; x: number; y: number; w: number; h: number; ctx: boolean }
export interface LevelEdge { id: string; from: string; to: string; label: string; status: MapState; stale: boolean; note?: string; actor?: MapActor; count: number }
export interface Level { nodes: LevelNode[]; edges: LevelEdge[]; width: number; height: number }

export const BOX = { w: 210, h: 128, gx: 60, gy: 84, ctxW: 160, ctxH: 70, pad: 32 } as const;
/** at most this many boxes side by side: a wider row wraps onto the next line */
export const ROW_MAX = 4;

/** The elements shown at one level: the top (parent null) or inside a system; around a system, the outside elements
 *  linked to its parts (ctx) so the drawing still shows where it connects. Links between deeper parts are drawn between
 *  the shown elements that hold them. Layered: people on top, then each element under what calls it. */
export function levelOf(map: Pick<ProjectMap, 'elements' | 'links'>, parent: string | null, now: number): Level {
  const byId = new Map(map.elements.map(e => [e.id, e]));
  const inside = (id: string): string | null => {
    // the shown element holding `id` at this level: itself or an ancestor whose parent is `parent`
    for (let cur: string | undefined = id, n = 0; cur && n < 50; n++) {
      const e = byId.get(cur);
      if (!e) return null;
      if ((e.parent ?? null) === parent) return e.id;
      cur = e.parent;
    }
    return null;
  };
  const own = map.elements.filter(e => (e.parent ?? null) === parent).map(e => e.id);
  const ctx = new Set<string>();
  const outside = (id: string): string => { let e = byId.get(id); for (let n = 0; e?.parent && n < 50; n++) e = byId.get(e.parent); return e?.id ?? id; };
  const edges = new Map<string, LevelEdge>();
  for (const l of map.links) {
    let a = inside(l.from), b = inside(l.to);
    if (parent !== null) {
      // a link from a part of this system to the outside: the outside element (its top-level holder) is context
      if (a && !b) { b = outside(l.to); if (b === parent) continue; ctx.add(b); }
      else if (b && !a) { a = outside(l.from); if (a === parent) continue; ctx.add(a); }
    }
    if (!a || !b || a === b) continue;
    const key = `${a}>${b}`;
    const st = shownStatus(l, now);
    const old = edges.get(key);
    if (old) { old.count++; if (rank(st.status) > rank(old.status)) { old.status = st.status; old.stale = st.stale; } continue; }
    edges.set(key, { id: l.id, from: a, to: b, label: l.label, status: st.status, stale: st.stale, ...(l.note ? { note: l.note } : {}), ...(l.actor ? { actor: l.actor } : {}), count: 1 });
  }
  const ids = [...own, ...[...ctx].filter(id => !own.includes(id))];
  // layers: people first; then longest path along the links (a cycle is cut where it closes). Environments and documents
  // serve the rest: they sit on a row of their own at the bottom, and their links do not push anything down.
  const base = (id: string) => { const k = byId.get(id)?.kind; return k === 'env' || k === 'doc'; };
  const layer = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const e of edges.values()) if (!base(e.from) && !base(e.to)) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const visit = (id: string, d: number, path: Set<string>) => {
    if (path.has(id) || d > ids.length) return;
    if ((layer.get(id) ?? -1) >= d) return;
    layer.set(id, d);
    path.add(id);
    for (const n of out.get(id) ?? []) visit(n, d + 1, path);
    path.delete(id);
  };
  const into = new Set([...edges.values()].filter(e => !base(e.from)).map(e => e.to));
  const main = ids.filter(id => !base(id));
  const people = main.filter(id => byId.get(id)?.kind === 'person');
  for (const id of people) visit(id, 0, new Set());
  for (const id of main) if (!layer.has(id) && !into.has(id)) visit(id, people.length ? 1 : 0, new Set());
  for (const id of main) if (!layer.has(id)) visit(id, people.length ? 1 : 0, new Set());
  const bottom = main.length ? Math.max(0, ...layer.values()) + 1 : 0;
  for (const id of ids) if (base(id)) layer.set(id, bottom);
  const rows: string[][] = [];
  for (const id of ids) { const r = layer.get(id) ?? 0; (rows[r] ??= []).push(id); }
  const dense = rows.filter(r => r?.length);
  // order each row by the mean position of its neighbours in the row above (two passes), so links cross less
  const pos = new Map<string, number>();
  dense.forEach(r => r.forEach((id, i) => pos.set(id, i)));
  for (let pass = 0; pass < 2; pass++) for (let r = 1; r < dense.length; r++) {
    const above = new Set(dense[r - 1]);
    const score = (id: string) => {
      const ns = [...edges.values()].flatMap(e => (e.to === id && above.has(e.from) ? [e.from] : e.from === id && above.has(e.to) ? [e.to] : []));
      return ns.length ? ns.reduce((s, n) => s + (pos.get(n) ?? 0), 0) / ns.length : pos.get(id) ?? 0;
    };
    dense[r] = [...dense[r]!].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    dense[r]!.forEach((id, i) => pos.set(id, i));
  }
  // a row wider than ROW_MAX wraps onto more lines (in its order), so a wide level stays readable on a narrow page
  const wrapped = dense.flatMap(r => Array.from({ length: Math.ceil(r.length / ROW_MAX) }, (_, i) => r.slice(i * ROW_MAX, (i + 1) * ROW_MAX)));
  dense.splice(0, dense.length, ...wrapped);
  const widest = Math.max(1, ...dense.map(r => r.length));
  const width = BOX.pad * 2 + widest * BOX.w + (widest - 1) * BOX.gx;
  const nodes: LevelNode[] = [];
  dense.forEach((row, r) => {
    const rowW = row.length * BOX.w + (row.length - 1) * BOX.gx;
    let x = (width - rowW) / 2;
    for (const id of row) {
      const c = ctx.has(id) && !own.includes(id);
      const w = c ? BOX.ctxW : BOX.w, h = c ? BOX.ctxH : BOX.h;
      nodes.push({ id, x: Math.round(x + (BOX.w - w) / 2), y: BOX.pad + r * (BOX.h + BOX.gy) + Math.round((BOX.h - h) / 2), w, h, ctx: c });
      x += BOX.w + BOX.gx;
    }
  });
  const height = BOX.pad * 2 + dense.length * BOX.h + Math.max(0, dense.length - 1) * BOX.gy;
  return { nodes, edges: [...edges.values()], width, height };
}
const rank = (s: MapState) => ({ ok: 0, planned: 1, unknown: 1, work: 2, blocked: 3 })[s];

/** The path from the top to a system (breadcrumbs), outermost first. */
export function pathTo(map: Pick<ProjectMap, 'elements'>, id: string | null): MapElement[] {
  const out: MapElement[] = [];
  for (let cur = id ? map.elements.find(e => e.id === id) : undefined, n = 0; cur && n < 50; n++) { out.unshift(cur); cur = cur.parent ? map.elements.find(e => e.id === cur!.parent) : undefined; }
  return out;
}

/** The map as text, for the Orchestrator (app_project_map read) and the agents (project_map_read): one line per element
 *  with its status, then the links, then what waits for the user. */
export function mapText(v: Pick<ProjectMapView, 'map' | 'agents' | 'changed'> & Partial<Pick<ProjectMapView, 'works' | 'plans'>>, now: number): string {
  const { map } = v;
  const st = (x: { status: MapState; confirmedAt: number }, id: string) => { const s = shownStatus(x, now, v.changed[id]); return s.stale ? 'da verificare' : LABEL_IT[s.status]; };
  const MARK = { todo: '○', now: '●', done: '✓', blocked: '✕' } as const;
  const works = (id: string) => { const w = v.works?.[id]; return w?.length ? ` · lavori: ${w.map(x => `${MARK[x.state]} ${x.title}`).join('; ')}` : ''; };
  const plans = (v.plans ?? []).map(p => `- «${p.title}» (chatId ${p.chatId}): ${p.phase === 'proposed' ? 'aspetta «Approva e parti»' : p.phase === 'revising' ? 'in revisione' : p.phase === 'done' ? 'finito' : 'in corso'}, ${p.done}/${p.steps} passi`);
  const who = (id: string) => v.agents.filter(a => a.elements.includes(id)).map(a => `${a.title} (${a.mark})`).join(', ');
  const line = (e: MapElement, depth: number) => `${'  '.repeat(depth)}- ${e.id} · ${e.kind} · ${e.name} — ${st(e, e.id)}${e.note ? `: ${e.note}` : ''}${e.actor === 'user' && e.status === 'blocked' ? ' [tocca all\'utente]' : ''}${who(e.id) ? ` · agenti: ${who(e.id)}` : ''}${works(e.id)}`;
  const tree = (parent: string | undefined, depth: number): string[] => map.elements.filter(e => e.parent === parent).flatMap(e => [line(e, depth), ...tree(e.id, depth + 1)]);
  const links = map.links.map(l => `- ${l.id}: ${l.from} → ${l.to} «${l.label}» — ${st(l, l.id)}${l.note ? `: ${l.note}` : ''}`);
  return [`Mappa «${map.title}» (${map.project}, versione ${map.version}, ${map.root ?? 'senza cartella'})`, 'Elementi:', ...tree(undefined, 0),
    ...(links.length ? ['Collegamenti:', ...links] : []), ...(plans.length ? ['Piani sulla mappa:', ...plans] : []), ...(map.corrections.length ? ['Correzioni dell\'utente (da rispettare):', ...map.corrections.map(c => `- ${c}`)] : [])].join('\n');
}
export const LABEL_IT: Record<MapState, string> = { ok: 'funziona', work: 'in lavorazione', blocked: 'bloccato', unknown: 'da capire', planned: 'previsto' };
