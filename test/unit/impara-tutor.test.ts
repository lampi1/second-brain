// Impara's tutor and its entry points (ADR 0190): the answer streamed and then saved, the session started ahead and
// the question sent into it, coach and «Dimmelo e basta», the review card only from verified facts, one question at a
// time, a failed or cut answer, and app_learn starting and opening a lesson.
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
const until = async (fn: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

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
  const last = (l: Lesson) => l.tutor!.at(-1)!;

  it('a question goes into the session started ahead; the answer streams, then is saved with a review card from a verified fact', async () => {
    const { svc, runs, streamed, id, lesson } = make(r => {
      r.onText?.('Perché');
      r.onText?.(`Perché sì [f1].\nCAR`);
      return ok(`Perché sì [f1].\n${CARD}`);
    });
    const cost0 = lesson().costUsd ?? 0;
    svc.tutorWarm(id);
    svc.tutorWarm(id); // one per lesson
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ round: 'impara-tutor', effort: 'low' });
    svc.tutor(id, 's:pc1', '  Perché due ricerche?  ');
    expect(last(lesson())).toMatchObject({ q: 'Perché due ricerche?', state: 'asking', mode: 'coach', at: 's:pc1' });
    expect(() => svc.tutor(id, 's:pc1', 'Un\'altra')).toThrow(/sta già rispondendo/);
    await until(() => last(lesson()).state === 'done');
    expect(runs).toHaveLength(1); // the warm session answered
    expect(streamed).toEqual(['Perché', 'Perché sì [f1].']); // never the card line, not even half of it
    const t = last(lesson());
    expect(t.a).toBe('Perché sì [f1].');
    expect(t.card).toBe(`${id}:t:${t.id}`);
    expect(svc.review.get(t.card!)).toMatchObject({ origin: 'tutor', kind: 'recall', subject: 'second-brain', cites: ['f1'], q: 'Perché due ricerche separate?' });
    expect(lesson().costUsd).toBeCloseTo(cost0 + 0.01, 6);
  });

  it('the prompt: the verified facts, the piece, the conversation; coach asks for a hint first, «Dimmelo e basta» for the answer', async () => {
    const prompts: string[] = [];
    const { svc, id, lesson } = make((_r, prompt) => { prompts.push(prompt); return ok(prompts.length === 1 ? 'Indizio: guarda lo schema. Tu cosa pensi?' : `Risposta [f1].\n${CARD}`); });
    svc.tutor(id, 's:pc2', 'Perché la verifica?');
    await until(() => last(lesson()).state === 'done');
    expect(prompts[0]).toContain('do NOT explain yet');
    expect(prompts[0]).toContain('f1 [verified');
    expect(prompts[0]).toContain('«La verifica»');
    expect(last(lesson()).card).toBeUndefined();
    svc.tutor(id, 's:pc2', 'Perché la verifica?', 'tell');
    await until(() => lesson().tutor!.length === 2 && last(lesson()).state === 'done');
    expect(prompts[1]).not.toContain('do NOT explain yet');
    expect(prompts[1]).toContain('Learner: «Perché la verifica?»\nYou: Indizio: guarda lo schema.');
    expect(last(lesson()).mode).toBe('tell');
  });

  it('no card when the answer cites no verified fact; a failed answer says why; a dead warm session is retried cold', async () => {
    let n = 0;
    const { svc, runs, id, lesson } = make(() => {
      n++;
      if (n === 1) return ok('Risposta.\nCARD: {"q": "Q?", "answer": "A.", "cites": ["f9"]}'); // f9 is no verified fact
      if (n === 2) return { ok: false, error: 'tempo scaduto' };
      if (n === 3) return { ok: false, error: 'il motore si è chiuso' };
      return ok('Di nuovo [f2].');
    });
    svc.tutor(id, 'end', 'Domanda uno');
    await until(() => last(lesson()).state === 'done');
    expect(last(lesson()).card).toBeUndefined();
    svc.tutor(id, 'end', 'Domanda due');
    await until(() => last(lesson()).state === 'failed');
    expect(last(lesson()).error).toBe('tempo scaduto');
    svc.tutorWarm(id);
    svc.tutor(id, 'end', 'Domanda tre');
    await until(() => last(lesson()).state === 'done');
    expect(last(lesson()).a).toBe('Di nuovo [f2].');
    expect(runs.slice(-2).every(r => r.round === 'impara-tutor')).toBe(true);
    expect(runs).toHaveLength(4);
  });

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
    const l = svc.start({ kind: 'topic', ask: 'Spiegami la regola X del mio brain', depth: 'quick', level: 'basics', subject: 'Il mio brain' });
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
    expect(started[0]).toMatchObject({ kind: 'topic', ask: 'come funziona il DNS', depth: 'quick', level: 'basics' });
    expect(ui).toEqual([{ action: 'page', value: 'impara/L1' }]);
    expect(() => tool!.run({ ask: 'e anche il TCP' })).toThrow(/già partita/);
    turn = null; // app news or an agent's mail woke the Orchestrator
    expect(() => tool!.run({ ask: 'come funziona il DNS' })).toThrow(/solo quando l’utente/);
    expect(tool!.run({})).toMatchObject({ reviewDue: 3 }); // reading what Impara holds needs no ask
    turn = { who: 'o1', at: 2 };
    tool!.run({ prUrl: 'https://github.com/a/b/pull/1', depth: 'huge' });
    expect(started[1]).toMatchObject({ kind: 'pr', prUrl: 'https://github.com/a/b/pull/1', depth: 'lesson' });
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
