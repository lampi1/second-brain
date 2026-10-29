// Impara's review (ADR 0189): FSRS scheduling, the cards a run writes (only from verified facts), the session queues
// (due first, subjects interleaved), the honest summary, the store on disk, and the service around them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FSRS_W, interleave, intervalDays, parseCards, queueOf, recallNow, retrievability, schedule, streakOf, summarize, type ReviewCard } from '../../src/shared/review';
import { ReviewStore } from '../../src/main/learn/review-store';
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, type TeachRun } from '../../src/main/learn/service';
import { demoRun, demoTeach, seedDemoLessons } from '../../src/main/learn/demo';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 29, 10).getTime();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-'));
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const card = (id: string, lessonId: string, extra: Partial<ReviewCard> = {}): ReviewCard => ({ id, lessonId, subject: 'Reti', kind: 'recall', origin: 'cards', q: id, answer: 'a', createdAt: T0, mem: null, ...extra });

describe('FSRS', () => {
  it('follows the published model: 90% recall after one stability, the first stability from the grade', () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 6);
    expect(intervalDays(5)).toBeCloseTo(5, 6);
    for (const g of [1, 2, 3, 4] as const) expect(schedule(null, g, T0).s).toBeCloseTo(FSRS_W[g - 1]!, 6);
    const good = schedule(null, 3, T0);
    expect(good.due).toBe(T0 + 3 * DAY); // round(3.173)
    expect(good.reps).toBe(1);
    expect(good.d).toBeGreaterThan(1);
    expect(good.d).toBeLessThan(10);
  });

  it('a remembered card waits longer each time, a forgotten one comes back by tomorrow, easier after easy', () => {
    const a = schedule(null, 3, T0);
    const b = schedule(a, 3, a.due);
    const c = schedule(b, 3, b.due);
    expect(b.s).toBeGreaterThan(a.s);
    expect(c.due - c.last!).toBeGreaterThan(b.due - b.last!);
    const easy = schedule(a, 4, a.due), hard = schedule(a, 2, a.due);
    expect(easy.s).toBeGreaterThan(b.s);
    expect(hard.s).toBeLessThan(b.s);
    expect(easy.d).toBeLessThan(hard.d);
    const lost = schedule(b, 1, b.due);
    expect(lost.s).toBeLessThanOrEqual(b.s);
    expect(lost.lapses).toBe(1);
    expect(lost.due - lost.last!).toBeLessThanOrEqual(DAY);
    expect(recallNow(null, T0)).toBeNull();
    expect(recallNow(a, T0 + 3 * DAY)!).toBeCloseTo(retrievability(3, a.s), 9);
  });
});

