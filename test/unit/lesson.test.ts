// Impara's shared rules (ADR 0183, src/shared/lesson.ts): the node ids a flowchart declares (labels and edge text left
// out), the lit piece added by the app only on known ids, the play order (a piece, its extras, its checks, the end),
// progress and how each piece went, the model's answers checked and capped, the spoken commands and choices.
import { describe, expect, it } from 'vitest';
import {
  diagramNodes, doneNodes, jsonIn, parseExtra, parseGrade, parseLessonCommand, parsePlan, parseSpokenChoice, pieceScores, playlist, progressOf, rootOf, summaryOf, withFocus,
  type FocusColors, type Lesson, type LessonCheck, type LessonStep,
} from '../../src/shared/lesson';

const COLORS: FocusColors = { now: { fill: '#111111', stroke: '#222222', text: '#333333' }, done: { fill: '#444444', stroke: '#555555', text: '#666666' }, dim: { fill: '#777777', stroke: '#888888', text: '#999999' } };
const step = (id: string, extra?: LessonStep['extra'], focus: string[] = []): LessonStep => ({ id, title: id, say: id, text: id, focus, ...(extra ? { extra } : {}) });
const check = (id: string, after: string, answer?: number): LessonCheck => ({ id, after, kind: 'choice', q: id, options: ['a', 'b'], correct: 0, why: 'w', ...(answer !== undefined ? { answer: { choice: answer, at: 1 } } : {}) });
const lesson = (p: Partial<Lesson>): Lesson => ({
  id: '20261029-100000-abcd', title: 't', kind: 'topic', ask: 'a', depth: 'lesson', level: 'basics', createdAt: 1, updatedAt: 1, state: 'ready', diagram: 'flowchart LR\n a --> b',
  outline: [], steps: [], checks: [], at: '', costUsd: null, engine: null, model: null, sources: [], ...p,
});

