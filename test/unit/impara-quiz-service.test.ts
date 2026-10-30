// Impara v3 in main (ADR 0204): the cards run's new question kinds, a check's kind kept as a card, an order check
// answered with a list (stored so that choice === correct means right), the user's files as a lesson's material, and
// the overall score and subject levels in the state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseCards } from '../../src/shared/review';
import { ReviewStore } from '../../src/main/learn/review-store';
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, type TeachRun } from '../../src/main/learn/service';
import { demoRun, demoTeach, seedDemoLessons } from '../../src/main/learn/demo';
import { checkKey } from '../../src/shared/lesson';

const T0 = new Date(2026, 9, 29, 10).getTime();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-quiz-'));
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const fast = (r: TeachRun) => { vi.useFakeTimers({ toFake: ['setTimeout'] }); const p = demoTeach(r); vi.runAllTimers(); vi.useRealTimers(); return p; };
function make(root = tmp()) {
  const store = new LessonStore(root);
  const runs: TeachRun[] = [];
  const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => null,
    teach: r => { runs.push(r); return fast(r); }, changed: () => {}, teachers: () => [], webOk: () => false, now: () => T0 });
  return { store, svc, runs };
}

describe('cards of the new kinds', () => {
  it('parses them, a predict as a choice, and drops a broken one', () => {
    const out = parseCards({ cards: [
      { kind: 'order', q: 'Ordine', items: ['a', 'b', 'c'], answer: 'perché', cites: ['f1'] },
      { kind: 'match', q: 'Abbina', items: ['a', 'b', 'c'], pairs: ['A', 'B', 'C'], answer: 'w', cites: ['f1'] },
      { kind: 'truefalse', q: 'Vero?', correct: false, answer: 'w', cites: ['f1'] },
      { kind: 'cloze', q: 'Completa', code: 'x = ___', options: ['1', '2'], correct: 1, answer: 'w', cites: ['f1'] },
      { kind: 'predict', q: 'Cosa succede?', options: ['a', 'b'], correct: 0, answer: 'w', cites: ['f1'] },
      { kind: 'order', q: 'Rotta', items: ['a'], answer: 'w', cites: ['f1'] },
    ] }, [], ['f1']);
    expect(out.map(c => c.kind)).toEqual(['order', 'match', 'truefalse', 'cloze', 'choice']);
    expect(out[2]).toMatchObject({ options: ['Vero', 'Falso'], correct: 1 });
  });

  it('a check becomes a card of its own kind', () => {
    const s = new ReviewStore(path.join(tmp(), 'review.json'));
    s.fromChecks({ id: 'L', createdAt: T0, checks: [
      { id: 'q1', after: 'p', kind: 'order', q: 'Q', options: [], correct: 0, items: ['a', 'b', 'c'], why: 'w' },
      { id: 'q2', after: 'p', kind: 'predict', q: 'Q', options: ['a', 'b'], correct: 1, why: 'w' },
    ] }, 'Reti');
    expect(s.get('L:k:q1')).toMatchObject({ kind: 'order', items: ['a', 'b', 'c'] });
    expect(s.get('L:k:q2')?.kind).toBe('choice');
  });
});

describe('LearnService', () => {
  it('judges a true/false check by its option and keeps «Eri sicuro?» afterwards', async () => {
    const { store, svc } = make();
    const l = svc.start({ kind: 'pr', ask: '', prUrl: 'https://github.com/lampi1/second-brain/pull/251', depth: 'lesson', level: 'basics' });
    await until(() => store.get(l.id)?.state === 'ready');
    const tf = store.get(l.id)!.checks.find(c => c.kind === 'truefalse')!;
    svc.move(l.id, checkKey(tf.id));
    let x = svc.answer(l.id, tf.id, 1);
    expect(x.checks.find(c => c.id === tf.id)!.answer).toMatchObject({ choice: 1 });
    x = svc.answer(l.id, tf.id, -1, 2);
    expect(x.checks.find(c => c.id === tf.id)!.answer).toMatchObject({ choice: 1, confidence: 2 });
  });

  it('an order check takes a list: choice is correct only when right, the list is kept', () => {
    const { store, svc } = make();
    seedDemoLessons(store, T0);
    const s = store.list()[0]!;
    const l = store.get(s.id)!;
    store.save({ ...l, checks: [...l.checks, { id: 'qo', after: l.steps[0]!.id, kind: 'order', q: 'Q', options: [], correct: 0, items: ['a', 'b', 'c'], why: 'w' }] });
    expect(() => svc.answer(l.id, 'qo', 1)).toThrow();
    expect(() => svc.answer(l.id, 'qo', [0, 0, 1])).toThrow();
    const x = svc.answer(l.id, 'qo', [1, 0, 2]);
    expect(x.checks.find(c => c.id === 'qo')!.answer).toMatchObject({ choice: -1, seq: [1, 0, 2] });
  });

  it('the user’s files become the material: one file read whole, listed in the sources', async () => {
    const { store, svc, runs } = make();
    const l = svc.start({ kind: 'topic', ask: 'Come funziona il login?', depth: 'quick', level: 'basics', files: [{ name: 'auth/login.ts', text: 'export function login() {}' }, { name: 'logo.bin', text: '\u0000' }] });
    await until(() => (store.get(l.id)?.prep?.phases.gather ?? '') === 'done' && runs.some(r => r.round === 'impara-files'));
    expect(store.readFile(l.id, 'fonti.md')).toContain('export function login() {}');
    expect(store.get(l.id)!.sources).toEqual(['file: auth/login.ts']);
    expect(runs.find(r => r.round === 'impara-files')!.prompt as string).toContain('auth/login.ts');
  });

  it('the state carries the overall score and each subject’s level', () => {
    const { store, svc } = make();
    seedDemoLessons(store, T0);
    const r = svc.state().review!;
    expect(r.score).toMatchObject({ cards: expect.any(Number), lessonsDone: 2 });
    expect(r.score!.score).toBeGreaterThanOrEqual(0);
    expect(r.score!.score).toBeLessThanOrEqual(100);
    expect(r.score!.solid).toBeGreaterThan(0);
    expect(r.subjects.every(s => ['started', 'familiar', 'proficient', 'mastered'].includes(s.mastery!.level))).toBe(true);
  });
});
