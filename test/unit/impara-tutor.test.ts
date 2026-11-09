// Impara's tutor and its entry points (ADR 0190): the answer streamed and then saved, the session started ahead and
// the question sent into it, coach and «Dimmelo e basta», the review card only from verified facts, one question at a
// time, a failed or cut answer, and app_learn starting and opening a lesson (in «Spiegazione» unless asked a quiz,
// ADR 0230).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tutorCard, tutorShown, type Lesson } from '../../src/shared/lesson';
import { LessonStore } from '../../src/main/learn/store';
import { LearnService, type TeachResult, type TeachRun } from '../../src/main/learn/service';
import { demoRun, seedDemoLessons } from '../../src/main/learn/demo';
import { imparaTools } from '../../src/main/appctl/impara';

const T0 = new Date(2026, 9, 29, 10).getTime();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tutor-'));

const CARD = 'CARD: {"q": "Perché due ricerche separate?", "answer": "Così chi legge il web non vede i file.", "cites": ["f1"]}';

describe('tutor answers (pure)', () => {
  it('shows the answer without its card line, also half written while it streams; reads the card', () => {
    expect(tutorShown(`Perché sì [f1].\n${CARD}`)).toBe('Perché sì [f1].');
    expect(tutorShown('Perché sì.\nCARD: {"q": "Per')).toBe('Perché sì.');
    expect(tutorShown('Perché sì.\nCAR', true)).toBe('Perché sì.');
    expect(tutorShown('Riga\nC')).toBe('Riga\nC'); // a finished answer keeps its own text
    expect(tutorCard(`Testo\n${CARD}`)).toMatchObject({ q: 'Perché due ricerche separate?', cites: ['f1'] });
    expect(tutorCard('Testo senza carta')).toBeNull();
    expect(tutorCard('Testo\nCARD: {rotto')).toBeNull();
    // as models also write it: bold, lower case, the JSON fenced; a sentence that starts with «Card:» stays
    expect(tutorShown('A.\n**CARD:** {"q": "x"}')).toBe('A.');
    expect(tutorCard('A.\n**CARD:** {"q": "x"}')).toEqual({ q: 'x' });
    expect(tutorShown('A.\ncard:\n```json\n{"q": "x"}\n```')).toBe('A.');
    expect(tutorCard('A.\ncard:\n```json\n{"q": "x"}\n```')).toEqual({ q: 'x' });
    expect(tutorShown('Card: una carta del ripasso.\nB')).toBe('Card: una carta del ripasso.\nB');
    expect(tutorShown('A.\nCARD: ', true)).toBe('A.');
    expect(tutorShown('A.\n**CA', true)).toBe('A.');
  });
});

describe('LearnService tutor', () => {
  function make(reply: (r: TeachRun, prompt: string) => TeachResult | Promise<TeachResult>) {
    const root = tmp();
    const store = new LessonStore(root);
    seedDemoLessons(store, T0);
    const runs: TeachRun[] = [];
    const streamed: string[] = [];
    const svc = new LearnService({ store, lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => null, changed: () => {}, webOk: () => false,
      tutorText: (_l, _t, text) => streamed.push(text),
      teach: async r => {
        runs.push(r);
        const prompt = await r.prompt;
        if (prompt === null) return { ok: false, error: 'non usata' };
        return reply(r, prompt);
      } });
    const app = store.list().find(s => s.title.startsWith('Come nasce'))!;
    return { root, store, svc, runs, streamed, id: app.id, lesson: () => store.get(app.id)! };
  }
  const ok = (text: string): TeachResult => ({ ok: true, text, costUsd: 0.01, engine: 'claude', model: 'opus' });

  it('refuses an empty question or a lesson not ready; a removed lesson closes its warm session; a cut answer is failed on restart', async () => {
    const { root, store, svc, runs, id } = make(() => ok('x'));
    expect(() => svc.tutor(id, 's:pc1', '   ')).toThrow(/Scrivi/);
    svc.tutorWarm(id);
    svc.remove(id);
    // the session that waited for a question got none: it ends unsent
    const r = runs[0]!;
    expect(await r.prompt).toBeNull();
    // an answer cut by a close
    const other = store.list()[0]!;
    store.save({ ...store.get(other.id)!, tutor: [{ id: 't1', q: 'Q', at: 'end', mode: 'coach', a: '', state: 'asking', createdAt: T0 }] });
    new LearnService({ store: new LessonStore(root), lang: () => 'it', run: demoRun, devops: () => ({ prs: [], repoDirs: {} }), cannotTeach: () => null, changed: () => {}, teach: async () => ok('') });
    expect(store.get(other.id)!.tutor![0]).toMatchObject({ state: 'failed', error: expect.stringMatching(/interrotta/) });
  });

  it('a lesson started from another page keeps the subject it was given', () => {
    const { svc, store } = make(() => ok('x'));
    const l = svc.start({ mode: 'quiz', kind: 'topic', ask: 'Spiegami la regola X del mio brain', depth: 'quick', level: 'basics', subject: 'Il mio brain' });
    expect(store.get(l.id)!.subject).toBe('Il mio brain');
  });
});

