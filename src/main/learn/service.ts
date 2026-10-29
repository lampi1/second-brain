// Impara in main (ADR 0183): makes, keeps and moves the user's lessons. A start gathers the material (material.ts: a
// PR's diff through the user's own gh or git, a pasted text, nothing for a topic), then asks the model in two hidden
// read-only runs (deps.teach, compare/headless.ts): the plan with the first two pieces (the user starts learning on
// them) and, in the background, the rest. «Spiegamelo meglio», «Fammi un esempio», «Mostrami il codice», a question and
// the final «Spiegalo tu» are one short run each. Answers to the checks are judged here, at zero tokens. Every answer
// of the model is checked by shared/lesson.ts before it reaches a lesson; a run that fails leaves a sentence and
// «Riprova», never a broken lesson. A lesson is written after every change (store.ts) and the renderer gets it at once
// (deps.changed → 'impara:changed'). Wired in wiring.ts / demo-wiring.ts, IPC impara:* in index.ts; tests:
// test/unit/learn-service.test.ts.
import { errText, log } from '../log';
import type { Lang } from '@shared/contract';
import {
  LESSON_DEPTHS, LESSON_EXTRAS, LESSON_LEVELS, checkKey, diagramNodes, jsonIn, parseExtra, parseGrade, parsePlan, playlist, stepKey,
  type ImparaState, type Lesson, type LessonConfidence, type LessonExtraKind, type LessonKind, type LessonStart, type LessonStep,
} from '@shared/lesson';
import { cutDiff, gather, INLINE_MAX, type GatherDeps, type Material } from './material';
import { extraPrompt, gradePrompt, planPrompt, restPrompt } from './prompt';
import type { LessonStore } from './store';

export interface TeachRun { cwd: string; prompt: string; effort: 'low' | 'medium'; round: 'impara-plan' | 'impara-rest' | 'impara-extra' | 'impara-grade'; timeoutMs: number }
export type TeachResult = { ok: true; text: string; costUsd: number | null; engine: string | null; model: string | null } | { ok: false; error: string };

export interface LearnDeps extends GatherDeps {
  store: LessonStore;
  lang: () => Lang;
  /** one hidden read-only model run (an engine that is on and reads files) */
  teach: (r: TeachRun) => Promise<TeachResult>;
  /** why no lesson can be made now (no engine on), or null */
  cannotTeach: () => string | null;
  changed: (state: ImparaState, lesson?: Lesson) => void;
  now?: () => number;
}

const KINDS: readonly LessonKind[] = ['pr', 'topic', 'text'];
const MIN = 60_000;
const START_FILE = 'richiesta.json';

export class LearnService {
  /** lessons whose plan or rest is being written now */
  private readonly jobs = new Set<string>();
  /** lessons whose extra piece or grade is being written now */
  private readonly extras = new Set<string>();
  constructor(private readonly d: LearnDeps) {
    // a lesson the app was closed while it was being written never finishes by itself: «Riprova» starts it again;
    // an extra or a grade cut off the same way frees the lesson and says so; a folder left by a remove is cleared
    d.store.sweep();
    for (const s of d.store.list()) {
      const l = d.store.get(s.id);
      if (!l || (l.state !== 'preparing' && l.state !== 'more' && !l.busy)) continue;
      const cut = l.busy ? { busy: undefined, busyError: 'interrotta: l’app si è chiusa mentre la preparavo' } : {};
      d.store.save(l.state === 'preparing' ? { ...l, ...cut, state: 'failed', error: 'interrotta: l’app si è chiusa mentre la preparavo' }
        : l.state === 'more' ? { ...l, ...cut, error: 'interrotta: l’app si è chiusa mentre scrivevo il resto' } : { ...l, ...cut });
    }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }

  state(): ImparaState {
    const why = this.d.cannotTeach();
    return { lessons: this.d.store.list(), dir: this.d.store.root, canTeach: !why, ...(why ? { why } : {}) };
  }
  get(id: string): Lesson | null { return this.d.store.get(String(id)); }

