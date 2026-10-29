// The brain model's change log (ADR 0077): every change a maintenance job or the user's skill toggle makes to skills,
// roles, rules or memory is one entry, with what changed, why, the evidence and what undoes it: the files' text before
// and after (a created file has no "before", a removed one no "after"), for a role, the version before and after, and for
// the maintenance's memory tidy-up the facts it retired and wrote (rules/memory-records.ts tidyMemory, ADR 0129).
// Rollback restores the "before" only while the target still is the "after" (a newer change, or the user's own edit on
// disk, is never overwritten: undo the newer change first). Kept in userData (brain-changes.json, last 400 entries,
// snapshots of at most 256 KB each): the app's machinery stays out of the brain. Each entry keeps the seed of its evidence
// claim (evidence.ts `seal`: the roles and the skill it is measured on), sealed when it is recorded (ADR 0109). A
// maintenance write (every job but the user's own) to a markdown file must be itemized (item-delta.ts, ADR 0194): a line
// it loses is listed as removed with a reason, else nothing is written and DeltaRefused is thrown. A change may carry its
// «riuscito se…» criterion and, a week later, its check (success-check.ts, ADR 0194). Used by brainmodel/service.ts and
// jobs.ts; unit tests: test/unit/brainmodel/changes.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAINTENANCE_JOBS, type BrainChange } from '../../shared/brain-model';
import { readLocal, writeLocal } from '../agents/local-store';
import { validSeed, type ClaimSeed } from './evidence';
import type { MemoryTidyUndo } from '../rules/memory-records';
import type { SuccessCheck } from '../../shared/maintenance-research';
import { checkDelta, DeltaRefused, guarded, type RemovedItem } from './item-delta';
import { log } from '../log';

export interface FileSnapshot { file: string; before: string | null; after: string | null }
/** A role's version before and after. */
export interface AgentSnapshot { id: string; before: number; after: number }
export interface StoredChange extends Omit<BrainChange, 'canRollback' | 'claim'> { files: FileSnapshot[]; agent?: AgentSnapshot; seed?: ClaimSeed; memory?: MemoryTidyUndo; migrationIgnored?: boolean }
/** Seals a change's evidence claim when it is recorded (evidence.ts seal with the roles of that moment). */
export type Sealer = (c: Pick<BrainChange, 'kind' | 'action' | 'target'>) => ClaimSeed | undefined;
export interface AgentRestorer {
  activeVersion(id: string): number | null; restore(id: string, version: number, expected: number): void;
  /** the memory store's side (absent = a memory tidy-up cannot be undone here) */
  memory?: { canUndo(u: MemoryTidyUndo): boolean; undo(u: MemoryTidyUndo): void };
}
const JOBS: readonly string[] = [...MAINTENANCE_JOBS, 'user', 'research'];

