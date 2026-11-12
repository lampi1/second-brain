// The project maps on disk (ADR 0271): <brain>/projects/<project>/map.json (the current version) and history.jsonl (one
// line per version, the whole map with who saved it and why), so the map lives with the rest of the user's knowledge,
// every agent can read it, and the history plays the project from its first drawing to now. The history keeps its first
// line and the last HISTORY_MAX - 1: a status update is a version too, and a long project must not grow the file
// without end. Used by projectmap/service.ts; pinned by test/unit/projectmap-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { MapVersionInfo, ProjectMap, ProjectMapInfo } from '@shared/project-map';

export const HISTORY_MAX = 400;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export class ProjectMapStore {
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
    try { return JSON.parse(fs.readFileSync(path.join(this.folder(project), 'map.json'), 'utf8')) as ProjectMap; } catch { return null; }
  }

  private lines(project: string): string[] {
    try { return fs.readFileSync(path.join(this.folder(project), 'history.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }

  history(project: string): MapVersionInfo[] {
    return this.lines(project).flatMap(l => {
      try { const m = JSON.parse(l) as ProjectMap; return [{ version: m.version, at: m.updatedAt, by: m.by, summary: m.summary }]; } catch { return []; }
    });
  }

  /** One version as it was (the history's slider). */
  version(project: string, version: number): ProjectMap | null {
    for (const l of this.lines(project)) {
      try { const m = JSON.parse(l) as ProjectMap; if (m.version === version) return m; } catch { /* a broken line is skipped */ }
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