  private emit(l?: Lesson): void { try { this.d.changed(this.state(), l); } catch (e) { log.warn('learn', 'lesson change not sent', { cause: errText(e) }); } }
  /** Reads the lesson now, changes it, writes it: no await in between, so two runs that end together never lose a change. */
  private edit(id: string, fn: (l: Lesson) => Lesson | void): Lesson | null {
    const l = this.d.store.get(id);
    if (!l) return null;
    const next = { ...(fn(l) ?? l), updatedAt: this.now() };
    this.d.store.save(next);
    this.emit(next);
    return next;
  }
  private must(id: string): Lesson {
    const l = this.d.store.get(String(id));
    if (!l) throw new Error('Lezione non trovata.');
    return l;
  }

  start(raw: LessonStart): Lesson {
    const why = this.d.cannotTeach();
    if (why) throw new Error(why);
    const kind = KINDS.includes(raw?.kind) ? raw.kind : null;
    if (!kind) throw new Error('Scegli cosa vuoi imparare.');
    const ask = String(raw.ask ?? '').trim().slice(0, 600);
    if (!ask && kind === 'topic') throw new Error('Scrivi cosa vuoi capire.');
    const req: LessonStart = {
      kind, ask: ask || (kind === 'pr' ? 'Voglio padroneggiare questa PR.' : 'Spiegami questo testo.'),
      depth: LESSON_DEPTHS.includes(raw.depth) ? raw.depth : 'lesson', level: LESSON_LEVELS.includes(raw.level) ? raw.level : 'basics',
      ...(kind === 'pr' ? { prUrl: String(raw.prUrl ?? '').trim().slice(0, 500) } : {}),
      ...(kind === 'text' ? { text: String(raw.text ?? '') } : {}),
    };
    if (kind === 'pr' && !req.prUrl) throw new Error('Scegli una PR o incollane il link.');
    if (kind === 'text' && !req.text?.trim()) throw new Error('Incolla il testo da spiegare.');
    const now = this.now(), id = this.d.store.newId(now);
    const l: Lesson = {
      id, title: kind === 'topic' ? ask.slice(0, 120) : kind === 'text' ? 'Testo incollato' : 'La tua PR', kind, ask: req.ask, depth: req.depth, level: req.level,
      createdAt: now, updatedAt: now, state: 'preparing', diagram: '', outline: [], steps: [], checks: [], at: '', costUsd: null, engine: null, model: null, sources: [],
    };
    this.d.store.save(l);
    this.d.store.writeFile(id, START_FILE, JSON.stringify(req));
    log.info('learn', 'lesson started', { data: { id, kind, depth: req.depth, level: req.level } });
    this.emit(l);
    void this.prepare(id, req);
    return l;
  }

  private request(id: string): LessonStart | null {
    try { return JSON.parse(this.d.store.readFile(id, START_FILE) ?? 'null') as LessonStart | null; } catch { return null; }
  }
  private folder(l: Pick<Lesson, 'id' | 'readDir'>): string { return l.readDir ?? this.d.store.dir(l.id); }
  /** The material again, from the lesson's files (for the rest and the extra pieces). */
  private material(id: string): Material {
    const head = this.d.store.readFile(id, 'materiale.md') ?? '', diff = this.d.store.readFile(id, 'diff.patch') ?? '', pasted = this.d.store.readFile(id, 'testo.md');
    const files: Record<string, string> = {};
    if (head) files['materiale.md'] = '';
    if (diff) files['diff.patch'] = '';
    if (pasted) files['testo.md'] = '';
    let text = pasted ? `## Testo dell'utente\n${pasted.slice(0, INLINE_MAX)}` : head;
    if (diff) { const cut = cutDiff(diff, Math.max(10_000, INLINE_MAX - head.length)); text += `\n\n## Diff${cut.cut ? ' (tagliato: quello intero è nel file diff.patch)' : ''}\n\`\`\`diff\n${cut.text}\n\`\`\``; }
    return { text, files, cwd: null, sources: [] };
  }
  private cost(l: Lesson, r: Extract<TeachResult, { ok: true }>): Pick<Lesson, 'costUsd' | 'engine' | 'model'> {
    return { costUsd: r.costUsd === null ? l.costUsd : (l.costUsd ?? 0) + r.costUsd, engine: r.engine ?? l.engine, model: r.model ?? l.model };
  }

