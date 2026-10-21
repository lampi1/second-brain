// The brain model's change log (ADR 0077): every change a maintenance job or the user's skill toggle makes to skills,
// roles, rules or memory is one entry, with what changed, why, the evidence and what undoes it: the files' text before
// and after (a created file has no "before", a removed one no "after") and, for a role, the version before and after.
// Rollback restores the "before" only while the target still is the "after" (a newer change, or the user's own edit on
// disk, is never overwritten: undo the newer change first). Kept in userData (brain-changes.json, last 400 entries,
// snapshots of at most 256 KB each): the app's machinery stays out of the brain. Each entry keeps the seed of its evidence
// claim (evidence.ts `seal`: the roles and the skill it is measured on), sealed when it is recorded (ADR 0109). Used by brainmodel/service.ts and
// jobs.ts; unit tests: test/unit/brainmodel/changes.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAINTENANCE_JOBS, type BrainChange } from '../../shared/brain-model';
import { readLocal, writeLocal } from '../agents/local-store';
import { validSeed, type ClaimSeed } from './evidence';

export interface FileSnapshot { file: string; before: string | null; after: string | null }
/** A role's version before and after. */
export interface AgentSnapshot { id: string; before: number; after: number }
export interface StoredChange extends Omit<BrainChange, 'canRollback' | 'claim'> { files: FileSnapshot[]; agent?: AgentSnapshot; seed?: ClaimSeed }
/** Seals a change's evidence claim when it is recorded (evidence.ts seal with the roles of that moment). */
export type Sealer = (c: Pick<BrainChange, 'kind' | 'action' | 'target'>) => ClaimSeed | undefined;
export interface AgentRestorer { activeVersion(id: string): number | null; restore(id: string, version: number, expected: number): void }
const JOBS: readonly string[] = [...MAINTENANCE_JOBS, 'user'];

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
  fs.renameSync(tmp, file);
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

  /** Applies the file writes of one change and records it; nothing is recorded when no file actually changes. */
  apply(change: Omit<StoredChange, 'id' | 'at' | 'files'>, writes: { file: string; text: string | null }[], agent?: AgentSnapshot): StoredChange | null {
    const files: FileSnapshot[] = [];
    for (const w of writes) {
      const before = read(w.file);
      // a file too big to keep a copy of is never changed by a job: it could not be undone
      if (before === w.text || (before?.length ?? 0) > SNAP || (w.text?.length ?? 0) > SNAP) continue;
      writeText(w.file, w.text);
      files.push({ file: w.file, before, after: w.text });
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
  canRollback(c: StoredChange, agents: AgentRestorer): boolean {
    if (c.rolledBackAt) return false;
    if (c.files.some(f => read(f.file) !== f.after)) return false;
    if (c.agent && agents.activeVersion(c.agent.id) !== c.agent.after) return false;
    return true;
  }
  /** The renderer's view, newest first. */
  list(agents: AgentRestorer, limit = 120): BrainChange[] {
    return [...this.entries].reverse().slice(0, limit).map(({ files: _f, agent: _a, seed: _s, ...c }) => { void _f; void _a; void _s; return { ...c, canRollback: this.canRollback(this.entries.find(e => e.id === c.id)!, agents) }; });
  }
  rollback(id: string, agents: AgentRestorer): StoredChange {
    const c = this.entries.find(e => e.id === id);
    if (!c) throw new Error('Modifica non trovata.');
    if (!this.canRollback(c, agents)) throw new Error('Questa modifica non si può più annullare: è già annullata, o il file o il ruolo sono cambiati dopo. Annulla prima la modifica più recente.');
    if (c.agent) agents.restore(c.agent.id, c.agent.before, c.agent.after);
    for (const f of [...c.files].reverse()) writeText(f.file, f.before);
    c.rolledBackAt = this.now();
    this.persist();
    return structuredClone(c);
  }
  /** Who made a file (the latest change that wrote it and is not undone): for "made by" on the Skill page. */
  madeBy(file: string): StoredChange['job'] | null {
    for (const c of [...this.entries].reverse()) if (!c.rolledBackAt && c.files.some(f => path.resolve(f.file) === path.resolve(file) && f.after !== null)) return c.job;
    return null;
  }
}