const MAX = 400, SNAP = 256 * 1024;
const read = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** Writes `text` (null = removes the file, and its folder when it is left empty) atomically. */
export function writeText(file: string, text: string | null): void {
  if (text === null) {
    fs.rmSync(file, { force: true });
    const dir = path.dirname(file);
    try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty or gone */ }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

export class ChangeLog {
  private readonly file: string;
  private entries: StoredChange[];
  constructor(userData: string, private readonly now: () => number = Date.now, private readonly sealer?: Sealer) {
    this.file = path.join(userData, 'brain-changes.json');
    const raw = readLocal(this.file) as { changes?: StoredChange[] } | undefined;
    // entries of a kind this build does not know are skipped (they stay in the file until it rolls over)
    this.entries = Array.isArray(raw?.changes) ? raw!.changes.filter(c => c && typeof c.id === 'string' && Array.isArray(c.files) && JOBS.includes(c.job)) : [];
    // a seed of a shape this build did not write is dropped: sealed again by sealMissing
    for (const e of this.entries) { const s = validSeed(e.seed); if (s) e.seed = s; else delete e.seed; }
  }
  private persist(): void { writeLocal(this.file, { version: 1, changes: this.entries.slice(-MAX) }); }

  /** Applies the file writes of one change and records it; nothing is recorded when no file actually changes. All or
   *  nothing: when one file is too big to keep a copy of (it could not be undone), none is written (a move that wrote
   *  only its pointers would lose what it moved). A maintenance write to a markdown file loses only the items it lists in
   *  `removed` (ADR 0194): otherwise none is written and DeltaRefused is thrown (logged with cause and hint). */
  apply(change: Omit<StoredChange, 'id' | 'at' | 'files'>, writes: { file: string; text: string | null; removed?: RemovedItem[] }[], agent?: AgentSnapshot): StoredChange | null {
    const todo = writes.map(w => ({ ...w, before: read(w.file) })).filter(w => w.before !== w.text);
    if (todo.some(w => (w.before?.length ?? 0) > SNAP || (w.text?.length ?? 0) > SNAP)) return null;
    if (change.job !== 'user') {
      for (const w of todo) {
        if (!guarded(w.file)) continue;
        const v = checkDelta(w.before, w.text, w.removed);
        if (v.ok) continue;
        log.warn('brain', 'maintenance write refused: not itemized', { data: { job: change.job, kind: change.kind, target: change.target, missing: v.missing.length }, cause: v.cause, hint: v.hint });
        throw new DeltaRefused(w.file, v);
      }
    }
    const files: FileSnapshot[] = [];
    try {
      for (const w of todo) {
        // Freeze the actual destination at write time: aliases such as macOS /var must not lose provenance,
        // and a later retargeted directory link must never redirect this change's evidence or rollback.
        if (w.text !== null) fs.mkdirSync(path.dirname(w.file), { recursive: true });
        const file = path.join(fs.realpathSync(path.dirname(w.file)), path.basename(w.file));
        writeText(file, w.text);
        files.push({ file, before: w.before, after: w.text });
      }
    } catch (e) {
      // all or nothing: a write that fails puts back the files this change already wrote, so none is left without its Annulla
      for (const f of [...files].reverse()) { try { writeText(f.file, f.before); } catch { /* best effort: the error below says it failed */ } }
      throw e;
    }
    if (!files.length && !agent) return null;
    return this.record(change, files, agent);
  }
  record(change: Omit<StoredChange, 'id' | 'at' | 'files'>, files: FileSnapshot[], agent?: AgentSnapshot): StoredChange {
    let seed = change.seed;
    try { seed ??= this.sealer?.(change); } catch { /* unsealed: the claim is sealed when it is first shown */ }
    const entry: StoredChange = { ...change, id: randomBytes(8).toString('hex'), at: this.now(), files, ...(agent ? { agent } : {}), ...(seed ? { seed } : {}) };
    this.entries = [...this.entries, entry].slice(-MAX);
    this.persist();
    return structuredClone(entry);
  }
  all(): StoredChange[] { return structuredClone(this.entries); }
  /** Backfill a forgotten source into its original removal, so that original Undo also restores migration eligibility.
   *  Existing file snapshots keep their original before text; failure restores both disk and the retained entry. */
  rememberMigrationRemoval(id: string, writes: { file: string; text: string | null }[]): void {
    const entry = this.entries.find(c => c.id === id);
    if (!entry || entry.rolledBackAt || entry.migrationIgnored || entry.kind !== 'skill' || entry.action !== 'remove') return;
    const before = structuredClone(entry), applied: { file: string; text: string | null }[] = [];
    try {
      for (const w of writes) {
        const text = read(w.file);
        if ((text?.length ?? 0) > SNAP || (w.text?.length ?? 0) > SNAP) throw new Error('Migration decision is too large');
        if (text === w.text) continue;
        if (w.text !== null) fs.mkdirSync(path.dirname(w.file), { recursive: true });
        const file = path.join(fs.realpathSync(path.dirname(w.file)), path.basename(w.file));
        writeText(file, w.text); applied.push({ file, text });
        const prior = entry.files.find(f => f.file === file);
        if (prior) prior.after = w.text; else entry.files.push({ file, before: text, after: w.text });
      }
      entry.migrationIgnored = true; this.persist();
    } catch (e) {
      Object.assign(entry, before); if (!before.migrationIgnored) delete entry.migrationIgnored;
      for (const w of applied.reverse()) writeText(w.file, w.text);
      throw e;
    }
  }
  /** The week-after check of a change's «riuscito se…» (success-check.ts): kept once, never redone. */
  setCheck(id: string, check: SuccessCheck): void {
    const e = this.entries.find(c => c.id === id);
    if (!e || e.successCheck) return;
    e.successCheck = structuredClone(check);
    this.persist();
  }
  /** Seals the entries recorded without a seed (before ADR 0109, or a dropped one) once, and keeps it. */
  sealMissing(sealer: Sealer): void {
    let changed = false;
    for (const e of this.entries) {
      if (e.seed) continue;
      try { const s = sealer(e); if (s) { e.seed = s; changed = true; } } catch { /* sealed at the next try */ }
    }
    if (changed) this.persist();
  }
  /** The sealed seed of a change (older entries have none: sealed by the caller when shown). */
  seedOf(id: string): ClaimSeed | undefined { const s = this.entries.find(e => e.id === id)?.seed; return s ? structuredClone(s) : undefined; }

  /** Can it still be undone: not undone yet, every file still as the change left it, the role still on its version. */
  canRollback(c: StoredChange, agents: AgentRestorer, readFile: (file: string) => string | null = read): boolean {
    if (c.rolledBackAt) return false;
    if (c.files.some(f => readFile(f.file) !== f.after)) return false;
    if (c.agent && agents.activeVersion(c.agent.id) !== c.agent.after) return false;
    if (c.memory && !agents.memory?.canUndo(c.memory)) return false;
    return true;
  }
  /** The renderer's view, newest first. */
  list(agents: AgentRestorer, limit = 120): BrainChange[] {
    // Many changes refer to the same file. Read it once per view; an actual rollback always rechecks fresh bytes.
    const files = new Map<string, string | null>();
    const current = (file: string) => { if (!files.has(file)) files.set(file, read(file)); return files.get(file)!; };
    return [...this.entries].reverse().slice(0, limit).map(entry => {
      const { files: _f, agent: _a, seed: _s, memory: _m, migrationIgnored: _i, ...c } = entry;
      void _f; void _a; void _s; void _m; void _i;
      return { ...c, canRollback: this.canRollback(entry, agents, current) };
    });
  }
  rollback(id: string, agents: AgentRestorer): StoredChange {
    const c = this.entries.find(e => e.id === id);
    if (!c) throw new Error('Modifica non trovata.');
    if (!this.canRollback(c, agents)) throw new Error('Questa modifica non si può più annullare: è già annullata, o il file o il ruolo sono cambiati dopo. Annulla prima la modifica più recente.');
    if (c.agent) agents.restore(c.agent.id, c.agent.before, c.agent.after);
    if (c.memory) agents.memory!.undo(c.memory);
    for (const f of [...c.files].reverse()) writeText(f.file, f.before);
    c.rolledBackAt = this.now();
    this.persist();
    return structuredClone(c);
  }
  /** Who made a file (the latest change that wrote it and is not undone): for "made by" on the Skill page. */
  madeBy(file: string): StoredChange['job'] | null {
    let current: string;
    try { current = fs.realpathSync(file); } catch { current = path.resolve(file); }
    for (const c of [...this.entries].reverse()) if (!c.rolledBackAt && c.files.some(f => path.resolve(f.file) === current && f.after !== null)) return c.job;
    return null;
  }
}
