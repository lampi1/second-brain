// The project maps on disk (ADR 0271): <brain>/projects/<project>/map.json (the current version) and history.jsonl (one
// line per version, the whole map with who saved it and why), so the map lives with the rest of the user's knowledge,
// every agent can read it, and the history plays the project from its first drawing to now. The history keeps its first
// line and the last HISTORY_MAX - 1: a status update is a version too, and a long project must not grow the file
// without end. The brain is the user's folder (edited by hand, synced): a file that is not a map reads as no map, never
// breaks the others, and a map's name is always its folder's. Used by projectmap/service.ts; pinned by
// test/unit/projectmap-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { waitingOf } from '@shared/project-map-status';
import { MAP_LIMITS, canHold, canSitInside, isMapHref, isMapLayout, prunePaths, type MapPath, type MapVersionInfo, type ProjectMap, type ProjectMapInfo } from '@shared/project-map';

export const HISTORY_MAX = 400;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A parsed file as a map of `project` (its folder), or null when it is not one: the shape every reader relies on. */
export function asMap(v: unknown, project: string): ProjectMap | null {
  if (!obj(v) || !num(v.version) || !Array.isArray(v.elements)) return null;
  // the short lists of what tells a piece (ADR 0316): strings only; a key file needs its path and its line
  // held to the drawing's limits, so a later edit (checkMap) does not refuse what was read; a key file stays inside the root
  const LIM = { rules: [MAP_LIMITS.rules, MAP_LIMITS.rule], keeps: [MAP_LIMITS.keeps, MAP_LIMITS.rule], why: [MAP_LIMITS.why, MAP_LIMITS.rule] } as const;
  const strs = (x: unknown, k: keyof typeof LIM) => (Array.isArray(x) ? x.filter(str).map(s => s.slice(0, LIM[k][1])).filter(Boolean).slice(0, LIM[k][0]) : undefined);
  const inside = (p: string) => !!p && !p.startsWith('/') && !p.startsWith('\\') && !/^[a-z]:/i.test(p) && !p.split(/[\\/]/).includes('..');
  const files = (x: unknown) => (Array.isArray(x) ? x.filter(f => obj(f) && str(f.path) && str(f.what) && inside(f.path))
    .map(f => ({ path: (f.path as string).slice(0, MAP_LIMITS.path), what: (f.what as string).slice(0, MAP_LIMITS.keyWhat) })).slice(0, MAP_LIMITS.keyFiles) : undefined);
  const elements = v.elements.filter(e => obj(e) && str(e.id) && str(e.kind) && str(e.name) && str(e.status)).map(e => {
    const x = { ...(e as Record<string, unknown>) };
    for (const k of ['rules', 'keeps', 'why'] as const) { const l = strs(x[k], k); if (l?.length) x[k] = l; else delete x[k]; }
    const kf = files(x.keyFiles); if (kf?.length) x.keyFiles = kf; else delete x.keyFiles;
    // #443: a layout the drawing knows, a real «together», proofs and links held to their shape and limits
    if (!isMapLayout(x.layout)) delete x.layout;
    if (x.par !== true) delete x.par;
    delete x.busy; delete x.waits; // the live view's own marks (#456), never saved ones
    const proofs = Array.isArray(x.proofs) ? x.proofs.filter(f => obj(f) && str(f.text) && f.text).map(f => ({ text: (f.text as string).slice(0, MAP_LIMITS.proof), ...(str(f.file) && inside(f.file) ? { file: f.file.slice(0, MAP_LIMITS.path) } : {}), ...(isMapHref(f.href) ? { href: f.href } : {}) })).slice(0, MAP_LIMITS.proofs) : [];
    if (proofs.length) x.proofs = proofs; else delete x.proofs;
    const refs = Array.isArray(x.refs) ? x.refs.filter(f => obj(f) && str(f.label) && f.label && isMapHref(f.href)).map(f => ({ label: (f.label as string).slice(0, MAP_LIMITS.label), href: f.href as string })).slice(0, MAP_LIMITS.refs) : [];
    if (refs.length) x.refs = refs; else delete x.refs;
    return { ...x, evidence: Array.isArray(x.evidence) ? x.evidence.filter(str) : [], confirmedAt: num(x.confirmedAt) ? x.confirmedAt : 0 };
  }) as unknown as ProjectMap['elements'];
  if (!elements.length) return null;
  // a parent that cannot hold a piece (missing, a person, a loop, too deep: a hand-edited file) is dropped; a part sits in
  // a system or in another part (ADR 0316), a step in its phase (#443)
  const byId = new Map(elements.map(e => [e.id, e]));
  const drop = elements.filter(e => {
    if (e.parent === undefined) return false;
    const p = byId.get(e.parent);
    const seen = new Set<string>([e.id]);
    let ok = !!p && canHold(p.kind) && canSitInside(e.kind);
    for (let q: string | undefined = e.parent; ok && q; q = byId.get(q)?.parent) { if (seen.has(q)) ok = false; seen.add(q); }
    return !ok || seen.size - 1 > MAP_LIMITS.depth;
  });
  for (const e of drop) delete (e as { parent?: string }).parent; // judged on the file as read, so a loop drops every parent in it
  const ids = new Set(elements.map(e => e.id));
  const links = (Array.isArray(v.links) ? v.links : []).filter(l => obj(l) && str(l.id) && str(l.from) && str(l.to) && ids.has(l.from) && ids.has(l.to) && str(l.status))
    .map(l => l as Record<string, unknown>)
    // an arrow to the next step has no status of its own (#443): a file written by hand cannot make it wait for anyone
    .map(l => ({ ...l, label: str(l.label) ? l.label : '', confirmedAt: num(l.confirmedAt) ? l.confirmedAt : 0, ...(l.kind === 'next' ? { kind: 'next', status: 'ok', actor: undefined } : { kind: undefined }) })) as unknown as ProjectMap['links'];
  return {
    ...(v as unknown as ProjectMap), project, title: str(v.title) && v.title ? v.title : project,
    updatedAt: num(v.updatedAt) ? v.updatedAt : 0, by: str(v.by) ? v.by : '', summary: str(v.summary) ? v.summary : '',
    ...(str(v.root) && v.root ? { root: v.root } : { root: undefined }), elements, links,
    corrections: Array.isArray(v.corrections) ? v.corrections.filter(str) : [],
    ...pathsOf(v.paths, ids), layout: isMapLayout(v.layout) ? v.layout : undefined,
  };
}

