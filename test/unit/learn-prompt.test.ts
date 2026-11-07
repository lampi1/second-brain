// Impara's prompts by kind of lesson (ADR 0221, src/main/learn/prompt.ts, explain-rules.ts): «Spiegazione» asks
// nothing (no checks, no half-done or practice piece, no «Spiegalo tu», no review card from the tutor, at most one
// question before the lesson), puts a picture on every piece with a short caption and offers the before/after compare;
// «Quiz» (and a lesson saved before the modes) keeps the checks, the practice pieces and the cards.
import { describe, expect, it } from 'vitest';
import { extraPrompt, filesResearchPrompt, gatePrompt, planPrompt, restPrompt, tutorPrompt } from '../../src/main/learn/prompt';
import type { Lesson, LessonStart, LessonStep } from '../../src/shared/lesson';

const M = { text: '', files: {}, cwd: null, sources: [] };
const req = (mode?: LessonStart['mode']): LessonStart => ({ kind: 'topic', ask: 'x', depth: 'quick', level: 'basics', ...(mode ? { mode } : {}) });
const step: LessonStep = { id: 'p1', title: 'Uno', say: 'S.', text: 'T.', focus: ['a'], role: 'problem' };
const lesson = (mode?: Lesson['mode']) => ({
  id: 'l1', title: 'Lezione', kind: 'topic', ask: 'x', depth: 'quick', level: 'basics', diagram: 'flowchart LR\n a["A"] --> b["B"]', outline: ['Uno', 'Due'],
  steps: [step], checks: [], facts: [{ id: 'f1', claim: 'Vero.', from: 'web', ref: 'https://x.dev/a', check: 'ok' }], ...(mode ? { mode } : {}),
}) as unknown as Lesson;
const PLACES = { material: [], brain: null, guide: null, appSource: null };

describe('the plan by kind of lesson', () => {
  it('an explanation asks nothing and draws every piece', () => {
    const p = planPrompt('it', req('explain'), M, '/tmp/l');
    expect(p).toContain('ASKS NOTHING');
    expect(p).toContain('never omit it');
    expect(p).toContain('"type": "compare"');
    expect(p).toContain('at most 40 words');
    for (const w of ['"checks":', '"faded"', '"practice"', 'recall check after every second piece', '"explain": "..."']) expect(p).not.toContain(w);
  });
  it('a quiz and a request without a mode keep the checks and the practice pieces', () => {
    for (const r of [req('quiz'), req()]) {
      const p = planPrompt('it', r, M, '/tmp/l');
      for (const w of ['"checks":', '"faded"', 'recall check after every second piece', '"explain": "..."']) expect(p).toContain(w);
      expect(p).not.toContain('ASKS NOTHING');
    }
  });
});

describe('the rest, the extras and the gate by kind of lesson', () => {
  it('the rest of an explanation has no checks', () => {
    expect(restPrompt('it', lesson('explain'), req('explain'), M, '/tmp/l')).not.toContain('"checks":');
    expect(restPrompt('it', lesson('quiz'), req('quiz'), M, '/tmp/l')).toContain('"checks":');
  });
  it('«Spiegamelo meglio» adds a check only in a quiz', () => {
    expect(extraPrompt('it', lesson('explain'), step, 'better', undefined, M, '/tmp/l')).not.toContain('"check":');
    expect(extraPrompt('it', lesson('quiz'), step, 'better', undefined, M, '/tmp/l')).toContain('"check":');
  });
  it('the gate of an explanation checks the picture, not the questions', () => {
    const e = gatePrompt('it', lesson('explain'), [step], [], {});
    expect(e).toContain('- visual:');
    expect(e).not.toContain('- questions:');
    const q = gatePrompt('it', lesson('quiz'), [step], [], {});
    expect(q).toContain('- questions:');
    expect(q).not.toContain('- visual:');
  });
});

describe('the tutor and the research by kind of lesson', () => {
  it('the tutor of an explanation leaves no review card', () => {
    expect(tutorPrompt('it', lesson('explain'), step, 'Perché?', 'tell', '/tmp/l')).not.toContain('CARD: {');
    expect(tutorPrompt('it', lesson('quiz'), step, 'Perché?', 'tell', '/tmp/l')).toContain('CARD: {');
  });
  it('an explanation asks at most one question before it starts', () => {
    expect(filesResearchPrompt('it', req('explain'), { text: '' }, PLACES, false)).toContain('at most 1 short question');
    expect(filesResearchPrompt('it', req('quiz'), { text: '' }, PLACES, false)).not.toContain('at most 1 short question');
  });
});
