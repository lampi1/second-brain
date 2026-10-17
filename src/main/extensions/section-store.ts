// Atomic, optimistic revision registry for data sections; main owns the trusted private directory. No code loading.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSection } from '../../shared/extension-section';
import type { SectionManifest } from '../../shared/extension-section';

interface Snapshot { revision: number; sections: SectionManifest[] }
interface Registry { schemaVersion: 1; current: Snapshot; history: Snapshot[] }
const empty = (): Registry => ({ schemaVersion: 1, current: { revision: 0, sections: [] }, history: [] });

/** One main-process owner per root. A lock also rejects overlapping processes instead of losing updates. */
export class SectionStore {
  constructor(private readonly root: string) {}

  private location(): string {
    fs.mkdirSync(this.root, { recursive: true });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('Registry directory must not be a link');
    return path.join(this.root, 'sections.json');
  }

  private read(): Registry {
    const file = this.location();
    if (!fs.existsSync(file)) return empty();
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('Invalid registry file');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Registry;
    const snapshot = (s: Snapshot): Snapshot => {
      if (!s || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.sections) || s.sections.length > 20) throw new Error('Invalid registry snapshot');
      const sections = s.sections.map(parseSection);
      if (new Set(sections.map(x => x.id)).size !== sections.length) throw new Error('Duplicate registered section');
      return { revision: s.revision, sections };
    };
    if (data.schemaVersion !== 1 || !Array.isArray(data.history) || data.history.length > 10) throw new Error('Invalid registry version/history');
    const current = snapshot(data.current), history = data.history.map(snapshot);
    if (history.some((s, i) => s.revision >= current.revision || (i > 0 && s.revision <= history[i - 1]!.revision))) throw new Error('Invalid registry revision order');
    return { schemaVersion: 1, current, history };
  }

  list(): Snapshot { return this.read().current; }

  private change(expected: number, update: (r: Registry) => SectionManifest[]): Snapshot {
    const file = this.location(), lock = `${file}.lock`;
    // A stale lock is deliberately visible; do not guess whether another writer is alive.
    const fd = fs.openSync(lock, 'wx');
    let temp: string | undefined;
    try {
      const registry = this.read();
      if (registry.current.revision !== expected) throw new Error('Registry changed; reload before retrying');
      const sections = update(registry).map(parseSection);
      if (sections.length > 20 || expected >= Number.MAX_SAFE_INTEGER) throw new Error('Registry limit exceeded');
      const current = { revision: expected + 1, sections };
      const next: Registry = { schemaVersion: 1, current, history: [...registry.history, registry.current].slice(-10) };
      const bytes = JSON.stringify(next);
      if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw new Error('Registry byte budget exceeded');
      temp = path.join(this.root, `sections-${randomUUID()}.tmp`);
      fs.writeFileSync(temp, bytes, { flag: 'wx' });
      fs.renameSync(temp, file);
      return current;
    } finally {
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }

  register(manifest: unknown, expected: number): Snapshot {
    const section = parseSection(manifest);
    return this.change(expected, r => [...r.current.sections.filter(s => s.id !== section.id), section].sort((a, b) => a.id.localeCompare(b.id, 'en')));
  }
  remove(id: string, expected: number): Snapshot {
    return this.change(expected, r => {
      if (!r.current.sections.some(s => s.id === id)) throw new Error('Section not registered');
      return r.current.sections.filter(s => s.id !== id);
    });
  }
  rollback(revision: number, expected: number): Snapshot {
    return this.change(expected, r => {
      const previous = r.history.find(s => s.revision === revision);
      if (!previous) throw new Error('Rollback revision unavailable');
      return previous.sections;
    });
  }
}
