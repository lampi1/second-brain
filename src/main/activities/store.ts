// «Attività pianificate» (ADR 0374): the engine's state file, userData/activities.json. What it keeps: the catalog, each
// activity's cursor (what the source already gave), its next run time, its last ACTIVITY_HISTORY_MAX runs and the global
// pause. Written atomically (temp file + rename, a direct write if the rename is refused for a moment on Windows) and
// rechecked on load, so a hand-edited or half-written file never breaks the start (it starts empty and says so in the log).
// The next run time is saved BEFORE a run starts (service.ts), so a crash during a run never repeats it at the next start.
// Used by service.ts; tests: test/unit/activities-store.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { ACTIVITY_SOURCES, validateActivityInput, trimHistory, type Activity, type ActivityCursor, type ActivityRun } from '../../shared/activities';
import { log, errText } from '../log';

export interface ActivitiesSaved {
  paused: boolean;
  activities: Activity[];
  cursors: Record<string, ActivityCursor>;
  /** the next automatic run (ms); null = none planned */
  nextAt: Record<string, number | null>;
  history: Record<string, ActivityRun[]>;
}

export const emptySaved = (): ActivitiesSaved => ({ paused: false, activities: [], cursors: {}, nextAt: {}, history: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cursorOf(v: unknown): ActivityCursor {
  const o = isObj(v) ? v : {};
  return { at: finite(o.at) ? o.at : 0, keys: Array.isArray(o.keys) ? o.keys.filter((k): k is string => typeof k === 'string') : [] };
}

function runOf(v: unknown, activityId: string): ActivityRun | null {
  if (!isObj(v) || typeof v.id !== 'string' || !finite(v.at)) return null;
  const status = v.status;
  if (status !== 'idle' && status !== 'quiet' && status !== 'proposed' && status !== 'capped' && status !== 'error') return null;
  const n = (x: unknown): number => (finite(x) ? x : 0);
  const nn = (x: unknown): number | null => (finite(x) ? x : null);
  return {
    id: v.id, activityId, at: v.at, durationMs: n(v.durationMs), trigger: v.trigger === 'manual' ? 'manual' : 'timer', status,
    read: n(v.read), kept: n(v.kept), proposals: n(v.proposals), usedModel: v.usedModel === true, tokens: nn(v.tokens), costUsd: nn(v.costUsd),
    model: typeof v.model === 'string' ? v.model : null, ...(typeof v.error === 'string' ? { error: v.error } : {}),
  };
}

/** The saved state from parsed JSON, every row checked again (a bad activity is dropped, never fixed silently). */
export function savedOf(raw: unknown): ActivitiesSaved {
  const out = emptySaved();
  if (!isObj(raw)) return out;
  out.paused = raw.paused === true;
  for (const a of Array.isArray(raw.activities) ? raw.activities : []) {
    if (!isObj(a) || typeof a.id !== 'string' || !a.id || out.activities.some(x => x.id === a.id)) continue;
    const v = validateActivityInput(a);
    if (!v.ok || !(ACTIVITY_SOURCES as readonly string[]).includes(v.value.source)) continue;
    out.activities.push({ ...v.value, id: a.id, createdAt: finite(a.createdAt) ? a.createdAt : 0, updatedAt: finite(a.updatedAt) ? a.updatedAt : 0 });
  }
  const cursors = isObj(raw.cursors) ? raw.cursors : {}, next = isObj(raw.nextAt) ? raw.nextAt : {}, hist = isObj(raw.history) ? raw.history : {};
  for (const a of out.activities) {
    out.cursors[a.id] = cursorOf(cursors[a.id]);
    out.nextAt[a.id] = finite(next[a.id]) ? next[a.id] as number : null;
    out.history[a.id] = trimHistory((Array.isArray(hist[a.id]) ? hist[a.id] as unknown[] : []).map(r => runOf(r, a.id)).filter((r): r is ActivityRun => r !== null));
  }
  return out;
}

export class ActivitiesStore {
  constructor(private readonly file: string) {}

  load(): ActivitiesSaved {
    try { return savedOf(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('activities', 'activities.json unreadable, starting empty', { cause: errText(e), hint: 'the catalog is empty until an activity is saved again' });
      return emptySaved();
    }
  }

  /** Temp file + rename; on a refused rename (antivirus, indexer) retry briefly, then write the file directly. */
  save(s: ActivitiesSaved): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const text = JSON.stringify(s);
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, text);
      for (let i = 0; i < 5; i++) {
        try { fs.renameSync(tmp, this.file); return; } catch (e) {
          if (!['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
        }
      }
      fs.writeFileSync(this.file, text);
      try { fs.unlinkSync(tmp); } catch { /* left behind: harmless */ }
    } catch (e) {
      log.warn('activities', 'activities.json not saved', { cause: errText(e), hint: 'check userData is writable; the activities keep working from memory' });
    }
  }
}
