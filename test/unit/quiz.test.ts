// Impara's question kinds (ADR 0204, shared/quiz.ts): what the model writes is checked per kind, a response is right or
// not, the stored choice keeps old lessons' rule (choice === correct), and the shuffle is stable and never solved.
import { describe, expect, it } from 'vitest';
import { parseQuiz, quizRight, quizValid, shuffled, storedChoice, type QuizBody } from '../../src/shared/quiz';
import { parseCheck } from '../../src/shared/lesson';

describe('parseQuiz', () => {
  it('reads every kind with its own fields', () => {
    expect(parseQuiz({ kind: 'predict', q: 'Q', options: ['a', 'b', 'c'], correct: 2 })).toEqual({ kind: 'predict', q: 'Q', options: ['a', 'b', 'c'], correct: 2 });
    expect(parseQuiz({ kind: 'truefalse', q: 'La CSP blocca le immagini esterne.', correct: true })).toMatchObject({ kind: 'truefalse', options: ['Vero', 'Falso'], correct: 0 });
    expect(parseQuiz({ kind: 'truefalse', q: 'X', options: ['True', 'False'], correct: 1 })).toMatchObject({ options: ['True', 'False'], correct: 1 });
    expect(parseQuiz({ kind: 'cloze', q: 'Completa', code: 'const ITEM_FRAME_MS = ___;\nsetTimeout(f, ITEM_FRAME_MS);', options: ['16', '100'], correct: 0 })).toMatchObject({ kind: 'cloze', code: 'const ITEM_FRAME_MS = ___;\nsetTimeout(f, ITEM_FRAME_MS);' });
    expect(parseQuiz({ kind: 'order', q: 'In ordine', items: ['motore', 'main', 'store', 'finestra'] })).toEqual({ kind: 'order', q: 'In ordine', options: [], correct: 0, items: ['motore', 'main', 'store', 'finestra'] });
    expect(parseQuiz({ kind: 'match', q: 'Abbina', items: ['a', 'b', 'c'], pairs: ['A', 'B', 'C'] })).toMatchObject({ kind: 'match', items: ['a', 'b', 'c'], pairs: ['A', 'B', 'C'] });
    // an unknown kind is asked as a choice
    expect(parseQuiz({ kind: 'essay', q: 'Q', options: ['a', 'b'], correct: 0 }).kind).toBe('choice');
  });

  it('drops a question it cannot ask as written', () => {
    expect(() => parseQuiz({ kind: 'choice', q: 'Q', options: ['a', ''], correct: 0 })).toThrow();
    expect(() => parseQuiz({ kind: 'choice', q: 'Q', options: ['a', 'a'], correct: 0 })).toThrow();
    expect(() => parseQuiz({ kind: 'choice', q: 'Q', options: ['a', 'b'], correct: 2 })).toThrow();
    expect(() => parseQuiz({ kind: 'truefalse', q: 'Q', correct: 'forse' })).toThrow();
    expect(() => parseQuiz({ kind: 'cloze', q: 'Q', code: 'no blank here', options: ['a', 'b'], correct: 0 })).toThrow(/___/);
    expect(() => parseQuiz({ kind: 'cloze', q: 'Q', code: '___ and ___', options: ['a', 'b'], correct: 0 })).toThrow();
    expect(() => parseQuiz({ kind: 'order', q: 'Q', items: ['a', 'b'] })).toThrow();
    expect(() => parseQuiz({ kind: 'order', q: 'Q', items: ['a', 'b', 'a'] })).toThrow();
    expect(() => parseQuiz({ kind: 'match', q: 'Q', items: ['a', 'b', 'c'], pairs: ['A', 'B'] })).toThrow();
    expect(() => parseQuiz({ kind: 'choice', options: ['a', 'b'], correct: 0 })).toThrow();
  });

  it('a lesson check keeps its piece, id and why; a saved check without the new fields still reads', () => {
    const c = parseCheck({ kind: 'order', q: 'Q', items: ['1', '2', '3'], why: 'perché' }, 'p1', 'q1');
    expect(c).toMatchObject({ id: 'q1', after: 'p1', kind: 'order', items: ['1', '2', '3'], why: 'perché' });
    expect(parseCheck({ kind: 'predict', q: 'Q', options: ['a', 'b'], correct: 1, why: 'w' }, 'p', 'q')).toMatchObject({ kind: 'predict', correct: 1 });
  });
});

describe('answers', () => {
  const order: QuizBody = { kind: 'order', q: 'Q', options: [], correct: 0, items: ['a', 'b', 'c'] };
  const match: QuizBody = { kind: 'match', q: 'Q', options: [], correct: 0, items: ['a', 'b', 'c'], pairs: ['A', 'B', 'C'] };
  const pick: QuizBody = { kind: 'choice', q: 'Q', options: ['x', 'y'], correct: 1 };

  it('says right or wrong per kind', () => {
    expect(quizRight(pick, 1)).toBe(true);
    expect(quizRight(pick, 0)).toBe(false);
    expect(quizRight(pick, [1])).toBe(false);
    expect(quizRight(order, [0, 1, 2])).toBe(true);
    expect(quizRight(order, [1, 0, 2])).toBe(false);
    expect(quizRight(match, [0, 1, 2])).toBe(true);
    expect(quizRight(match, [0, 2, 1])).toBe(false);
  });

  it('takes only responses the question can have', () => {
    expect(quizValid(pick, 1)).toBe(true);
    expect(quizValid(pick, 2)).toBe(false);
    expect(quizValid(pick, 0.5)).toBe(false);
    expect(quizValid(order, [2, 1, 0])).toBe(true);
    expect(quizValid(order, [0, 0, 1])).toBe(false);
    expect(quizValid(order, [0, 1])).toBe(false);
    expect(quizValid(match, 1)).toBe(false);
  });

  it('stores choice === correct exactly when right, for every kind', () => {
    expect(storedChoice(pick, 0)).toBe(0);
    expect(storedChoice(order, [0, 1, 2])).toBe(order.correct);
    expect(storedChoice(order, [2, 1, 0])).toBe(-1);
  });

  it('shuffles the same way every time, never in the solved order', () => {
    expect(shuffled(5, 'q1')).toEqual(shuffled(5, 'q1'));
    for (const seed of ['a', 'b', 'c', 'q1', 'q2', 'xyz', '123']) {
      const s = shuffled(4, seed);
      expect([...s].sort()).toEqual([0, 1, 2, 3]);
      expect(s).not.toEqual([0, 1, 2, 3]);
    }
    expect(shuffled(1, 'x')).toEqual([0]);
  });
});