describe('app_learn', () => {
  it('starts a lesson and opens it in Impara, one per user message and never on a turn the user did not write; without an ask, lists the lessons and the cards due', () => {
    const started: unknown[] = [], ui: unknown[] = [];
    let turn: { who: string; at: number } | null = { who: 'o1', at: 1 };
    const [tool] = imparaTools({
      start: req => { started.push(req); return { id: 'L1' } as Lesson; },
      state: () => ({ lessons: [{ id: 'L0', title: 'Reti', subject: 'Reti', state: 'ready', done: true } as never], dir: '', canTeach: true, review: { due: 3, fresh: 1, subjects: [], streak: 0, reviewedToday: 0 } }),
    }, cmd => ui.push(cmd), () => turn);
    expect(tool!.name).toBe('app_learn');
    expect(tool!.run({ ask: 'come funziona il DNS', depth: 'quick' })).toMatchObject({ id: 'L1', page: 'impara/L1' });
    expect(started[0]).toMatchObject({ kind: 'topic', ask: 'come funziona il DNS', depth: 'quick', level: 'basics', mode: 'explain' }); // «Spiegazione» by default (ADR 0230)
    expect(ui).toEqual([{ action: 'page', value: 'impara/L1' }]);
    expect(() => tool!.run({ ask: 'e anche il TCP' })).toThrow(/già partita/);
    turn = null; // app news or an agent's mail woke the Orchestrator
    expect(() => tool!.run({ ask: 'come funziona il DNS' })).toThrow(/solo quando l’utente/);
    expect(tool!.run({})).toMatchObject({ reviewDue: 3 }); // reading what Impara holds needs no ask
    turn = { who: 'o1', at: 2 };
    tool!.run({ prUrl: 'https://github.com/a/b/pull/1', depth: 'huge', mode: 'quiz' });
    expect(started[1]).toMatchObject({ kind: 'pr', prUrl: 'https://github.com/a/b/pull/1', depth: 'lesson', mode: 'quiz' });
    turn = { who: 'o1', at: 3 };
    tool!.run({ ask: 'il TLS', mode: 'esame' });
    expect(started[2]).toMatchObject({ mode: 'explain' }); // an unknown kind falls back to the default
    expect(tool!.run({})).toEqual({ lessons: [{ id: 'L0', title: 'Reti', subject: 'Reti', state: 'finita', page: 'impara/L0' }], reviewDue: 3, reviewNew: 1 });
  });

  it('lists the score and each subject’s level once there are cards (ADR 0204)', () => {
    const [tool] = imparaTools({
      start: () => { throw new Error('no'); },
      state: () => ({ lessons: [], dir: '', canTeach: true, review: {
        due: 0, fresh: 0, streak: 2, reviewedToday: 0,
        subjects: [{ name: 'Reti', lessons: 1, cards: 4, due: 0, fresh: 0, recall: 0.9, mastery: { level: 'familiar', cards: 4, studied: 3, solid: 1, memory: 0.9 } }],
        score: { score: 23, memory: 0.912, solid: 1, cards: 4, studied: 3, delta: 5, streak: 2, lessonsDone: 1 },
      } }),
    }, () => {}, () => null);
    expect(tool!.run({})).toMatchObject({
      score: { value: 23, memoryPct: 91, solidCards: 1, cards: 4, weekChange: 5, daysInARow: 2, lessonsDone: 1 },
      subjects: [{ name: 'Reti', level: 'familiar' }],
    });
  });
});