  private async prepare(id: string, req: LessonStart): Promise<void> {
    this.jobs.add(id);
    let more = false;
    try {
      let m: Material;
      try { m = await gather(req, this.d); }
      catch (e) { this.edit(id, l => ({ ...l, state: 'failed', error: errText(e).slice(0, 300) })); return; }
      if (!this.d.store.get(id)) return; // removed while its material was being read: nothing is written back
      for (const [name, content] of Object.entries(m.files)) this.d.store.writeFile(id, name, content);
      const set = this.edit(id, l => ({ ...l, sources: m.sources, ...(m.pr ? { pr: m.pr } : {}), ...(m.title ? { title: m.title.slice(0, 120) } : {}), ...(m.cwd ? { readDir: m.cwd } : {}) }));
      if (!set) return;
      const r = await this.d.teach({ cwd: this.folder(set), prompt: planPrompt(this.d.lang(), req, m, this.d.store.dir(id)), effort: 'medium', round: 'impara-plan', timeoutMs: 6 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, state: 'failed', error: `Il modello non ha preparato la lezione: ${r.error}`.slice(0, 300) })); return; }
      let plan: ReturnType<typeof parsePlan>;
      try { plan = parsePlan(jsonIn(r.text), { now: this.now() }); }
      catch (e) { this.edit(id, l => ({ ...l, state: 'failed', error: `La lezione scritta dal modello non era valida (${errText(e)}).`.slice(0, 300), ...this.cost(l, r) })); return; }
      const done = this.edit(id, l => {
        const outline = plan.outline.length >= plan.steps.length ? plan.outline : plan.steps.map(s => s.title);
        more = outline.length > plan.steps.length;
        return { ...l, ...this.cost(l, r), title: plan.title || l.title, diagram: plan.diagram, outline, steps: plan.steps, checks: plan.checks,
          ...(plan.explainQ ? { explain: { q: plan.explainQ } } : {}), state: more ? 'more' : 'ready', at: stepKey(plan.steps[0]!.id), error: undefined };
      });
      log.info('learn', 'lesson plan ready', { data: { id, steps: plan.steps.length, planned: done?.outline.length, costUsd: r.costUsd } });
    } catch (e) {
      log.warn('learn', 'lesson preparation failed', { cause: errText(e), hint: 'Riprova from the lesson' });
      this.edit(id, l => ({ ...l, state: 'failed', error: errText(e).slice(0, 300) }));
    } finally { this.jobs.delete(id); this.d.store.sweep(id); }
    if (more) await this.rest(id);
  }

  private async rest(id: string): Promise<void> {
    const l0 = this.d.store.get(id), req = this.request(id);
    if (!l0 || !req || this.jobs.has(id)) return;
    this.jobs.add(id);
    try {
      const r = await this.d.teach({ cwd: this.folder(l0), prompt: restPrompt(this.d.lang(), l0, req, this.material(id), this.d.store.dir(id)), effort: 'medium', round: 'impara-rest', timeoutMs: 8 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, error: `Il resto della lezione non è arrivato: ${r.error}`.slice(0, 300) })); return; }
      let part: ReturnType<typeof parsePlan>;
      try { part = parsePlan(jsonIn(r.text), { now: this.now(), base: l0.diagram }); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), error: `Il resto della lezione non era valido (${errText(e)}).`.slice(0, 300) })); return; }
      this.edit(id, l => ({ ...l, ...this.cost(l, r), steps: [...l.steps, ...part.steps], checks: [...l.checks, ...part.checks],
        outline: [...l.outline.slice(0, l.steps.filter(s => !s.extra).length), ...part.steps.map(s => s.title)], state: 'ready', error: undefined }));
      log.info('learn', 'lesson complete', { data: { id, steps: part.steps.length, costUsd: r.costUsd } });
    } catch (e) {
      this.edit(id, l => ({ ...l, error: errText(e).slice(0, 300) }));
    } finally { this.jobs.delete(id); this.d.store.sweep(id); }
  }

  /** «Riprova»: a lesson that failed starts again; one whose rest is missing asks for it again; a failed extra is forgotten. */
  retry(id: string): Lesson {
    const l = this.must(id);
    if (l.state === 'failed') {
      const req = this.request(l.id);
      if (!req) throw new Error('Questa lezione non si può rifare: iniziane una nuova.');
      const why = this.d.cannotTeach();
      if (why) throw new Error(why);
      const next = this.edit(l.id, x => ({ ...x, state: 'preparing', error: undefined }))!;
      void this.prepare(l.id, req);
      return next;
    }
    const next = this.edit(l.id, x => ({ ...x, error: undefined, busyError: undefined, ...(x.busy && !this.extras.has(x.id) ? { busy: undefined } : {}) }))!;
    if (l.state === 'more' && !this.jobs.has(l.id)) void this.rest(l.id);
    return next;
  }

  /** Where the user is now (the rail, Avanti, Indietro): any key of the play-list. */
  move(id: string, at: string): Lesson {
    const l = this.must(id);
    if (!playlist(l).some(p => p.key === at)) throw new Error('Pezzo non trovato.');
    return this.edit(l.id, x => ({ ...x, at }))!;
  }

  /** A check answered (zero tokens: its right answer came with it). The first answer stays. */
  answer(id: string, checkId: string, choice: number, confidence?: LessonConfidence): Lesson {
    const l = this.must(id);
    const c = l.checks.find(x => x.id === checkId);
    if (!c) throw new Error('Domanda non trovata.');
    if (!Number.isInteger(choice) || choice < 0 || choice >= c.options.length) throw new Error('Risposta non valida.');
    const conf = confidence === 0 || confidence === 1 || confidence === 2 ? confidence : undefined;
    return this.edit(l.id, x => ({ ...x, checks: x.checks.map(k => k.id !== checkId ? k
      : k.answer ? (conf !== undefined && k.answer.confidence === undefined ? { ...k, answer: { ...k.answer, confidence: conf } } : k)
      : { ...k, answer: { choice, ...(conf !== undefined ? { confidence: conf } : {}), at: this.now() } }) }))!;
  }

  /** The piece an item is about: a piece itself, a check's piece, the last main piece for the end. */
  private pieceAt(l: Lesson, key: string): LessonStep | null {
    if (key.startsWith('s:')) return l.steps.find(s => stepKey(s.id) === key) ?? null;
    if (key.startsWith('c:')) { const c = l.checks.find(x => checkKey(x.id) === key); return c ? l.steps.find(s => s.id === c.after) ?? null : null; }
    return [...l.steps].reverse().find(s => !s.extra) ?? null;
  }

  /** «Spiegamelo meglio», «Fammi un esempio», «Mostrami il codice», a question: one extra piece after the one at `at`;
   *  the user lands on it when it arrives. One at a time per lesson. */
  ask(id: string, kind: LessonExtraKind, at: string, question?: string): Lesson {
    const l = this.must(id);
    if (!LESSON_EXTRAS.includes(kind)) throw new Error('Richiesta non valida.');
    if (l.busy) throw new Error('Sto già preparando una risposta per questa lezione.');
    if (l.state === 'preparing' || l.state === 'failed' || !l.diagram) throw new Error('La lezione non è ancora pronta.');
    const piece = this.pieceAt(l, at);
    if (!piece) throw new Error('Pezzo non trovato.');
    const ask = kind === 'question' ? String(question ?? '').trim().slice(0, 600) : undefined;
    if (kind === 'question' && !ask) throw new Error('Scrivi la domanda.');
    const why = this.d.cannotTeach();
    if (why) throw new Error(why);
    const next = this.edit(l.id, x => ({ ...x, busy: { kind, of: piece.id, ...(ask ? { ask } : {}), since: this.now() }, busyError: undefined }))!;
    void this.extra(l.id, piece, kind, ask);
    return next;
  }

  private async extra(id: string, piece: LessonStep, kind: LessonExtraKind, ask: string | undefined): Promise<void> {
    const l0 = this.d.store.get(id);
    if (!l0) return;
    this.extras.add(id);
    try {
      const r = await this.d.teach({ cwd: this.folder(l0), prompt: extraPrompt(this.d.lang(), l0, piece, kind, ask, this.material(id), this.d.store.dir(id)), effort: 'low', round: 'impara-extra', timeoutMs: 3 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, busy: undefined, busyError: `Non è arrivata: ${r.error}`.slice(0, 300) })); return; }
      let got: ReturnType<typeof parseExtra>;
      try { got = parseExtra(jsonIn(r.text), diagramNodes(l0.diagram), piece.id, kind, ask, this.now()); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), busy: undefined, busyError: `La risposta non era valida (${errText(e)}).`.slice(0, 300) })); return; }
      this.edit(id, l => ({ ...l, ...this.cost(l, r), steps: [...l.steps, got.step], checks: got.check ? [...l.checks, { ...got.check, after: got.step.id }] : l.checks,
        busy: undefined, at: stepKey(got.step.id) }));
      log.info('learn', 'extra piece ready', { data: { id, kind, costUsd: r.costUsd } });
    } catch (e) {
      this.edit(id, l => ({ ...l, busy: undefined, busyError: errText(e).slice(0, 300) }));
    } finally { this.extras.delete(id); this.d.store.sweep(id); }
  }

  /** The final «Spiegalo tu»: graded by one short run; an empty answer ends the lesson without a grade. */
  explain(id: string, text: string): Lesson {
    const l = this.must(id);
    if (l.state !== 'ready') throw new Error('La lezione non è ancora completa.');
    if (l.busy) throw new Error('Sto già preparando una risposta per questa lezione.');
    const answer = String(text ?? '').trim().slice(0, 4000);
    const q = l.explain?.q || 'Spiega con parole tue tutto quello che hai capito.';
    if (!answer) return this.edit(l.id, x => ({ ...x, explain: { q }, at: 'end', doneAt: x.doneAt ?? this.now() }))!;
    const why = this.d.cannotTeach();
    if (why) throw new Error(why);
    const next = this.edit(l.id, x => ({ ...x, at: 'end', explain: { q, answer, at: this.now() }, busy: { kind: 'grade', of: 'end', since: this.now() }, busyError: undefined }))!;
    void this.grade(l.id, answer);
    return next;
  }

  private async grade(id: string, answer: string): Promise<void> {
    const l0 = this.d.store.get(id);
    if (!l0) return;
    this.extras.add(id);
    try {
      const r = await this.d.teach({ cwd: this.folder(l0), prompt: gradePrompt(this.d.lang(), l0, answer), effort: 'low', round: 'impara-grade', timeoutMs: 2 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, busy: undefined, busyError: `Il giudizio non è arrivato: ${r.error}`.slice(0, 300) })); return; }
      let g: ReturnType<typeof parseGrade>;
      try { g = parseGrade(jsonIn(r.text)); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), busy: undefined, busyError: `Il giudizio non era valido (${errText(e)}).`.slice(0, 300) })); return; }
      this.edit(id, l => ({ ...l, ...this.cost(l, r), busy: undefined, doneAt: l.doneAt ?? this.now(),
        explain: { ...(l.explain ?? { q: '' }), answer, grade: g.grade, feedback: g.feedback, ...(g.missing ? { missing: g.missing } : {}) } }));
    } catch (e) {
      this.edit(id, l => ({ ...l, busy: undefined, busyError: errText(e).slice(0, 300) }));
    } finally { this.extras.delete(id); this.d.store.sweep(id); }
  }

  remove(id: string): void {
    this.must(id);
    // a run still working in the folder (Windows keeps it busy): the lesson is gone now, its folder when the run ends
    this.d.store.remove(String(id), this.jobs.has(id) || this.extras.has(id));
    log.info('learn', 'lesson removed', { data: { id } });
    this.emit();
  }
}
