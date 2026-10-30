// Impara's «Studio» and quality gate (ADR 0205, src/shared/lesson-studio.ts, main/learn/prompt.ts): each tile's output
// checked and capped (mermaid headers, citations kept only for known facts, cards that cite a verified fact, a true/false
// as a choice of two, a podcast's two voices); the checks the app makes alone (citations, size, giveaway questions) and
// the gate's verdicts; the prompts give the Studio only the verified facts and tell the gate what the app found.
import { describe, expect, it } from 'vitest';
import { checkIssues, keepCites, parseGate, parseStudio, pieceIssues } from '../../src/shared/lesson-studio';
import { gatePrompt, planPrompt, studioPrompt, tutorPrompt } from '../../src/main/learn/prompt';
import type { Lesson, LessonStep } from '../../src/shared/lesson';

const FACTS = ['f1', 'f2'];

describe('parseStudio', () => {
  it('a mind map and a timeline: the right header, no directive; a timeline may say there is none', () => {
    expect(parseStudio('mindmap', { mermaid: 'mindmap\n  root((A))\n    B\n    C' }, FACTS).out).toEqual({ kind: 'mindmap', src: 'mindmap\n  root((A))\n    B\n    C' });
    expect(() => parseStudio('mindmap', { mermaid: 'flowchart LR\n a-->b' }, FACTS)).toThrow();
    expect(() => parseStudio('mindmap', { mermaid: 'mindmap\n  root((A))\n  click A "x"' }, FACTS)).toThrow();
    expect(parseStudio('timeline', { none: 'Nessuna storia nel tempo.' }, FACTS).out).toEqual({ kind: 'timeline', src: null, none: 'Nessuna storia nel tempo.' });
    expect(parseStudio('timeline', { mermaid: 'timeline\n  title T\n  2019 : a' }, FACTS).out).toMatchObject({ kind: 'timeline', src: expect.stringContaining('2019') });
  });
  it('a summary keeps only the known facts\' citations; a glossary sorted, with known cites', () => {
    const out = parseStudio('summary', { summary: 'Primo punto lungo abbastanza [f1]. Secondo punto inventato [f9]. Fine del riassunto.' }, FACTS).out;
    expect(out).toEqual({ kind: 'summary', md: 'Primo punto lungo abbastanza [f1]. Secondo punto inventato. Fine del riassunto.' });
    expect(keepCites('a [f2] b [f3]', FACTS)).toBe('a [f2] b');
    const g = parseStudio('glossary', { terms: [{ term: 'Zeta', meaning: 'z', cites: ['f1', 'f7'] }, { term: 'Alfa', meaning: 'a' }, { term: '', meaning: 'x' }] }, FACTS).out;
    expect(g).toEqual({ kind: 'glossary', terms: [{ term: 'Alfa', meaning: 'a', cites: [] }, { term: 'Zeta', meaning: 'z', cites: ['f1'] }] });
    expect(() => parseStudio('summary', { summary: 'corto' }, FACTS)).toThrow();
  });
  it('flashcards go to the review as recall cards citing a verified fact; a quiz mixes kinds, true/false as a choice of two', () => {
    const fc = parseStudio('flashcards', { cards: [{ q: 'Perché A?', answer: 'Perché B.', cites: ['f1'] }, { q: 'Perché C?', answer: 'D.', cites: ['f2'] }, { q: 'Senza fonte?', answer: 'E.', cites: ['f9'] }] }, FACTS);
    expect(fc.out).toEqual({ kind: 'flashcards', n: 2, cards: [{ q: 'Perché A?', answer: 'Perché B.' }, { q: 'Perché C?', answer: 'D.' }] });
    expect(fc.cards?.every(c => c.kind === 'recall')).toBe(true);
    const quiz = parseStudio('quiz', { cards: [
      { kind: 'choice', q: 'Q1?', options: ['a', 'b', 'c'], correct: 1, answer: 'w', cites: ['f1'] },
      { kind: 'truefalse', q: 'Q2?', options: ['Vero', 'Falso'], correct: 1, answer: 'w', cites: ['f2'] },
      { kind: 'recall', q: 'Q3?', answer: 'a', cites: ['f1'] },
      { kind: 'node', q: 'Q4?', node: 'store', answer: 'a', cites: ['f1'] },
      { kind: 'node', q: 'Q5?', node: 'nope', answer: 'a', cites: ['f1'] },
    ] }, FACTS, ['store']).out;
    expect(quiz.kind).toBe('quiz');
    expect(quiz.kind === 'quiz' && quiz.qs.map(q => q.kind)).toEqual(['choice', 'choice', 'recall', 'node']);
    expect(() => parseStudio('quiz', { cards: [{ kind: 'recall', q: 'Q?', answer: 'a', cites: ['f1'] }] }, FACTS)).toThrow(/poche/);
  });
  it('a podcast: two voices, short lines, at least four', () => {
    const p = parseStudio('podcast', { title: 'T', lines: [{ who: 0, say: 'a' }, { who: 1, say: 'b' }, { who: 'B', say: 'c' }, { who: 7, say: 'd' }, { who: 1, say: '' }] }, FACTS).out;
    expect(p).toEqual({ kind: 'podcast', title: 'T', lines: [{ who: 0, say: 'a' }, { who: 1, say: 'b' }, { who: 1, say: 'c' }, { who: 0, say: 'd' }] });
    expect(() => parseStudio('podcast', { lines: [{ who: 0, say: 'a' }] }, FACTS)).toThrow();
  });
});