describe('diagramNodes', () => {
  it('finds shaped nodes and edge ends, never labels or keywords', () => {
    const src = 'flowchart LR\n  engine["Motore<br/>CLI"] -->|"pezzi di testo"| manager("Chat Manager")\n  manager --> ipc{IPC}\n  ipc -.-> store[[Store]]\n  classDef x fill:#fff\n  class engine x';
    expect(diagramNodes(src).sort()).toEqual(['engine', 'ipc', 'manager', 'store']);
  });
  it('drops the text written between an edge\'s dashes and keeps the node after an asymmetric shape', () => {
    expect(diagramNodes('graph TD\n A -- some text --> B\n C>flag] --> D').sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(diagramNodes('flowchart LR\n A --- B\n B ==> C').sort()).toEqual(['A', 'B', 'C']);
  });
  it('ignores subgraph ids and comments', () => {
    expect(diagramNodes('flowchart LR\n subgraph main["Main"]\n a --> b\n end\n %% c --> d').sort()).toEqual(['a', 'b']);
  });
});

describe('withFocus', () => {
  const src = 'flowchart LR\n a --> b\n b --> c';
  it('lights the piece, calms the seen ones, dims the rest', () => {
    const out = withFocus(src, ['b'], ['a'], COLORS);
    expect(out).toContain('class b sbNow');
    expect(out).toContain('class a sbDone');
    expect(out).toContain('class c sbDim');
    expect(out).toContain('classDef sbNow fill:#111111,stroke:#222222,stroke-width:3px,color:#333333');
  });
  it('uses only ids the diagram declares and never a colour that is not hex', () => {
    const out = withFocus(src, ['b;click b call x', 'zz'], [], { ...COLORS, now: { fill: 'rgba(1,2,3,.5)', stroke: '#222222', text: '#333333' } });
    expect(out).not.toContain('click');
    expect(out).not.toContain('zz');
    expect(out).not.toContain('rgba');
    expect(out).not.toMatch(/^class .* sbDim$/m); // nothing lit: nothing dimmed
  });
});

describe('play order and progress', () => {
  const l = lesson({
    steps: [step('p1', undefined, ['a']), step('p2', undefined, ['b']), step('x1', { kind: 'better', of: 'p1' }), step('x2', { kind: 'example', of: 'x1' })],
    checks: [check('q1', 'p1', 1), check('qx', 'x1', 0), check('q2', 'p2')], outline: ['p1', 'p2', 'p3'],
  });
  it('goes piece, its extras (each with its own extras and checks), its checks, then the end', () => {
    expect(playlist(l).map(p => p.key)).toEqual(['s:p1', 's:x1', 's:x2', 'c:qx', 'c:q1', 's:p2', 'c:q2', 'end']);
    expect(playlist({ ...l, state: 'more' }).map(p => p.key).at(-1)).toBe('c:q2');
  });
  it('finds the main piece of an extra and of a check', () => {
    expect(rootOf(l, 's:x2')?.id).toBe('p1');
    expect(rootOf(l, 'c:qx')?.id).toBe('p1');
    expect(rootOf(l, 'c:q2')?.id).toBe('p2');
  });
  it('counts seen pieces, right answers and extras', () => {
    expect(progressOf({ ...l, at: 's:x2' })).toMatchObject({ seen: 1, total: 3, right: 1, answered: 2, checks: 3, asked: 2 });
    expect(progressOf({ ...l, at: 'end' }).seen).toBe(2);
    expect(summaryOf({ ...l, at: 'end', doneAt: 5 })).toMatchObject({ steps: 2, planned: 3, done: true });
  });
  it('scores a piece by its checks (an extra\'s too) and lowers it a little for each extra it needed', () => {
    const s = pieceScores(l);
    expect(s[0]).toMatchObject({ id: 'p1' });
    expect(s[0]!.score).toBeCloseTo(0.5 - 0.2);
    expect(s[1]).toMatchObject({ id: 'p2', score: null });
  });
  it('the nodes seen before a piece, in play order', () => {
    expect(doneNodes(l, 's:p2')).toEqual(['a']);
  });
});

describe('reading the model', () => {
  const plan = {
    title: 'T', diagram: 'flowchart LR\n a["A"] --> b["B"]', outline: ['one', 'two', 'three'],
    steps: [{ title: 'one', say: 's1', text: 't1', focus: ['a', 'nope'] }, { title: 'broken' }, { title: 'two', say: 's2', focus: ['b'], code: { file: 'x.ts', diff: '+a' }, words: [{ term: 'w', meaning: 'm' }, { term: '' }] }],
    checks: [{ afterStep: 2, kind: 'predict', q: 'q?', options: ['x', 'y'], correct: 1, why: 'because' }, { afterStep: 9, q: 'q', options: ['x', 'y'], correct: 0, why: 'w' }, { afterStep: 1, q: 'q', options: ['x'], correct: 0, why: 'w' }],
    explain: 'Explain it',
  };
  it('keeps the valid pieces, drops focus on unknown nodes, ties checks to the answer\'s pieces', () => {
    const p = parsePlan(plan, { now: 1 });
    expect(p.steps.map(s => s.title)).toEqual(['one', 'two']);
    expect(p.steps[0]!.focus).toEqual(['a']);
    expect(p.steps[1]!.code).toEqual({ file: 'x.ts', diff: '+a' });
    expect(p.steps[1]!.words).toEqual([{ term: 'w', meaning: 'm' }]);
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0]).toMatchObject({ after: p.steps[1]!.id, kind: 'predict', correct: 1 });
    expect(p.explainQ).toBe('Explain it');
  });
  it('refuses a diagram that is not a flowchart, and an answer with no valid piece', () => {
    expect(() => parsePlan({ ...plan, diagram: 'sequenceDiagram\n a->>b: x' })).toThrow(/flowchart/);
    expect(() => parsePlan({ ...plan, steps: [{}] })).toThrow(/nessun pezzo/);
  });
  it('the rest keeps the lesson\'s diagram', () => {
    const p = parsePlan({ steps: [{ title: 'three', say: 's3', focus: ['b'] }], checks: [] }, { base: plan.diagram });
    expect(p.diagram).toBe(plan.diagram);
    expect(p.steps[0]!.focus).toEqual(['b']);
  });
  it('an extra piece hangs on its piece, its check too', () => {
    const e = parseExtra({ step: { title: 'again', say: 'simpler' }, check: { q: 'q', options: ['a', 'b'], correct: 0, why: 'w' } }, ['a'], 'p1', 'better', undefined, 1);
    expect(e.step.extra).toEqual({ kind: 'better', of: 'p1' });
    expect(e.check?.after).toBe('p1');
  });
  it('a grade is ok, partial or miss', () => {
    expect(parseGrade({ grade: 'ok', feedback: 'f' })).toEqual({ grade: 'ok', feedback: 'f' });
    expect(parseGrade({ grade: 'great', feedback: 'f', missing: 'm' })).toEqual({ grade: 'miss', feedback: 'f', missing: 'm' });
  });
  it('finds the JSON in a fence or in plain text', () => {
    expect(jsonIn('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonIn('ok {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(() => jsonIn('nothing')).toThrow();
  });
});

describe('what the user says', () => {
  it('short commands, in Italian and English', () => {
    expect(parseLessonCommand('Avanti')).toBe('next');
    expect(parseLessonCommand('ok, vai avanti per favore')).toBe('next');
    expect(parseLessonCommand('non ho capito')).toBe('better');
    expect(parseLessonCommand('fammi un esempio')).toBe('example');
    expect(parseLessonCommand('mostrami il codice')).toBe('code');
    expect(parseLessonCommand('ripeti')).toBe('repeat');
    expect(parseLessonCommand('torna indietro')).toBe('back');
    expect(parseLessonCommand('zitto')).toBe('pause');
    expect(parseLessonCommand('go on')).toBe('next');
  });
  it('anything else is not a command (a question)', () => {
    expect(parseLessonCommand('perché proprio sedici millisecondi e non zero')).toBeNull();
    expect(parseLessonCommand('')).toBeNull();
  });
  it('a spoken choice by letter, number or ordinal', () => {
    expect(parseSpokenChoice('la b', 4)).toBe(1);
    expect(parseSpokenChoice('risposta 3', 4)).toBe(2);
    expect(parseSpokenChoice('la seconda', 4)).toBe(1);
    expect(parseSpokenChoice("l'ultima", 3)).toBeNull();
    expect(parseSpokenChoice('ultima', 3)).toBe(2);
    expect(parseSpokenChoice('d', 2)).toBeNull();
    expect(parseSpokenChoice('non lo so proprio davvero', 4)).toBeNull();
  });
});
