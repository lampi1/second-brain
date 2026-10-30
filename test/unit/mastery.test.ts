// Impara's overall score and subject levels (ADR 0204, shared/mastery.ts): honest by construction: it falls without
// reviews, new unlearned cards lower it, the weekly delta replays the log, and the levels follow LEVEL_RULES.
import { describe, expect, it } from 'vitest';
import { isSolid, lastGrades, levelOf, masteryOf, memoriesAt, scoreOf, SOLID_DAYS } from '../../src/shared/mastery';
import { schedule, type CardMemory, type ReviewCard, type ReviewLog } from '../../src/shared/review';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 1, 10).getTime();
const mem = (s: number, lastAt: number): CardMemory => ({ due: lastAt + s * DAY, s, d: 5, reps: 3, lapses: 0, last: lastAt });
const card = (id: string, m: CardMemory | null, extra: Partial<ReviewCard> = {}): ReviewCard => ({ id, lessonId: 'l', subject: 'Reti', kind: 'recall', origin: 'cards', q: id, answer: 'a', createdAt: T0, mem: m, ...extra });

describe('solid cards', () => {
  it('needs the stability and a last grade of at least good', () => {
    expect(isSolid(mem(SOLID_DAYS, T0), 3)).toBe(true);
    expect(isSolid(mem(SOLID_DAYS - 1, T0), 4)).toBe(false);
    expect(isSolid(mem(40, T0), 2)).toBe(false);
    expect(isSolid(mem(40, T0), undefined)).toBe(true);
    expect(isSolid(null, 4)).toBe(false);
  });

  it('reads the last grade of each card', () => {
    const g = lastGrades([{ card: 'a', at: 2, grade: 1 }, { card: 'a', at: 1, grade: 4 }, { card: 'b', at: 1, grade: 3 }]);
    expect(g.get('a')).toBe(1);
    expect(g.get('b')).toBe(3);
  });
});

describe('the score', () => {
  const now = T0 + 30 * DAY;
  it('is null with no card, 0 when nothing is studied', () => {
    expect(scoreOf([], [], now, { streak: 0, lessonsDone: 0 }).score).toBeNull();
    expect(scoreOf([card('a', null)], [], now, { streak: 0, lessonsDone: 1 })).toMatchObject({ score: 0, memory: null, cards: 1, studied: 0 });
  });

  it('is memory today × solid share', () => {
    const cards = [card('a', mem(60, now)), card('b', mem(60, now)), card('c', mem(2, now)), card('d', null)];
    const s = scoreOf(cards, [], now, { streak: 3, lessonsDone: 2 });
    // reviewed just now: memory 100%; 2 solid of 4
    expect(s).toMatchObject({ memory: 1, solid: 2, cards: 4, studied: 3, score: 50, streak: 3, lessonsDone: 2 });
  });

  it('falls day by day without reviews', () => {
    const cards = [card('a', mem(60, now)), card('b', mem(30, now))];
    const today = scoreOf(cards, [], now, { streak: 0, lessonsDone: 0 }).score!;
    const later = scoreOf(cards, [], now + 40 * DAY, { streak: 0, lessonsDone: 0 }).score!;
    expect(today).toBe(100);
    expect(later).toBeLessThan(today);
  });

  it('replays the log for last week: the delta is what changed since', () => {
    // one card, reviewed «good» several times: solid only after the last reviews
    const log: ReviewLog[] = [];
    let m: CardMemory | null = null;
    for (const at of [T0, T0 + 3 * DAY, T0 + 12 * DAY, T0 + 28 * DAY]) { m = schedule(m, 3, at); log.push({ card: 'a', at, grade: 3 }); }
    const c = card('a', m);
    expect(memoriesAt([c], log, T0 + 13 * DAY)[0]!.mem!.s).toBeLessThan(m!.s);
    const s = scoreOf([c], log, now, { streak: 0, lessonsDone: 0 });
    expect(s.delta).not.toBeNull();
    expect(s.delta).toBe(s.score! - scoreOf([{ ...c, mem: memoriesAt([c], log, now - 7 * DAY)[0]!.mem }], log, now - 7 * DAY, { streak: 0, lessonsDone: 0 }).score!);
    // no card a week ago: no delta
    expect(scoreOf([card('n', null, { createdAt: now - DAY })], [], now, { streak: 0, lessonsDone: 0 }).delta).toBeNull();
  });
});

describe('subject levels', () => {
  const now = T0;
  it('follows the rules from the highest down', () => {
    expect(levelOf({ cards: 0, studied: 0, solid: 0, memory: null })).toBe('started');
    expect(levelOf({ cards: 10, studied: 4, solid: 0, memory: 0.95 })).toBe('started');
    expect(levelOf({ cards: 10, studied: 5, solid: 0, memory: 0.75 })).toBe('familiar');
    expect(levelOf({ cards: 10, studied: 8, solid: 4, memory: 0.85 })).toBe('proficient');
    expect(levelOf({ cards: 10, studied: 10, solid: 8, memory: 0.92 })).toBe('mastered');
    // forgetting brings it down
    expect(levelOf({ cards: 10, studied: 10, solid: 8, memory: 0.6 })).toBe('started');
  });

  it('counts a subject’s cards', () => {
    const m = masteryOf([card('a', mem(40, now)), card('b', mem(40, now)), card('c', null)], [], now);
    expect(m).toMatchObject({ cards: 3, studied: 2, solid: 2, memory: 1, level: 'familiar' });
  });
});