/** The walks of a file (ADR 0316): only well formed ones, each stop on an element still drawn. */
function pathsOf(v: unknown, ids: ReadonlySet<string>): { paths: MapPath[] | undefined } {
  if (!Array.isArray(v)) return { paths: undefined };
  const ok = v.filter(x => obj(x) && str(x.id) && str(x.question) && Array.isArray(x.stops)).map(x => ({
    id: x.id as string, question: x.question as string,
    stops: (x.stops as unknown[]).filter((s): s is Record<string, unknown> => obj(s) && str(s.on) && str(s.text)).map(s => ({ on: s.on as string, text: s.text as string, ...(str(s.file) && s.file ? { file: s.file } : {}) })),
  }));
  const paths = prunePaths(ok, ids);
  return { paths: paths.length ? paths : undefined };
}

export class ProjectMapStore {
  /** the history's summaries per project, read again only when the file changed (the page reloads on every event) */
  private cache = new Map<string, { key: string; infos: MapVersionInfo[] }>();

  constructor(private readonly brainRoot: () => string | null) {}

  /** <brain>/projects, or null without a brain */
  dir(): string | null { const b = this.brainRoot(); return b ? path.join(b, 'projects') : null; }

  private folder(project: string): string {
    const d = this.dir();
    if (!d) throw new Error('nessun brain collegato: la mappa vive nel brain');
    if (!SLUG.test(project)) throw new Error(`progetto non valido: ${project.slice(0, 60)}`);
    return path.join(d, project);
  }

  list(): ProjectMapInfo[] {
    const d = this.dir();
    if (!d) return [];
    let names: string[] = [];
    try { names = fs.readdirSync(d).filter(n => SLUG.test(n)); } catch { return []; }
    return names.map(n => this.get(n)).filter((m): m is ProjectMap => !!m)
      .map(m => ({ project: m.project, title: m.title, version: m.version, updatedAt: m.updatedAt, elements: m.elements.length,
        waiting: waitingOf(m) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(project: string): ProjectMap | null {
    try { return asMap(JSON.parse(fs.readFileSync(path.join(this.folder(project), 'map.json'), 'utf8')), project); } catch { return null; }
  }

  private lines(project: string): string[] {
    try { return fs.readFileSync(path.join(this.folder(project), 'history.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }

  history(project: string): MapVersionInfo[] {
    let key = '';
    try { const st = fs.statSync(path.join(this.folder(project), 'history.jsonl')); key = `${st.mtimeMs}:${st.size}`; } catch { return []; }
    const hit = this.cache.get(project);
    if (hit?.key === key) return hit.infos;
    const infos = this.lines(project).flatMap(l => {
      try { const m = asMap(JSON.parse(l), project); return m ? [{ version: m.version, at: m.updatedAt, by: m.by, summary: m.summary }] : []; } catch { return []; }
    });
    this.cache.set(project, { key, infos });
    return infos;
  }

  /** One version as it was (the history's slider). */
  version(project: string, version: number): ProjectMap | null {
    for (const l of this.lines(project)) {
      try { const m = asMap(JSON.parse(l), project); if (m?.version === version) return m; } catch { /* a broken line is skipped */ }
    }
    return null;
  }

  /** Writes the map as the next version (map.json atomically, then one history line). */
  save(map: ProjectMap): ProjectMap {
    const dir = this.folder(map.project);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'map.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(map, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    const hist = path.join(dir, 'history.jsonl');
    const lines = [...this.lines(map.project), JSON.stringify(map)];
    if (lines.length > HISTORY_MAX) {
      const kept = [lines[0]!, ...lines.slice(lines.length - (HISTORY_MAX - 1))];
      fs.writeFileSync(`${hist}.tmp`, `${kept.join('\n')}\n`);
      fs.renameSync(`${hist}.tmp`, hist);
    } else fs.appendFileSync(hist, `${JSON.stringify(map)}\n`);
    return map;
  }
}
