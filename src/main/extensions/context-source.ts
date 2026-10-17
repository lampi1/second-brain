// Main-only canonical context archive. Only the renderer's explicit AI-context save confirms facts;
// ExtensionService reads this fixed private file, never setup answers, notes, paths or discovered sources.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { maskSecrets } from '../brain/procedures';

export interface FactInput { id: string; key: string; value: string; category: 'constraint' | 'profile' | 'activity' }
export interface ConfirmedFact extends FactInput { confirmation: 'confirmed'; confirmedAt: string }
export interface ConfirmedContextArchive {
  version: 1; revision: number; facts: ConfirmedFact[];
  provenance: null | { source: 'explicit-user-confirmation'; at: string };
}
const MAX_BYTES = 64 * 1024;
const invalid = (): never => { throw new Error('Invalid confirmed context'); };
const empty = (): ConfirmedContextArchive => ({ version: 1, revision: 0, facts: [], provenance: null });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const sensitive = /password|passwd|passphrase|pwd|credential|secret|token|apikey|accesskey|accountkey|subscriptionkey|connectionstring|authorization|privatekey/i;

function parseFacts(input: unknown, confirmed = false): FactInput[] {
  if (!Array.isArray(input) || input.length > 64) return invalid();
  const seen = new Set<string>();
  return input.map((f: unknown) => {
    if (!record(f) || !exact(f, confirmed ? ['id', 'key', 'value', 'category', 'confirmation', 'confirmedAt'] : ['id', 'key', 'value', 'category'])) return invalid();
    if (!identifier(f.id) || !identifier(f.key) || seen.has(f.id) || typeof f.value !== 'string' || !f.value.trim() || f.value.length > 2000 || !['constraint', 'profile', 'activity'].includes(f.category as string)) return invalid();
    if (sensitive.test(`${f.id} ${f.key}`.replace(/[-_\s]/g, '')) || [f.id, f.key, f.value].some(s => maskSecrets(s as string).masked > 0)) throw new Error('Credentials cannot be saved as context');
    if (confirmed && (f.confirmation !== 'confirmed' || !iso(f.confirmedAt))) return invalid();
    seen.add(f.id);
    return { id: f.id, key: f.key, value: f.value, category: f.category as FactInput['category'] };
  });
}
/** Validate a renderer proposal without accepting confirmation/provenance metadata from it. */
export const validateContextFacts = (input: unknown): FactInput[] => parseFacts(input);

/** Fixed trusted userData root only. No user supplied source paths and no automatic confirmation. */
export class ConfirmedContextSource {
  constructor(private readonly userDataDirectory: string, private readonly now: () => Date = () => new Date(), private readonly requested?: (id: string) => unknown) {}

  private location(create = false): string | null {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(this.userDataDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Context directory unavailable');
      if (!create) return null;
      fs.mkdirSync(this.userDataDirectory, { recursive: true });
      stat = fs.lstatSync(this.userDataDirectory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Context directory must be a real directory');
    return path.join(this.userDataDirectory, 'confirmed-user-context.json');
  }

  load(): ConfirmedContextArchive {
    const file = this.location();
    if (!file) return empty();
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw new Error('Context archive unavailable');
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) return invalid();
    const fd = fs.openSync(file, 'r');
    let data: unknown;
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > MAX_BYTES) return invalid();
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count > MAX_BYTES) return invalid();
      try { data = JSON.parse(bytes.subarray(0, count).toString('utf8')); } catch { return invalid(); }
    } finally { fs.closeSync(fd); }
    if (!record(data) || !exact(data, ['version', 'revision', 'facts', 'provenance']) || data.version !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) return invalid();
    const inputs = parseFacts(data.facts, true);
    const provenance = data.provenance;
    if (data.revision === 0) {
      if (inputs.length || provenance !== null) return invalid();
      return empty();
    }
    if (!record(provenance) || !exact(provenance, ['source', 'at']) || provenance.source !== 'explicit-user-confirmation' || !iso(provenance.at)) return invalid();
    if ((data.facts as ConfirmedFact[]).some(f => f.confirmedAt !== provenance.at)) return invalid();
    return { version: 1, revision: data.revision as number, facts: inputs.map(f => ({ ...f, confirmation: 'confirmed', confirmedAt: provenance.at as string })), provenance: { source: 'explicit-user-confirmation', at: provenance.at } };
  }

  /** Call only from the explicit renderer action that approves these values for AI context. */
  save(facts: unknown, expectedRevision: number): ConfirmedContextArchive {
    const inputs = parseFacts(facts);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return invalid();
    const at = this.now().toISOString();
    const next: ConfirmedContextArchive = { version: 1, revision: expectedRevision + 1, facts: inputs.map(f => ({ ...f, confirmation: 'confirmed', confirmedAt: at })), provenance: { source: 'explicit-user-confirmation', at } };
    const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes, 'utf8') > MAX_BYTES) throw new Error('Context byte budget exceeded');
    const file = this.location(true)!;
    const lock = `${file}.lock`;
    let fd: number;
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch { throw new Error('Context archive busy; reload before retrying'); }
    let temp: string | undefined;
    try {
      if (this.load().revision !== expectedRevision) throw new Error('Context changed; reload before retrying');
      temp = path.join(this.userDataDirectory, `confirmed-context-${randomUUID()}.tmp`);
      fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
      // Recheck links before replacing; a corrupt archive was already rejected by load().
      this.location();
      try { if (fs.lstatSync(file).isSymbolicLink()) return invalid(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      fs.renameSync(temp, file);
      return next;
    } finally {
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }

  getConfirmedEssential = () => {
    const archive = this.load();
    return archive.facts.length ? { schemaVersion: 1 as const, id: 'essential', label: 'User-confirmed information', facts: archive.facts, revision: archive.revision, scope: 'user' as const } : null;
  };

  readRequestedSource = (id: string): unknown => {
    if (!identifier(id) || !this.requested) throw new Error('Context source unavailable');
    return this.requested(id);
  };
}
