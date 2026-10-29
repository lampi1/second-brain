// Impara's review cards on disk (ADR 0189): userData/learn/review.json holds every card (with its memory state) and the
// last reviews, next to the lessons; only on this PC, like them. Written atomically (tmp + rename) after each change; a
// broken file is moved aside, never overwritten. A lesson's checks become cards at zero tokens (`fromChecks`), the
// cards run adds its own (`add`), a tutor answer one (`addOne`, ADR 0190); a removed lesson takes its cards away, a
// lesson moved to another subject moves them. Used by learn/service.ts; tests: test/unit/review.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { schedule, type CardDraft, type ReviewCard, type ReviewGrade, type ReviewLog } from '@shared/review';
import type { Lesson } from '@shared/lesson';

const LOG_MAX = 3000;
interface File { v: 1; cards: ReviewCard[]; log: ReviewLog[] }

export class ReviewStore {
  private data: File | null = null;
  constructor(readonly file: string) {}

  private read(): File {
    if (this.data) return this.data;
    let text: string;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (e) {
      // no file yet: none to lose. Any other error (a file held by an antivirus on Windows) is thrown and not
      // remembered, so the next call reads again and nothing is written over the cards meanwhile
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return (this.data = { v: 1, cards: [], log: [] });
    }
    let raw: Partial<File> | null = null;
    try { raw = JSON.parse(text) as Partial<File>; } catch { /* below */ }
    if (!raw || typeof raw !== 'object') {
      // a broken file is kept aside (never overwritten) and the review starts again
      fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`);
      return (this.data = { v: 1, cards: [], log: [] });
    }
    return (this.data = { v: 1, cards: Array.isArray(raw.cards) ? raw.cards : [], log: Array.isArray(raw.log) ? raw.log : [] });
  }
  private write(): void {
    const d = this.read();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(d));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  cards(): ReviewCard[] { return this.read().cards; }
  log(): ReviewLog[] { return this.read().log; }
  get(id: string): ReviewCard | null { return this.read().cards.find(c => c.id === id) ?? null; }
  ofLesson(lessonId: string): ReviewCard[] { return this.read().cards.filter(c => c.lessonId === lessonId); }

  /** The lesson's checks as cards (once each; a check already a card keeps its memory). True when one was added. */
  fromChecks(l: Pick<Lesson, 'id' | 'subject' | 'checks' | 'createdAt'>, subject: string): boolean {
    const d = this.read();
    let added = false;
    for (const c of l.checks) {
      const id = `${l.id}:k:${c.id}`;
      if (d.cards.some(x => x.id === id)) continue;
      d.cards.push({ id, lessonId: l.id, subject, kind: 'choice', origin: 'check', q: c.q, options: c.options, correct: c.correct, answer: c.why, createdAt: l.createdAt, mem: null });
      added = true;
    }
    if (added) this.write();
    return added;
  }

  /** The cards run's cards for a lesson (replacing an earlier run's, whose memory is lost only for cards it no longer has). */
  add(lessonId: string, subject: string, drafts: readonly CardDraft[], now: number): ReviewCard[] {
    const d = this.read();
    const old = new Map(d.cards.filter(c => c.lessonId === lessonId && c.origin === 'cards').map(c => [c.q, c]));
    d.cards = d.cards.filter(c => !(c.lessonId === lessonId && c.origin === 'cards'));
    const made = drafts.map((x, i): ReviewCard => ({ ...x, id: `${lessonId}:c${i + 1}`, lessonId, subject, origin: 'cards', createdAt: now, mem: old.get(x.q)?.mem ?? null }));
    d.cards.push(...made);
    this.write();
    return made;
  }

  /** One card of its own (a tutor answer, ADR 0190): id `<lesson>:<key>`, written again in place if it exists. */
  addOne(lessonId: string, subject: string, draft: CardDraft, key: string, origin: ReviewCard['origin'], now: number): ReviewCard {
    const d = this.read();
    const id = `${lessonId}:${key}`;
    const card: ReviewCard = { ...draft, id, lessonId, subject, origin, createdAt: now, mem: d.cards.find(c => c.id === id)?.mem ?? null };
    d.cards = [...d.cards.filter(c => c.id !== id), card];
    this.write();
    return card;
  }

  grade(id: string, g: ReviewGrade, now: number): ReviewCard {
    const d = this.read();
    const i = d.cards.findIndex(c => c.id === id);
    if (i < 0) throw new Error('Carta non trovata.');
    const card = { ...d.cards[i]!, mem: schedule(d.cards[i]!.mem, g, now) };
    d.cards[i] = card;
    d.log.push({ card: id, at: now, grade: g });
    if (d.log.length > LOG_MAX) d.log = d.log.slice(-LOG_MAX);
    this.write();
    return card;
  }

  removeLesson(lessonId: string): void {
    const d = this.read();
    const before = d.cards.length;
    d.cards = d.cards.filter(c => c.lessonId !== lessonId);
    if (d.cards.length !== before) this.write();
  }

  setSubject(lessonId: string, subject: string): void {
    const d = this.read();
    let changed = false;
    d.cards = d.cards.map(c => (c.lessonId === lessonId && c.subject !== subject ? ((changed = true), { ...c, subject }) : c));
    if (changed) this.write();
  }
}
