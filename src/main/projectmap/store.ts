// The project maps on disk (ADR 0271): <brain>/projects/<project>/map.json (the current version) and history.jsonl (one
// line per version, the whole map with who saved it and why), so the map lives with the rest of the user's knowledge,
// every agent can read it, and the history plays the project from its first drawing to now. The history keeps its first
// line and the last HISTORY_MAX - 1: a status update is a version too, and a long project must not grow the file
// without end. The brain is the user's folder (edited by hand, synced): a file that is not a map reads as no map, never
// breaks the others, and a map's name is always its folder's. Used by projectmap/service.ts; pinned by
// test/unit/projectmap-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { MapVersionInfo, ProjectMap, ProjectMapInfo } from '@shared/project-map';

export const HISTORY_MAX = 400;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A parsed file as a map of `project` (its folder), or null when it is not one: the shape every reader relies on. */
export function asMap(v: unknown, project: string): ProjectMap | null {
  if (!obj(v) || !num(v.version) || !Array.isArray(v.elements)) return null;
  const elements = v.elements.filter(e => obj(e) && str(e.id) && str(e.kind) && str(e.name) && str(e.status)).map(e => {
    const x = e as Record<string, unknown>;
    return { ...x, evidence: Array.isArray(x.evidence) ? x.evidence.filter(str) : [], confirmedAt: num(x.confirmedAt) ? x.confirmedAt : 0 };
  }) as unknown as ProjectMap['elements'];
  if (!elements.length) return null;
  // a parent that is not a system on the top level (missing, a part, a loop: a hand-edited file) is dropped
  const top = new Map(elements.map(e => [e.id, e]));
  for (const e of elements) {
    const p = e.parent === undefined ? undefined : top.get(e.parent);
    if (e.parent !== undefined && (!p || (p.kind !== 'system' && p.kind !== 'external') || p.parent !== undefined)) delete (e as { parent?: string }).parent;
  }
  const ids = new Set(elements.map(e => e.id));
  const links = (Array.isArray(v.links) ? v.links : []).filter(l => obj(l) && str(l.id) && str(l.from) && str(l.to) && ids.has(l.from) && ids.has(l.to) && str(l.status))
    .map(l => ({ ...(l as Record<string, unknown>), label: str((l as Record<string, unknown>).label) ? (l as Record<string, unknown>).label : '', confirmedAt: num((l as Record<string, unknown>).confirmedAt) ? (l as Record<string, unknown>).confirmedAt : 0 })) as unknown as ProjectMap['links'];
  return {
    ...(v as unknown as ProjectMap), project, title: str(v.title) && v.title ? v.title : project,
    updatedAt: num(v.updatedAt) ? v.updatedAt : 0, by: str(v.by) ? v.by : '', summary: str(v.summary) ? v.summary : '',
    ...(str(v.root) && v.root ? { root: v.root } : { root: undefined }), elements, links,
    corrections: Array.isArray(v.corrections) ? v.corrections.filter(str) : [],
  };
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
        waiting: [...m.elements, ...m.links].filter(x => x.status === 'blocked' && x.actor === 'user').length }))
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