describe('cards and queues', () => {
  it('keeps only cards that cite a verified fact and are well formed', () => {
    const v = { cards: [
      { kind: 'recall', q: 'Perché?', answer: 'Perché sì.', cites: ['f1'] },
      { kind: 'recall', q: 'Senza fonte', answer: 'x', cites: [] },
      { kind: 'recall', q: 'Solo un fatto non verificato', answer: 'x', cites: ['f9'] },
      { kind: 'choice', q: 'Quale?', options: ['a', 'b', 'c'], correct: 1, answer: 'b perché…', cites: ['f2', 'f9'] },
      { kind: 'choice', q: 'Indice fuori', options: ['a', 'b'], correct: 2, answer: 'x', cites: ['f1'] },
      { kind: 'choice', q: 'Doppie', options: ['a', 'a'], correct: 0, answer: 'x', cites: ['f1'] },
      { kind: 'node', q: 'Dove?', node: 'store', answer: 'Lì.', cites: ['f1'] },
      { kind: 'node', q: 'Nodo che non c’è', node: 'nowhere', answer: 'x', cites: ['f1'] },
      { kind: 'essay', q: 'Tipo sconosciuto', answer: 'x', cites: ['f1'] },
    ] };
    const out = parseCards(v, ['engine', 'store'], ['f1', 'f2']);
    expect(out.map(c => c.q)).toEqual(['Perché?', 'Quale?', 'Dove?']);
    expect(out[1]).toMatchObject({ kind: 'choice', correct: 1, cites: ['f2'] });
    expect(parseCards('nonsense', [], ['f1'])).toEqual([]);
  });

  it('mixes the lessons of a subject; «Ripassa» brings the due ones first, the most forgotten first, then a few new', () => {
    const due = (days: number, s: number) => ({ due: T0 - DAY, s, d: 5, reps: 1, lapses: 0, last: T0 - days * DAY });
    const cards = [
      card('a1', 'A'), card('a2', 'A'), card('a3', 'A'), card('b1', 'B'), card('b2', 'B'),
      card('d1', 'A', { mem: due(2, 3) }), card('d2', 'B', { mem: due(10, 2) }),
      card('later', 'B', { mem: { due: T0 + 9 * DAY, s: 20, d: 5, reps: 3, lapses: 0, last: T0 - DAY } }),
      card('other', 'C', { subject: 'Git' }),
    ];
    expect(interleave(cards.slice(0, 5)).map(c => c.id)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
    const daily = queueOf(cards, 'due', T0, { fresh: 2 });
    expect(daily.map(c => c.id)).toEqual(['d2', 'd1', 'b1', 'a1']);
    const quiz = queueOf(cards, 'quiz', T0, { subject: 'Reti', max: 20 });
    expect(quiz.some(c => c.id === 'other')).toBe(false);
    expect(quiz.some(c => c.id === 'later')).toBe(true);
    for (let i = 1; i < quiz.length - 1; i++) if (quiz[i]!.lessonId === quiz[i - 1]!.lessonId) expect(quiz.slice(i).every(c => c.lessonId === quiz[i]!.lessonId)).toBe(true);
  });

  it('sums up honestly: recall only over studied cards, null before any; a streak of days in a row', () => {
    const cards = [card('n1', 'A'), card('s1', 'A', { mem: { due: T0 + DAY, s: 4, d: 5, reps: 1, lapses: 0, last: T0 - 4 * DAY } })];
    const sum = summarize(cards, [], new Map([['Reti', 1], ['Git', 2]]), T0);
    const reti = sum.subjects.find(s => s.name === 'Reti')!;
    expect(reti).toMatchObject({ lessons: 1, cards: 2, due: 0, fresh: 1 });
    expect(reti.recall).toBeCloseTo(0.9, 6);
    expect(sum.subjects.find(s => s.name === 'Git')!.recall).toBeNull();
    const log = [T0, T0 - DAY, T0 - 2 * DAY, T0 - 4 * DAY].map(at => ({ card: 'x', at, grade: 3 as const }));
    expect(streakOf(log, T0)).toEqual({ streak: 3, today: 1 });
    expect(streakOf(log.slice(1), T0).streak).toBe(2); // nothing yet today: yesterday's run still counts
  });
});

describe('ReviewStore', () => {
  it('turns checks into cards once, keeps memory, moves and removes a lesson’s cards', () => {
    const file = path.join(tmp(), 'review.json');
    const s = new ReviewStore(file);
    const lesson = { id: 'L', checks: [{ id: 'q1', after: 'p1', kind: 'choice' as const, q: 'Q?', options: ['a', 'b'], correct: 1, why: 'perché b' }], createdAt: T0 };
    expect(s.fromChecks(lesson, 'Reti')).toBe(true);
    expect(s.fromChecks(lesson, 'Reti')).toBe(false);
    const graded = s.grade('L:k:q1', 3, T0);
    expect(graded.mem?.reps).toBe(1);
    s.add('L', 'Reti', [{ kind: 'recall', q: 'R?', answer: 'r', cites: ['f1'] }], T0);
    s.grade('L:c1', 4, T0);
    // a new run keeps the memory of a card it writes again
    s.add('L', 'Reti', [{ kind: 'recall', q: 'R?', answer: 'r2', cites: ['f1'] }, { kind: 'recall', q: 'Nuova', answer: 'n', cites: ['f1'] }], T0 + DAY);
    const again = new ReviewStore(file);
    expect(again.get('L:c1')?.mem?.reps).toBe(1);
    expect(again.get('L:c2')?.mem).toBeNull();
    expect(again.log()).toHaveLength(2);
    again.setSubject('L', 'Git');
    expect(again.ofLesson('L').every(c => c.subject === 'Git')).toBe(true);
    again.removeLesson('L');
    expect(new ReviewStore(file).cards()).toEqual([]);
    expect(() => again.grade('nope', 3, T0)).toThrow();
  });
});

describe('LearnService review', () => {
  const fast = (r: TeachRun) => { vi.useFakeTimers({ toFake: ['setTimeout'] }); const p = demoTeach(r); vi.runAllTimers(); vi.useRealTimers(); return p; };
  function make(root = tmp()) {
    const store = new LessonStore(root);
    const runs: TeachRun[] = [];
    const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => null,
      teach: r => { runs.push(r); return fast(r); }, changed: () => {}, teachers: () => [], webOk: () => false });
    return { store, svc, runs };
  }

  it('a finished lesson gets a subject and verified cards; sessions, grades and subjects work; removing it takes them away', async () => {
    const { store, svc, runs } = make();
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    await until(() => store.get(l.id)?.cards?.state === 'done');
    const done = store.get(l.id)!;
    expect(done.subject).toBe('Second brain');
    expect(runs.find(r => r.round === 'impara-plan')!.prompt).toContain('"subject"');
    const cardsRun = runs.find(r => r.round === 'impara-cards')!;
    expect(cardsRun.prompt).toContain('f1 [verified');
    expect(cardsRun.prompt).not.toContain('NOT CONFIRMED'); // the unconfirmed fact is not offered
    // 4 cards from the run (the one citing only the unconfirmed fact is dropped) + the lesson's 3 checks
    expect(done.cards).toEqual({ state: 'done', n: 4 });
    const own = svc.review.ofLesson(l.id);
    expect(own.filter(c => c.origin === 'cards')).toHaveLength(4);
    expect(own.filter(c => c.origin === 'check')).toHaveLength(3);
    const st = svc.state().review!;
    expect(st.subjects).toEqual([expect.objectContaining({ name: 'Second brain', lessons: 1, cards: 7, due: 0, fresh: 7, recall: null })]);
    const items = svc.queue('quiz', 'Second brain');
    expect(items).toHaveLength(7);
    const node = items.find(i => i.card.kind === 'node')!;
    expect(node.diagram).toContain('flowchart');
    expect(node.facts[0]).toMatchObject({ id: 'f3', from: 'file' });
    const g = svc.gradeCard(node.card.id, 3);
    expect(g.mem?.reps).toBe(1);
    expect(svc.state().review!.subjects[0]!.recall).toBeCloseTo(1, 3);
    expect(() => svc.gradeCard(node.card.id, 7)).toThrow();
    svc.setSubject(l.id, 'Frontend');
    expect(store.get(l.id)!.subject).toBe('Frontend');
    expect(svc.review.ofLesson(l.id).every(c => c.subject === 'Frontend')).toBe(true);
    expect(() => svc.setSubject(l.id, '  ')).toThrow();
    svc.remove(l.id);
    expect(svc.review.cards()).toEqual([]);
  });

  it('the demo opens with subjects, a due card and a streak', () => {
    const root = tmp();
    seedDemoLessons(new LessonStore(root), T0);
    const { svc } = make(root);
    const r = svc.state().review!;
    expect(r.subjects.map(s => s.name).sort()).toEqual(['Second brain', 'Sicurezza web']);
    expect(r.due).toBeGreaterThan(0);
    expect(svc.queue('due').length).toBeGreaterThan(0);
  });
});
