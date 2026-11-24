// The work maps on disk (ADR 0342): userData/work-maps/<id>/map.json (the current version, the job's plan included) and
// history.jsonl (one line per version, the whole map). They are the app's own record, so they outlive the chat that
// worked on them and a restart. Nothing is ever deleted: a finished map is archived, not removed. The history keeps its
// first line and the last HISTORY_MAX - 1 (a step's progress is a version too). A file that does not read is skipped with
// a warning and never breaks the others. live.json beside them is what the live status remembers over a restart (when a
// chat was last seen at work, the stops told to the Orchestrator): never a version, and lost without harm. Used by workmap/service.ts; pinned by test/unit/workmap-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { MapVersionInfo } from '@shared/project-map';
import { readWorkMap, WORK_MAP_ID, type WorkMap } from '@shared/work-map';
import { renameWithRetry } from '../agents/local-store';
import { errText, log } from '../log';

export const HISTORY_MAX = 100;

export class WorkMapStore {
  /** the history's summaries per map, read again only when the file changed */
  private cache = new Map<string, { key: string; infos: MapVersionInfo[] }>();

  constructor(private readonly dir: string) {}

  private folder(id: string): string {
    if (!WORK_MAP_ID.test(id)) throw new Error(`mappa non valida: ${String(id).slice(0, 60)}`);
    return path.join(this.dir, id);
  }

  /** Every saved map, as it is now. */
  load(): WorkMap[] {
    let names: string[];
    try { names = fs.readdirSync(this.dir).filter(n => WORK_MAP_ID.test(n)); } catch { return []; }
    return names.flatMap(id => {
      const file = path.join(this.dir, id, 'map.json');
      if (!fs.existsSync(file)) return [];
      let cause = 'not a work map';
      try {
        const m = readWorkMap(JSON.parse(fs.readFileSync(file, 'utf8')), id);
        if (m) return [m];
      } catch (e) { cause = errText(e); }
      // the last version of its history still tells it: the file alone is broken
      const last = this.versions(id).at(-1);
      log.warn('workmap', 'a work map did not read', { cause, hint: last ? 'its last saved version is used' : 'the map stays on disk and is not shown', data: { id } });
      return last ? [last] : [];
    });
  }

  private lines(id: string): string[] {
    try { return fs.readFileSync(path.join(this.folder(id), 'history.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }
  private versions(id: string): WorkMap[] {
    return this.lines(id).flatMap(l => { try { const m = readWorkMap(JSON.parse(l), id); return m ? [m] : []; } catch { return []; /* a broken line is skipped */ } });
  }

  history(id: string): MapVersionInfo[] {
    let key = '';
    try { const st = fs.statSync(path.join(this.folder(id), 'history.jsonl')); key = `${st.mtimeMs}:${st.size}`; } catch { return []; }
    const hit = this.cache.get(id);
    if (hit?.key === key) return hit.infos;
    const infos = this.versions(id).map(m => ({ version: m.version, at: m.updatedAt, by: m.by, summary: m.summary }));
    this.cache.set(id, { key, infos });
    return infos;
  }

  /** One version as it was. */
  version(id: string, version: number): WorkMap | null { return this.versions(id).find(m => m.version === version) ?? null; }

  /** What the live status remembers; null = nothing yet, or a file that does not read. */
  loadLive(): unknown {
    const file = path.join(this.dir, 'live.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      log.warn('workmap', 'the live status of the work maps did not read', { cause: errText(e), hint: 'it starts again from what the chats say now' });
      return null;
    }
  }
  saveLive(v: unknown): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'live.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(v));
    renameWithRetry(`${file}.tmp`, file);
  }

  /** Writes the map as its next version: map.json atomically, then one history line. */
  save(map: WorkMap): void {
    const dir = this.folder(map.id), line = JSON.stringify(map);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'map.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(map, null, 2)}\n`);
    renameWithRetry(`${file}.tmp`, file);
    const hist = path.join(dir, 'history.jsonl'), lines = [...this.lines(map.id), line];
    if (lines.length > HISTORY_MAX) {
      fs.writeFileSync(`${hist}.tmp`, `${[lines[0]!, ...lines.slice(lines.length - (HISTORY_MAX - 1))].join('\n')}\n`);
      renameWithRetry(`${hist}.tmp`, hist);
    } else fs.appendFileSync(hist, `${line}\n`);
  }
}
