// The plans on disk (ADR 0359): userData/plans/<id>/plan.json (the current version, the job's plan included) and history.jsonl
// (one line per version, the whole plan: every save is a version). They are the app's own record, so they outlive the chat
// that worked on them and a restart. Nothing is deleted by an agent or by the app: a finished plan is archived, a deleted one
// goes to the trash (`deletedAt` in the record) and the user restores it; only the user's own «Elimina per sempre» removes the
// folder (`forget`), after the trash. The history keeps its first line and the last HISTORY_MAX - 1. A file that does not read
// is skipped with a warning and never breaks the others. live.json beside them is what the live status remembers over a
// restart (when a chat was last seen at work, the stops told to the Orchestrator): never a version, and lost without harm.
// Used by plans/service.ts and plans/migrate.ts; pinned by test/unit/plans/store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { readPlanRecord, PLAN_ID, type Plan, type PlanVersionInfo } from '@shared/plan';
import { renameWithRetry } from '../agents/local-store';
import { errText, log } from '../log';

export const HISTORY_MAX = 500;

export class PlanStore {
  /** the history's summaries per plan, read again only when the file changed */
  private cache = new Map<string, { key: string; infos: PlanVersionInfo[] }>();

  constructor(private readonly dir: string) {}

  private folder(id: string): string {
    if (!PLAN_ID.test(id)) throw new Error(`piano non valido: ${String(id).slice(0, 60)}`);
    return path.join(this.dir, id);
  }

  /** Every saved plan, as it is now. */
  load(): Plan[] {
    let names: string[];
    try { names = fs.readdirSync(this.dir).filter(n => PLAN_ID.test(n)); } catch { return []; }
    return names.flatMap(id => {
      const file = path.join(this.dir, id, 'plan.json');
      if (!fs.existsSync(file)) return [];
      let cause = 'not a plan';
      try {
        const m = readPlanRecord(JSON.parse(fs.readFileSync(file, 'utf8')), id);
        if (m) return [m];
      } catch (e) { cause = errText(e); }
      // the last version of its history still tells it: the file alone is broken
      const last = this.versions(id).at(-1);
      log.warn('plans', 'a plan did not read', { cause, hint: last ? 'its last saved version is used' : 'the plan stays on disk and is not shown', data: { id } });
      return last ? [last] : [];
    });
  }

  private lines(id: string): string[] {
    try { return fs.readFileSync(path.join(this.folder(id), 'history.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }
  private versions(id: string): Plan[] {
    return this.lines(id).flatMap(l => { try { const m = readPlanRecord(JSON.parse(l), id); return m ? [m] : []; } catch { return []; /* a broken line is skipped */ } });
  }

  history(id: string): PlanVersionInfo[] {
    let key = '';
    try { const st = fs.statSync(path.join(this.folder(id), 'history.jsonl')); key = `${st.mtimeMs}:${st.size}`; } catch { return []; }
    const hit = this.cache.get(id);
    if (hit?.key === key) return hit.infos;
    const infos = this.versions(id).map(m => ({ version: m.version, at: m.updatedAt, by: m.by, summary: m.summary }));
    this.cache.set(id, { key, infos });
    return infos;
  }

  /** One version as it was. */
  version(id: string, version: number): Plan | null { return this.versions(id).find(m => m.version === version) ?? null; }

  /** What the live status remembers; null = nothing yet, or a file that does not read. */
  loadLive(): unknown {
    const file = path.join(this.dir, 'live.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      log.warn('plans', 'the live status of the plans did not read', { cause: errText(e), hint: 'it starts again from what the chats say now' });
      return null;
    }
  }
  saveLive(v: unknown): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'live.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(v));
    renameWithRetry(`${file}.tmp`, file);
  }

  /** Whether a plan folder is there, trash included. */
  has(id: string): boolean { return fs.existsSync(path.join(this.folder(id), 'plan.json')); }

  /** Writes the plan as its next version: plan.json atomically, then one history line. */
  save(plan: Plan): void {
    const dir = this.folder(plan.id), line = JSON.stringify(plan);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(plan, null, 2)}\n`);
    renameWithRetry(`${file}.tmp`, file);
    const hist = path.join(dir, 'history.jsonl'), lines = [...this.lines(plan.id), line];
    if (lines.length > HISTORY_MAX) {
      fs.writeFileSync(`${hist}.tmp`, `${[lines[0]!, ...lines.slice(lines.length - (HISTORY_MAX - 1))].join('\n')}\n`);
      renameWithRetry(`${hist}.tmp`, hist);
    } else fs.appendFileSync(hist, `${line}\n`);
  }

  /** The user's own «Elimina per sempre»: the plan's folder goes. Only a plan already in the trash (the caller checks). */
  forget(id: string): void {
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    this.cache.delete(id);
  }
}