describe('the quality gate', () => {
  const step = (p: Partial<LessonStep>): LessonStep => ({ id: 'p', title: 't', say: 'Una frase.', text: 'Un testo.', focus: [], ...p });
  it('sees alone: no citation while there are facts, too long for one idea, a visual of more than 12 parts', () => {
    expect(pieceIssues(step({}), true)).toEqual(['cites']);
    expect(pieceIssues(step({}), false)).toEqual([]);
    expect(pieceIssues(step({ cites: ['f1'], say: Array(90).fill('parola').join(' ') }), true)).toEqual(['one-idea']);
    expect(pieceIssues(step({ cites: ['f1'], beats: Array(5).fill({ say: 'x', focus: [] }) }), true)).toEqual(['one-idea']);
    const big = `mindmap\n  root((A))\n${Array.from({ length: 13 }, (_, i) => `    n${i}`).join('\n')}`;
    expect(pieceIssues(step({ cites: ['f1'], visual: { kind: 'mindmap', src: big } }), true)).toEqual(['diagram']);
  });
  it('a question that cannot make one think: two options, too short, the right one a giveaway', () => {
    expect(checkIssues({ q: 'Cosa succede se il timer torna a 100 ms?', options: ['a', 'b', 'c'], correct: 0 })).toEqual([]);
    expect(checkIssues({ q: 'Cosa succede se il timer torna a 100 ms?', options: ['a', 'b'], correct: 0 })).toEqual(['questions']);
    expect(checkIssues({ q: 'Vero?', options: ['a', 'b', 'c'], correct: 0 })).toEqual(['questions']);
    expect(checkIssues({ q: 'Cosa succede se il timer torna a 100 ms?', options: ['Il testo torna a scatti perché una delle due attese torna lunga', 'No', 'Sì'], correct: 0 })).toEqual(['questions']);
  });
  it('reads the gate\'s verdicts: pass, fails with known rules only, a rewrite', () => {
    const g = parseGate({ pieces: [{ n: 1, pass: true, fails: ['cites'] }, { n: 2, pass: false, fails: ['one-idea', 'vibes'], fix: { title: 'x' } }, { n: 0 }, { n: 'x' }], checks: [{ n: 1, fails: ['questions'] }] });
    expect(g.pieces).toEqual([{ n: 1, fails: [] }, { n: 2, fails: ['one-idea'], fix: { title: 'x' } }]);
    expect(g.checks).toEqual([{ n: 1, fails: ['questions'] }]);
    expect(parseGate(null)).toEqual({ pieces: [], checks: [] });
  });
});

describe('prompts (ADR 0205)', () => {
  const l = { id: 'l1', title: 'Lezione', diagram: 'flowchart LR\n a["A"] --> b["B"]', level: 'basics', kind: 'topic', ask: 'a', steps: [step0()], checks: [],
    facts: [{ id: 'f1', claim: 'Vero.', from: 'web', ref: 'https://x.dev/a', check: 'ok' }, { id: 'f2', claim: 'Forse.', from: 'known', ref: '', check: 'unsure' }] } as unknown as Lesson;
  function step0(): LessonStep { return { id: 'p1', title: 'Uno', say: 'S.', text: 'T.', focus: ['a'], role: 'problem' }; }
  it('the lesson\'s structure and the visuals are in the plan', () => {
    const p = planPrompt('it', { kind: 'topic', ask: 'x', depth: 'quick', level: 'basics' }, { text: '', files: {}, cwd: null, sources: [] }, '/tmp/l');
    for (const w of ['"problem"', 'concrete case with real names and values first', '"worked" → "faded" → "practice"', 'recall check after every second piece', 'only if a verified fact states it', '"recap"', '"sequence"', '"formula"', '"chart"', 'at most 12 parts']) expect(p).toContain(w);
  });
  it('the Studio sees only the verified facts and asks no research', () => {
    const p = studioPrompt('it', 'quiz', l);
    expect(p).toContain('f1 [verified');
    expect(p).not.toContain('Forse.');
    expect(p).toContain('no search');
    expect(p).toContain('"truefalse"');
  });
  it('the gate gets the checklist, the draft and what the app found', () => {
    const p = gatePrompt('it', l, [step0()], [], { s1: ['cites'] });
    expect(p).toContain('- one-idea:');
    expect(p).toContain('"appFound":["cites"]');
    expect(p).toContain('Rewrite only what fails');
  });
  it('the tutor\'s quiz asks one question at a time and leaves no card', () => {
    const p = tutorPrompt('it', l, null, 'Mettimi alla prova', 'quiz', '/tmp/l');
    expect(p).toContain('one question at a time');
    expect(p).toContain('No card line');
    expect(p).not.toContain('CARD: {');
  });
});
