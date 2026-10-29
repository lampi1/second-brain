// Impara's review cards on disk (ADR 0189): userData/learn/review.json holds every card (with its memory state) and the
// last reviews, next to the lessons; only on this PC, like them. Written atomically (tmp + rename) after each change. A
// lesson's checks become cards at zero tokens (`fromChecks`), the cards run adds its own (`add`), a removed lesson
// takes its cards away, a lesson moved to another subject moves them. Used by learn/service.ts; tests:
// test/unit/review.test.ts.
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
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<File>;
      this.data = { v: 1, cards: Array.isArray(raw.cards) ? raw.cards : [], log: Array.isArray(raw.log) ? raw.log : [] };
    } catch { this.data = { v: 1, cards: [], log: [] }; }
    return this.data;
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
