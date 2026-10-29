// The Impara lessons on disk (ADR 0183): userData/learn/<id>/ holds lesson.json (the whole lesson: diagram, pieces,
// checks, the user's answers, where they are) and the material it was made from (materiale.md, diff.patch), so a lesson
// opens again exactly where the user left it. Only on this PC, never in the brain (like the recordings, ADR 0154).
// Written atomically (tmp + rename). Used by learn/service.ts; tests: test/unit/learn-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { summaryOf, type Lesson, type LessonSummary } from '@shared/lesson';

const ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const FILE = /^[\w.-]{1,40}$/;

export class LessonStore {
  /** summaries already read or saved, by the lesson.json's mtime: a move rereads no other lesson */
  private readonly seen = new Map<string, { mtime: number; summary: LessonSummary }>();
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!ID.test(id)) throw new Error(`lezione sconosciuta: ${id}`);
    return path.join(this.root, id);
  }

  newId(now = Date.now()): string {
    const d = new Date(now), p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(2).toString('hex')}`;
  }

  list(): LessonSummary[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.root).filter(n => ID.test(n)); } catch { return []; }
    const out: LessonSummary[] = [];
    for (const n of names) {
      let mtime: number;
      try { mtime = fs.statSync(path.join(this.root, n, 'lesson.json')).mtimeMs; } catch { this.seen.delete(n); continue; }
      const hit = this.seen.get(n);
      if (hit && hit.mtime === mtime) { out.push(hit.summary); continue; }
      const l = this.get(n);
      if (!l) continue;
      const summary = summaryOf(l);
      this.seen.set(n, { mtime, summary });
      out.push(summary);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Lesson | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'lesson.json'), 'utf8')) as Lesson; } catch { return null; }
  }

  save(l: Lesson): Lesson {
    const dir = this.dir(l.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'lesson.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(l, null, 1));
    fs.renameSync(`${file}.tmp`, file);
    try { this.seen.set(l.id, { mtime: fs.statSync(file).mtimeMs, summary: summaryOf(l) }); } catch { this.seen.delete(l.id); }
    return l;
  }

  /** A file of the lesson's material (materiale.md, diff.patch); returns its absolute path. */
  writeFile(id: string, name: string, content: string): string {
    if (!FILE.test(name)) throw new Error(`nome di file non valido: ${name}`);
    const dir = this.dir(id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  }

  readFile(id: string, name: string): string | null {
    if (!FILE.test(name)) return null;
    try { return fs.readFileSync(path.join(this.dir(id), name), 'utf8'); } catch { return null; }
  }

  /** The lesson leaves the list at once (lesson.json first); its folder goes now, or with `sweep` when `later`
   *  (a run still has it as its folder) or when the delete fails (a file held open on Windows). */
  remove(id: string, later = false): void {
    const dir = this.dir(id);
    fs.rmSync(path.join(dir, 'lesson.json'), { force: true });
    if (!later) this.sweep(id);
  }

  /** Clears the folders with no lesson.json left (one, or all at start); a delete that fails is tried again next time. */
  sweep(id?: string): void {
    let names: string[] = [];
    try { names = id ? [id] : fs.readdirSync(this.root).filter(n => ID.test(n)); } catch { return; }
    for (const n of names) {
      const dir = this.dir(n);
      if (!fs.existsSync(dir) || fs.existsSync(path.join(dir, 'lesson.json'))) continue;
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* still held: the next sweep */ }
    }
  }
}
