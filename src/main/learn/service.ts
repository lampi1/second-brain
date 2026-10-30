// Impara in main (ADR 0185): makes, keeps and moves the user's lessons. A start gathers the material (material.ts: a
// PR's diff through the user's own gh or git, a pasted text, nothing for a topic), then asks the model in two hidden
// read-only runs (deps.teach, compare/headless.ts): the plan with the first two pieces (the user starts learning on
// them) and, in the background, the rest. «Spiegamelo meglio», «Fammi un esempio», «Mostrami il codice», a question and
// the final «Spiegalo tu» are one short run each. Answers to the checks are judged here, at zero tokens. Every answer
// of the model is checked by shared/lesson.ts before it reaches a lesson; a run that fails leaves a sentence and
// «Riprova», never a broken lesson. A lesson is written after every change (store.ts) and the renderer gets it at once
// (deps.changed → 'impara:changed'). Before the plan, the research (ADR 0188): a web run that sees only the user's
// ask, a files run over the material, the user's brain and the app, both at once; then a verification run per side
// that did not write the facts, and, while it runs, the questions the files run found worth asking (at most two). The
// lesson is written from the verified facts and cites them. The files run also names public topics of the files
// (standards, specs, libraries, protocols): filtered by shared/web-topics.ts, shown as chips the user may drop, they
// start by themselves after 5 seconds (at once in «Modalità notte») and a second web run, which sees only the ask and
// those queries, searches them; its facts are verified on the web like the others (ADR 0206). Who explains is the user's choice (LessonStart.teacher).
// A finished lesson leaves review cards (ADR 0189, review-store.ts): its checks at once, and the cards one more short
// run writes from the verified facts; the reviews are scheduled by FSRS (shared/review.ts). Beside the lesson, the tutor
// (ADR 0190): a question answered in seconds, word by word, from the verified facts (no new research), on a session
// started while the learner types (`tutorWarm`); it first lets the learner try (coach) unless they ask for the answer.
// Since ADR 0205: a quality gate (one cheap run) scores the plan's pieces and the rest's on a fixed checklist and
// rewrites only the failing ones, once, before the learner sees them; the «Studio» tiles (`studio`) are one short run
// each over the verified facts only, saved with the lesson (flashcards go into the review, the quiz plays as a review
// session whose answers become cards); «Mettimi alla prova» is the tutor in quiz mode.
// Wired in wiring.ts / demo-wiring.ts, IPC impara:* in index.ts; tests: test/unit/learn-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { errText, log } from '../log';
import type { Effort, Lang } from '@shared/contract';
import {
  LESSON_DEPTHS, LESSON_EXTRAS, LESSON_LEVELS, TEACHER_EFFORTS, applyVerdicts, checkKey, diagramNodes, jsonIn, parseCheck, parseExtra, parseFacts, parseGrade, parsePlan, parseQuestions, parseStep, playlist, stepKey,
  type ImparaState, type Lesson, type LessonCheck, type LessonConfidence, type LessonExtraKind, type LessonFact, type LessonKind, type LessonPrep, type LessonStart, type LessonStep, type LessonTeacher,
  type PrepPhase, type TeacherOption, type TutorMode, type TutorTurn, subjectOf, TUTOR_KEEP, TUTOR_Q_MAX, tutorCard, tutorShown,
} from '@shared/lesson';
import { REVIEW_GRADES, parseCards, queueOf, subjectName, summarize, type ReviewCard, type ReviewGrade, type ReviewItem, type ReviewMode } from '@shared/review';
import { lastGrades, masteryOf, scoreOf } from '@shared/mastery';
import { quizValid, storedChoice } from '@shared/quiz';
import { USER_FILES, cleanFiles, withUserFiles } from './user-files';
import { parseTopicFacts, parseTopics, privateWords, TOPIC_WAIT_MS, type LessonTopics } from '@shared/web-topics';
import { cutDiff, gather, INLINE_MAX, type GatherDeps, type Material } from './material';
import { checkIssues, isStudioMade, parseGate, parseStudio, pieceIssues, type LessonQuality, type QualityRule, type StudioMade } from '@shared/lesson-studio';
import { cardsPrompt, extraPrompt, filesResearchPrompt, gatePrompt, gradePrompt, planPrompt, restPrompt, studioPrompt, topicsResearchPrompt, tutorPrompt, verifyPrompt, webResearchPrompt } from './prompt';
import { ReviewStore } from './review-store';
import type { LessonStore } from './store';

export type TeachRound = 'impara-web' | 'impara-files' | 'impara-refs' | 'impara-verify-web' | 'impara-verify-files' | 'impara-verify-refs' | 'impara-plan' | 'impara-quality' | 'impara-rest' | 'impara-extra' | 'impara-grade' | 'impara-cards' | 'impara-tutor' | 'impara-studio';
/** One hidden run. teacher = the user's choice (null = the app's); effort = the one to use (null = the engine's own);
 *  web = the web-only run (Claude, no file: compare/headless.ts web mode); a prompt still to come = a warm start (the
 *  tutor: null = not needed); onText = the answer so far, as it streams. */
export interface TeachRun { cwd: string; prompt: string | Promise<string | null>; effort: Effort | null; round: TeachRound; timeoutMs: number; teacher: LessonTeacher | null; web?: boolean; onText?: (text: string) => void }
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
  /** the engines the user may pick to explain (on, reading files), with their models and efforts */
  teachers?: () => TeacherOption[];
  /** whether the web research can run now (Claude on); absent = never */
  webOk?: () => boolean;
  /** where the files research may also read: the user's brain, the app's source (a clone with src/), each or null */
  places?: () => { brain: string | null; appSource: string | null };
  /** the app's guide as markdown (every concept and page), written next to the material for the files research */
  guide?: (lang: Lang) => string;
  /** «Modalità notte» on (the setting awayMode): the public topics start at once, nobody is there to look (ADR 0206) */
  away?: () => boolean;
  /** a tutor answer so far, as it streams (ADR 0190: 'impara:tutor'); the lesson gets the whole answer when it ends */
  tutorText?: (lessonId: string, turnId: string, text: string) => void;
}

const KINDS: readonly LessonKind[] = ['pr', 'topic', 'text'];
const MIN = 60_000;
const START_FILE = 'richiesta.json';
const GUIDE_FILE = 'guida-app.md';
/** the empty folder a web run starts in (it reads no file anyway) */
const WEB_DIR = 'web';
/** A pasted text's ask when the user wrote none. */
const TEXT_ASK = 'Spiegami questo testo.';
/** the effort a research, a plan and the rest use when the user named none */
const DEFAULT_EFFORT: Effort = 'high';
/** how long a tutor session started ahead waits for the question, then closes (it has cost nothing: no prompt sent) */
const WARM_MS = 3 * MIN;

/** A tutor session started ahead (ADR 0190): the engine is up, the question goes in when it comes. */
interface Warm { give(prompt: string | null): void; result: Promise<TeachResult>; listen: ((text: string) => void) | null }

/** A file fact's reference as the user opens it from «Fonti» (ADR 0188): a relative path becomes absolute under the
 *  first of `roots` (the run's folder, the brain, the app's source) where the file exists, else under the first; the
 *  line is kept; an absolute one stays. */
export function fullRef(ref: string, roots: readonly string[]): string {
  const m = /^(.*?)(:\d+(?:[-:]\d+)?)?$/.exec(ref.trim());
  const file = m?.[1] || ref.trim();
  if (path.isAbsolute(file) || !roots.length) return ref.trim();
  const root = roots.find(r => { try { return fs.existsSync(path.join(r, file)); } catch { return false; } }) ?? roots[0]!;
  return path.join(root, file) + (m?.[2] ?? '');
}

/** Two gate reports as one (the plan's and the rest's). */
export function mergeQuality(a: LessonQuality | undefined, b: LessonQuality): LessonQuality {
  if (!a) return b;
  const fails = { ...a.fails };
  for (const [k, n] of Object.entries(b.fails) as [QualityRule, number][]) fails[k] = (fails[k] ?? 0) + n;
  return { checked: a.checked + b.checked, fixed: a.fixed + b.fixed, fails, at: b.at, ...(a.none || b.none ? { none: true } : {}) };
}

export class LearnService {
  /** lessons whose plan or rest is being written now */
  private readonly jobs = new Set<string>();
  /** lessons whose extra piece or grade is being written now */
  private readonly extras = new Set<string>();
  /** lessons waiting for the user's answers to the questions before the lesson */
  private readonly waits = new Map<string, () => void>();
  /** lessons whose public topics wait for the user (ADR 0206): wake() starts them now, arm() moves the deadline */
  private readonly topicWaits = new Map<string, { wake: () => void; arm: (ms: number) => void }>();
  /** lessons whose review cards are being written now (apart from extras: the user can still ask for one) */
  private readonly cardJobs = new Set<string>();
  /** the review cards (ADR 0189), next to the lessons */
  readonly review: ReviewStore;
  /** lessons whose tutor is answering now, and the tutor sessions started ahead (ADR 0190) */
  private readonly tutoring = new Set<string>();
  private readonly warm = new Map<string, Warm>();
  /** the «Studio» tiles being made now, `<lesson>/<kind>` (ADR 0205) */
  private readonly studioJobs = new Set<string>();
  constructor(private readonly d: LearnDeps) {
    this.review = new ReviewStore(path.join(d.store.root, 'review.json'));
    // a lesson the app was closed while it was being written never finishes by itself: «Riprova» starts it again;
    // an extra or a grade cut off the same way frees the lesson and says so; a folder left by a remove is cleared
    d.store.sweep();
    for (const s of d.store.list()) {
      let l = d.store.get(s.id);
      if (l && l.state !== 'preparing') { try { this.review.fromChecks(l, subjectOf(l)); } catch (e) { log.warn('learn', 'review cards not written', { cause: errText(e) }); } }
      // one lesson object for both cuts below, so the second save keeps the first
      if (l?.cards?.state === 'making') { l = { ...l, cards: { state: 'failed', error: 'interrotta: l’app si è chiusa mentre scrivevo le carte' } }; d.store.save(l); }
      if (l?.studio && Object.values(l.studio).some(x => x?.state === 'making')) {
        l = { ...l, studio: Object.fromEntries(Object.entries(l.studio).map(([k, x]) => [k, x?.state === 'making' ? { ...x, state: 'failed' as const, error: 'interrotta: l’app si è chiusa mentre la preparavo' } : x])) };
        d.store.save(l);
      }
      if (l?.tutor?.some(x => x.state === 'asking')) { l = { ...l, tutor: l.tutor.map(x => (x.state === 'asking' ? { ...x, state: 'failed' as const, error: 'interrotta: l’app si è chiusa mentre rispondevo' } : x)) }; d.store.save(l); }
      if (!l || (l.state !== 'preparing' && l.state !== 'more' && !l.busy)) continue;
      const cut = l.busy ? { busy: undefined, busyError: 'interrotta: l’app si è chiusa mentre la preparavo' } : {};
      d.store.save(l.state === 'preparing' ? { ...l, ...cut, state: 'failed', error: 'interrotta: l’app si è chiusa mentre la preparavo' }
        : l.state === 'more' ? { ...l, ...cut, error: 'interrotta: l’app si è chiusa mentre scrivevo il resto' } : { ...l, ...cut });
    }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private teachers(): TeacherOption[] { try { return this.d.teachers?.() ?? []; } catch { return []; } }

  /** The start form's teacher, kept only when it names an engine on offer, a model of its list (or none) and an effort
   *  it takes; else null (the app's choice). */
  private teacherOf(raw: unknown): LessonTeacher | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const opt = this.teachers().find(t => t.engine === r.engine);
    if (!opt) return null;
    const model = typeof r.model === 'string' && r.model && opt.models.some(m => m.id === r.model) ? r.model : null;
    const effort = typeof r.effort === 'string' && (TEACHER_EFFORTS as readonly string[]).includes(r.effort) && opt.efforts.includes(r.effort as Effort) ? r.effort as Effort : null;
    return { engine: opt.engine, model, effort };
  }

  state(): ImparaState {
    const why = this.d.cannotTeach();
    const lessons = this.d.store.list();
    const bySubject = new Map<string, number>();
    for (const s of lessons) if (s.state !== 'failed') bySubject.set(s.subject, (bySubject.get(s.subject) ?? 0) + 1);
    let review: ImparaState['review'];
    try {
      const cards = this.askable(), logs = this.review.log(), now = this.now(), last = lastGrades(logs);
      const sum = summarize(cards, logs, bySubject, now);
      // the overall score and each subject's level (ADR 0204, shared/mastery.ts)
      review = { ...sum, subjects: sum.subjects.map(x => ({ ...x, mastery: masteryOf(cards.filter(c => c.subject === x.name), logs, now, last) })),
        score: scoreOf(cards, logs, now, { streak: sum.streak, lessonsDone: lessons.filter(l => l.done).length }) };
    } catch (e) { log.warn('learn', 'review summary failed', { cause: errText(e) }); }
    return { lessons, dir: this.d.store.root, canTeach: !why, ...(why ? { why } : {}), teachers: this.teachers(), ...(review ? { review } : {}) };
  }
  get(id: string): Lesson | null { return this.d.store.get(String(id)); }
  /** The cards a review may ask: the ones studied already, and new ones only from lessons the user read to the end (a
   *  lesson just written and never opened does not quiz its reader blind). */
  private askable(): ReviewCard[] {
    const done = new Set(this.d.store.list().filter(s => s.done || (s.state === 'ready' && s.planned > 0 && s.seen >= s.planned)).map(s => s.id));
    return this.review.cards().filter(c => c.mem || done.has(c.lessonId));
  }

  private emit(l?: Lesson): void { try { this.d.changed(this.state(), l); } catch (e) { log.warn('learn', 'lesson change not sent', { cause: errText(e) }); } }
  /** Reads the lesson now, changes it, writes it: no await in between, so two runs that end together never lose a change. */
  private edit(id: string, fn: (l: Lesson) => Lesson | void): Lesson | null {
    const l = this.d.store.get(id);
    if (!l) return null;
    const next = { ...(fn(l) ?? l), updatedAt: this.now() };
    this.d.store.save(next);
    // every check of a lesson the user can open is also a review card (at zero tokens)
    if (next.state !== 'preparing' && next.state !== 'failed') { try { this.review.fromChecks(next, subjectOf(next)); } catch (e) { log.warn('learn', 'review cards not written', { cause: errText(e) }); } }
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
      kind, ask: ask || (kind === 'pr' ? 'Voglio padroneggiare questa PR.' : TEXT_ASK),
      depth: LESSON_DEPTHS.includes(raw.depth) ? raw.depth : 'lesson', level: LESSON_LEVELS.includes(raw.level) ? raw.level : 'basics',
      ...(kind === 'pr' ? { prUrl: String(raw.prUrl ?? '').trim().slice(0, 500) } : {}),
      ...(kind === 'text' ? { text: String(raw.text ?? '') } : {}),
    };
    const teacher = this.teacherOf(raw.teacher);
    if (teacher) req.teacher = teacher;
    const subject = subjectName(raw.subject);
    if (subject) req.subject = subject;
    // the user's own files as sources (ADR 0204: read by the page, checked here)
    const files = cleanFiles(raw.files);
    if (files.length) req.files = files;
    if (kind === 'pr' && !req.prUrl) throw new Error('Scegli una PR o incollane il link.');
    if (kind === 'text' && !req.text?.trim()) throw new Error('Incolla il testo da spiegare.');
    const now = this.now(), id = this.d.store.newId(now);
    const l: Lesson = {
      id, title: kind === 'topic' ? ask.slice(0, 120) : kind === 'text' ? 'Testo incollato' : 'La tua PR', kind, ask: req.ask, depth: req.depth, level: req.level,
      createdAt: now, updatedAt: now, state: 'preparing', diagram: '', outline: [], steps: [], checks: [], at: '', costUsd: null, engine: null, model: null, sources: [],
      ...(teacher ? { teacher } : {}), ...(subject ? { subject } : {}), prep: { phases: { gather: 'now' } },
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
    // the user's own files (ADR 0204): named inline, read whole from their file
    if (this.d.store.readFile(id, USER_FILES)) { files[USER_FILES] = ''; text += `\n\n## File dell'utente\nNel file ${USER_FILES}.`; }
    return { text, files, cwd: null, sources: [] };
  }
  /** What a run adds: its cost; the engine and model only for the teacher's own runs (a web run is always Claude's). */
  private cost(l: Lesson, r: Extract<TeachResult, { ok: true }>, teacher = true): Pick<Lesson, 'costUsd' | 'engine' | 'model'> {
    return { costUsd: r.costUsd === null ? l.costUsd : (l.costUsd ?? 0) + r.costUsd, engine: teacher ? r.engine ?? l.engine : l.engine, model: teacher ? r.model ?? l.model : l.model };
  }
  /** The effort of a research, plan or rest run: the user's, else high. */
  private effort(req: Pick<LessonStart, 'teacher'>): Effort { return req.teacher?.effort ?? DEFAULT_EFFORT; }
  private run(req: Pick<LessonStart, 'teacher'>, r: Omit<TeachRun, 'teacher'>): Promise<TeachResult> {
    return this.d.teach({ ...r, teacher: req.teacher ?? null }).catch(e => ({ ok: false as const, error: errText(e) }));
  }
  private phase(id: string, patch: Partial<Record<PrepPhase, 'now' | 'done' | 'skip'>>, more: Partial<Omit<LessonPrep, 'phases'>> = {}, why: Partial<Record<PrepPhase, string>> = {}): Lesson | null {
    return this.edit(id, l => {
      const p = l.prep ?? { phases: {} };
      const whyAll = { ...p.why, ...why };
      return { ...l, prep: { ...p, ...more, phases: { ...p.phases, ...patch }, ...(Object.keys(whyAll).length ? { why: whyAll } : {}) } };
    });
  }

  private async prepare(id: string, req: LessonStart): Promise<void> {
    this.jobs.add(id);
    let more = false;
    try {
      let m: Material;
      try { m = withUserFiles(await gather(req, this.d), req.files); }
      catch (e) { this.edit(id, l => ({ ...l, state: 'failed', error: errText(e).slice(0, 300) })); return; }
      if (!this.d.store.get(id)) return; // removed while its material was being read: nothing is written back
      for (const [name, content] of Object.entries(m.files)) this.d.store.writeFile(id, name, content);
      const set = this.edit(id, l => ({ ...l, sources: m.sources, ...(m.pr ? { pr: m.pr } : {}), ...(m.title ? { title: m.title.slice(0, 120) } : {}), ...(m.cwd ? { readDir: m.cwd } : {}),
        prep: { phases: { gather: 'done' } }, facts: undefined, clarify: undefined }));
      if (!set) return;
      const facts = await this.research(id, req, m, set);
      if (!facts || !this.d.store.get(id)) return;
      // the questions, if any, are answered (or skipped) before the lesson is written
      const asked = this.d.store.get(id)?.clarify;
      if (asked && !asked.answers) await new Promise<void>(r => this.waits.set(id, r));
      const l1 = this.phase(id, { ask: asked ? 'done' : 'skip', plan: 'now' });
      if (!l1 || l1.state !== 'preparing') return;
      const g = { facts, ...(l1.clarify ? { clarify: l1.clarify } : {}) };
      const subjects = [...new Set(this.d.store.list().filter(s => s.id !== id).map(s => s.subject))];
      const r = await this.run(req, { cwd: this.folder(set), prompt: planPrompt(this.d.lang(), req, m, this.d.store.dir(id), g, subjects), effort: this.effort(req), round: 'impara-plan', timeoutMs: 8 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, state: 'failed', error: `Il modello non ha preparato la lezione: ${r.error}`.slice(0, 300) })); return; }
      let plan: ReturnType<typeof parsePlan>;
      try { plan = parsePlan(jsonIn(r.text), { now: this.now(), facts: facts.map(f => f.id) }); }
      catch (e) { this.edit(id, l => ({ ...l, state: 'failed', error: `La lezione scritta dal modello non era valida (${errText(e)}).`.slice(0, 300), ...this.cost(l, r) })); return; }
      // the quality gate (ADR 0205): the first pieces are checked and fixed before the learner sees them
      const lp = this.d.store.get(id);
      if (!lp) return;
      const gated = await this.gate(req, { ...lp, title: plan.title || lp.title, diagram: plan.diagram, facts }, plan.steps, plan.checks);
      if (!this.d.store.get(id)) return;
      plan = { ...plan, steps: gated.steps, checks: gated.checks };
      const done = this.edit(id, l => {
        const outline = plan.outline.length >= plan.steps.length ? plan.outline : plan.steps.map(s => s.title);
        more = outline.length > plan.steps.length;
        const paid = gated.run ? { ...l, ...this.cost(l, r) } : l;
        return { ...l, ...this.cost(paid, gated.run ?? r), quality: gated.quality, title: plan.title || l.title, diagram: plan.diagram, outline, steps: plan.steps, checks: plan.checks, ...(plan.subject && !l.subject ? { subject: plan.subject } : {}),
          ...(plan.explainQ ? { explain: { q: plan.explainQ } } : {}), state: more ? 'more' : 'ready', at: stepKey(plan.steps[0]!.id), error: undefined,
          prep: { ...(l.prep ?? { phases: {} }), phases: { ...l.prep?.phases, plan: 'done' } } };
      });
      log.info('learn', 'lesson plan ready', { data: { id, steps: plan.steps.length, planned: done?.outline.length, facts: facts.length, costUsd: r.costUsd } });
    } catch (e) {
      log.warn('learn', 'lesson preparation failed', { cause: errText(e), hint: 'Riprova from the lesson' });
      this.edit(id, l => ({ ...l, state: 'failed', error: errText(e).slice(0, 300) }));
    } finally { this.jobs.delete(id); this.waits.delete(id); this.d.store.sweep(id); }
    if (more) await this.rest(id);
    else if (this.d.store.get(id)?.state === 'ready') await this.makeCards(id);
  }

  /** The research and its verification (ADR 0188): the facts the lesson may stand on, or null when the lesson is gone.
   *  A research run that fails is said on the Preparing screen and the lesson goes on with what the other found. */
  private async research(id: string, req: LessonStart, m: Material, l0: Lesson): Promise<LessonFact[] | null> {
    const lang = this.d.lang();
    // the web run sees only the ask: a PR's says nothing a search could use, nor does a text's when the user wrote none
    const noWeb = req.kind === 'pr' ? 'pr' : req.kind === 'text' && req.ask === TEXT_ASK ? 'noask' : !this.d.webOk?.() ? 'off' : null;
    const web = !noWeb;
    const places = (() => { try { return this.d.places?.() ?? { brain: null, appSource: null }; } catch { return { brain: null, appSource: null }; } })();
    let guide: string | null = null;
    try { const text = this.d.guide?.(lang); if (text) { this.d.store.writeFile(id, GUIDE_FILE, text); guide = path.join(this.d.store.dir(id), GUIDE_FILE); } } catch (e) { log.warn('learn', 'app guide not written', { cause: errText(e) }); }
    const webDir = path.join(this.d.store.dir(id), WEB_DIR);
    if (web) fs.mkdirSync(webDir, { recursive: true });
    this.phase(id, { web: web ? 'now' : 'skip', files: 'now' }, {}, noWeb ? { web: noWeb } : {});
    const effort = this.effort(req);
    const material = Object.keys(m.files).map(f => path.join(this.d.store.dir(id), f));
    // the public topics of the files (ADR 0206) need the web on, not an ask: a PR's lesson gets them too
    const topicsOk = (() => { try { return !!this.d.webOk?.(); } catch { return false; } })();
    if (topicsOk) fs.mkdirSync(webDir, { recursive: true });
    const pf = this.run(req, { cwd: this.folder(l0), prompt: filesResearchPrompt(lang, req, m, { material, brain: places.brain, guide, appSource: places.appSource }, web, topicsOk), effort, round: 'impara-files', timeoutMs: 8 * MIN });
    // the topics' web search starts as soon as the files run ends, beside the verification of the rest
    const noRefs = { facts: [] as LessonFact[], dropped: 0 };
    const refsDone = topicsOk
      ? pf.then(r => this.refs(id, req, m, r, webDir)).catch(e => { log.warn('learn', 'topics research failed', { cause: errText(e) }); return noRefs; })
      : Promise.resolve(noRefs);
    const [rw, rf] = await Promise.all([
      web ? this.run(req, { cwd: webDir, prompt: webResearchPrompt(lang, req), effort, round: 'impara-web', timeoutMs: 8 * MIN, web: true }) : Promise.resolve(null),
      pf,
    ]);
    if (!this.d.store.get(id)) { await refsDone; return null; }
    const read = (r: TeachResult | null, webSide: boolean, start: number): { facts: LessonFact[]; v: unknown; error?: string } => {
      if (!r) return { facts: [], v: null };
      if (!r.ok) return { facts: [], v: null, error: r.error };
      try { const v = jsonIn(r.text); return { facts: parseFacts(v, webSide, start), v }; } catch (e) { return { facts: [], v: null, error: errText(e) }; }
    };
    const w = read(rw, true, 1), f = read(rf, false, w.facts.length + 1);
    // with the web on, the files run was told to cite files only: a fact without one is left out
    if (web) f.facts = f.facts.filter(x => x.from === 'file');
    let qs: ReturnType<typeof parseQuestions> = [];
    try { if (f.v) qs = parseQuestions(f.v); } catch { qs = []; }
    this.edit(id, l => {
      let next = l;
      for (const [r, teacher] of [[rw, false], [rf, true]] as const) if (r?.ok) next = { ...next, ...this.cost(next, r, teacher) };
      const p = next.prep ?? { phases: {} };
      const why = { ...p.why, ...(w.error ? { web: `failed: ${w.error}`.slice(0, 200) } : {}), ...(f.error ? { files: `failed: ${f.error}`.slice(0, 200) } : {}) };
      return { ...next, ...(qs.length ? { clarify: { qs } } : {}),
        prep: { ...p, web: w.facts.length, files: f.facts.length, phases: { ...p.phases, ...(web ? { web: w.error ? 'skip' : 'done' } : {}), files: f.error ? 'skip' : 'done', verify: 'now', ...(qs.length ? { ask: 'now' } : {}) }, ...(Object.keys(why).length ? { why } : {}) } };
    });
    log.info('learn', 'lesson research done', { data: { id, web: w.facts.length, files: f.facts.length, questions: qs.length, webError: w.error ?? null, filesError: f.error ?? null } });
    // the verification: the web side re-reads the pages, the files side re-reads the files (and checks the model's own
    // knowledge as well as it can); each run did not write what it checks. Nothing the files run wrote ever reaches a
    // run with the web, not even a fact it gave without a file: it may carry what it read (ADR 0188, Security)
    const all = [...w.facts, ...f.facts];
    const onWeb = w.facts;
    const onFiles = f.facts;
    const [vw, vf] = await Promise.all([
      onWeb.length ? this.run(req, { cwd: webDir, prompt: verifyPrompt(lang, onWeb, true), effort, round: 'impara-verify-web', timeoutMs: 6 * MIN, web: true }) : Promise.resolve(null),
      onFiles.length ? this.run(req, { cwd: this.folder(l0), prompt: verifyPrompt(lang, onFiles, false), effort, round: 'impara-verify-files', timeoutMs: 6 * MIN }) : Promise.resolve(null),
    ]);
    if (!this.d.store.get(id)) return null;
    let dropped = 0;
    const checked = (facts: LessonFact[], r: TeachResult | null): LessonFact[] => {
      if (!r?.ok) return facts;
      try { const out = applyVerdicts(facts, jsonIn(r.text)); dropped += out.dropped; return out.facts; } catch { return facts; }
    };
    const byId = new Map([...checked(onWeb, vw), ...checked(onFiles, vf)].map(x => [x.id, x]));
    const roots = [this.folder(l0), places.brain, places.appSource].filter((x): x is string => !!x);
    let facts = all.map(x => byId.get(x.id)).filter((x): x is LessonFact => !!x).map(x => (x.from === 'file' ? { ...x, ref: fullRef(x.ref, roots) } : x));
    const count = (c: LessonFact['check']) => facts.filter(x => x.check === c).length;
    const verifyError = [vw, vf].map(r => (r && !r.ok ? r.error : '')).filter(Boolean).join(' · ');
    this.edit(id, l => {
      let next = l;
      for (const [r, teacher] of [[vw, false], [vf, true]] as const) if (r?.ok) next = { ...next, ...this.cost(next, r, teacher) };
      const p = next.prep ?? { phases: {} };
      return { ...next, facts, prep: { ...p, ok: count('ok'), fixed: count('fixed'), unsure: count('unsure'), dropped,
        phases: { ...p.phases, verify: all.length ? 'done' : 'skip' }, ...(verifyError ? { why: { ...p.why, verify: `failed: ${verifyError}`.slice(0, 200) } } : {}) } };
    });
    log.info('learn', 'lesson facts verified', { data: { id, facts: facts.length, ok: count('ok'), fixed: count('fixed'), unsure: count('unsure'), dropped } });
    // the standards and references, when their search ends: numbered after every other fact, counted with them
    const refs = await refsDone;
    if (!this.d.store.get(id)) return null;
    if (refs.facts.length || refs.dropped) {
      const top = all.reduce((n, x) => Math.max(n, Number(x.id.slice(1)) || 0), 0);
      facts = [...facts, ...refs.facts.map((x, i) => ({ ...x, id: `f${top + i + 1}` }))];
      dropped += refs.dropped;
      this.edit(id, l => {
        const p = l.prep ?? { phases: {} };
        return { ...l, facts, prep: { ...p, ok: count('ok'), fixed: count('fixed'), unsure: count('unsure'), dropped } };
      });
    }
    return facts;
  }

  /** The public topics of the files (ADR 0206): the files run's answer names them, the app filters each query
   *  (shared/web-topics.ts), the user sees them for 5 seconds (not in «Modalità notte»), then a web run that sees only
   *  the ask and the queries left searches them and another web run verifies what it found. Its facts (ids from 1: the
   *  caller numbers them after the others), and how many the verification dropped. */
  private async refs(id: string, req: LessonStart, m: Material, rf: TeachResult, webDir: string): Promise<{ facts: LessonFact[]; dropped: number }> {
    const none = { facts: [] as LessonFact[], dropped: 0 };
    const skip = (why: string) => { this.phase(id, { refs: 'skip' }, {}, { refs: why }); return none; };
    if (!rf.ok || !this.d.store.get(id)) return none;
    let v: unknown;
    try { v = jsonIn(rf.text); } catch { return none; }
    const raw = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    // what the files run saw or wrote, without the queries themselves: a word met only there may be private
    const answer = JSON.stringify({ ...raw, topics: Array.isArray(raw.topics) ? raw.topics.map(t => (t && typeof t === 'object' ? { ...(t as object), q: undefined, query: undefined } : null)) : undefined });
    const priv = privateWords([m.text, answer, ...Object.keys(m.files), ...m.sources, req.text ?? '', req.prUrl ?? '', m.cwd ?? ''], req.ask);
    const { topics, dropped: filtered } = parseTopics(v, priv);
    log.info('learn', 'lesson topics', { data: { id, topics: topics.length, filtered } });
    if (!topics.length) return filtered ? skip('filtered') : none;
    const away = (() => { try { return !!this.d.away?.(); } catch { return false; } })();
    const set = (t: Partial<LessonTopics>) => this.edit(id, l => { const p = l.prep ?? { phases: {} }; return { ...l, prep: { ...p, topics: { ...(p.topics ?? { list: topics, state: 'wait' as const }), ...t } } }; });
    // the deadline on the real clock: the timer is real even when the app's clock is not (the demo's)
    this.phase(id, { refs: 'now' }, { topics: { list: topics, state: away ? 'go' : 'wait', ...(away ? {} : { at: Date.now() + TOPIC_WAIT_MS }), ...(filtered ? { dropped: filtered } : {}) } });
    if (!away) await this.topicWait(id);
    const l1 = this.d.store.get(id);
    if (!l1) return none;
    const list = l1.prep?.topics?.list ?? [];
    if (!list.length) { set({ state: 'skip', at: undefined }); return skip('dropped'); }
    set({ state: 'go', at: undefined });
    const lang = this.d.lang(), effort = this.effort(req);
    const r = await this.run(req, { cwd: webDir, prompt: topicsResearchPrompt(lang, req, list), effort, round: 'impara-refs', timeoutMs: 8 * MIN, web: true });
    if (!this.d.store.get(id)) return none;
    if (!r.ok) { set({ state: 'done' }); return skip(`failed: ${r.error}`.slice(0, 200)); }
    let found: LessonFact[];
    try { found = parseTopicFacts(jsonIn(r.text), list, 1); } catch (e) { set({ state: 'done' }); return skip(`failed: ${errText(e)}`.slice(0, 200)); }
    this.edit(id, l => ({ ...l, ...this.cost(l, r, false), prep: { ...(l.prep ?? { phases: {} }), refs: found.length } }));
    if (!found.length) { set({ state: 'done' }); this.phase(id, { refs: 'done' }); return none; }
    // the same web verification as the web research's: a run that did not write the facts re-reads each page
    const vr = await this.run(req, { cwd: webDir, prompt: verifyPrompt(lang, found, true), effort, round: 'impara-verify-refs', timeoutMs: 6 * MIN, web: true });
    if (!this.d.store.get(id)) return none;
    let out = { facts: found, dropped: 0 };
    if (vr.ok) { try { out = applyVerdicts(found, jsonIn(vr.text)); } catch { /* not checked: kept as unsure */ } }
    this.edit(id, l => ({ ...l, ...(vr.ok ? this.cost(l, vr, false) : {}),
      prep: { ...(l.prep ?? { phases: {} }), phases: { ...l.prep?.phases, refs: 'done' }, topics: { ...(l.prep?.topics ?? { list }), state: 'done' } } }));
    log.info('learn', 'lesson references verified', { data: { id, facts: out.facts.length, dropped: out.dropped } });
    return out;
  }

  /** Waits for the user on the proposed topics: until the deadline, «Cerca ora», none left, or the lesson removed. */
  private topicWait(id: string): Promise<void> {
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const w = {
        wake: () => { clearTimeout(timer); if (this.topicWaits.get(id) === w) this.topicWaits.delete(id); resolve(); },
        arm: (ms: number) => { clearTimeout(timer); timer = setTimeout(w.wake, ms); timer.unref?.(); },
      };
      this.topicWaits.set(id, w);
      w.arm(TOPIC_WAIT_MS);
    });
  }

  /** The user on the proposed topics (ADR 0206): ✕ drops one (the others wait 5 more seconds; none left = no search),
   *  «Cerca ora» starts them now. */
  topics(id: string, act: { drop?: unknown; go?: unknown }): Lesson {
    const l = this.must(id);
    const tp = l.prep?.topics;
    const w = this.topicWaits.get(l.id);
    if (l.state !== 'preparing' || tp?.state !== 'wait' || !w) throw new Error('Nessuna ricerca in attesa.');
    if (act?.go) { w.wake(); return this.d.store.get(l.id) ?? l; }
    const drop = String(act?.drop ?? '');
    if (!tp.list.some(t => t.id === drop)) throw new Error('Argomento non trovato.');
    const list = tp.list.filter(t => t.id !== drop);
    const next = this.edit(l.id, x => ({ ...x, prep: { ...(x.prep ?? { phases: {} }), topics: { ...tp, list, ...(list.length ? { at: Date.now() + TOPIC_WAIT_MS } : {}) } } }))!;
    if (list.length) w.arm(TOPIC_WAIT_MS);
    else w.wake();
    return next;
  }

  /** The user's answers to the questions before the lesson ('' = skipped; none = all skipped): the plan starts. */
  clarify(id: string, answers: unknown): Lesson {
    const l = this.must(id);
    if (l.state !== 'preparing' || !l.clarify || l.clarify.answers) throw new Error('Nessuna domanda in attesa.');
    const list = Array.isArray(answers) ? answers : [];
    const got = l.clarify.qs.map((_, i) => String(list[i] ?? '').trim().slice(0, 300));
    const next = this.edit(l.id, x => ({ ...x, clarify: { ...x.clarify!, answers: got } }))!;
    const wake = this.waits.get(l.id);
    this.waits.delete(l.id);
    wake?.();
    return next;
  }

  private async rest(id: string): Promise<void> {
    const l0 = this.d.store.get(id), req = this.request(id);
    if (!l0 || !req || this.jobs.has(id)) return;
    this.jobs.add(id);
    try {
      const r = await this.run(req, { cwd: this.folder(l0), prompt: restPrompt(this.d.lang(), l0, req, this.material(id), this.d.store.dir(id)), effort: this.effort(req), round: 'impara-rest', timeoutMs: 10 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, error: `Il resto della lezione non è arrivato: ${r.error}`.slice(0, 300) })); return; }
      let part: ReturnType<typeof parsePlan>;
      try { part = parsePlan(jsonIn(r.text), { now: this.now(), base: l0.diagram, facts: (l0.facts ?? []).map(f => f.id) }); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), error: `Il resto della lezione non era valido (${errText(e)}).`.slice(0, 300) })); return; }
      const gated = await this.gate(req, l0, part.steps, part.checks);
      if (!this.d.store.get(id)) return;
      part = { ...part, steps: gated.steps, checks: gated.checks };
      this.edit(id, l => ({ ...l, ...this.cost(gated.run ? { ...l, ...this.cost(l, gated.run) } : l, r), quality: mergeQuality(l.quality, gated.quality), steps: [...l.steps, ...part.steps], checks: [...l.checks, ...part.checks],
        outline: [...l.outline.slice(0, l.steps.filter(s => !s.extra).length), ...part.steps.map(s => s.title)], state: 'ready', error: undefined }));
      log.info('learn', 'lesson complete', { data: { id, steps: part.steps.length, costUsd: r.costUsd } });
    } catch (e) {
      this.edit(id, l => ({ ...l, error: errText(e).slice(0, 300) }));
    } finally { this.jobs.delete(id); this.d.store.sweep(id); }
    if (this.d.store.get(id)?.state === 'ready') await this.makeCards(id);
  }

  /** The quality gate (ADR 0205): what the app sees alone (pieceIssues, checkIssues), then one cheap run that scores the
   *  draft on the checklist and rewrites only what fails. A rewrite is kept when it parses and fails no more of the
   *  app's own checks than the draft did; no second round. A gate that does not answer keeps the draft as it is. */
  private async gate(req: Pick<LessonStart, 'teacher'>, l: Lesson, steps: LessonStep[], checks: LessonCheck[]): Promise<{ steps: LessonStep[]; checks: LessonCheck[]; quality: LessonQuality; run?: Extract<TeachResult, { ok: true }> }> {
    const factIds = (l.facts ?? []).map(f => f.id);
    const hasFacts = (l.facts ?? []).some(f => f.check !== 'unsure');
    const found: Record<string, QualityRule[]> = {};
    steps.forEach((s, i) => { found[`s${i + 1}`] = pieceIssues(s, hasFacts); });
    checks.forEach((c, i) => { found[`c${i + 1}`] = checkIssues(c); });
    const fails: Partial<Record<QualityRule, number>> = {};
    const count = (rules: readonly QualityRule[]) => { for (const r of new Set(rules)) fails[r] = (fails[r] ?? 0) + 1; };
    const base = { checked: steps.length + checks.length, at: this.now() };
    const r = await this.run(req, { cwd: this.folder(l), prompt: gatePrompt(this.d.lang(), l, steps, checks, found), effort: 'low', round: 'impara-quality', timeoutMs: 4 * MIN });
    let verdict: ReturnType<typeof parseGate> | null = null;
    if (r.ok) { try { verdict = parseGate(jsonIn(r.text)); } catch { verdict = null; } }
    if (!r.ok || !verdict) {
      Object.values(found).forEach(count);
      log.warn('learn', 'quality gate did not answer: draft kept', { data: { id: l.id, error: r.ok ? 'not valid' : r.error } });
      return { steps, checks, quality: { ...base, fixed: 0, fails, none: true }, ...(r.ok ? { run: r } : {}) };
    }
    const nodes = diagramNodes(l.diagram);
    let fixed = 0;
    const outSteps = steps.map((s, i) => {
      const v = verdict!.pieces.find(x => x.n === i + 1), own = found[`s${i + 1}`]!;
      count([...own, ...(v?.fails ?? [])]);
      if (!v?.fails.length && !own.length) return s;
      if (!v?.fix) return s;
      try {
        const next = parseStep(v.fix, nodes, s.id, factIds);
        if (pieceIssues(next, hasFacts).length > own.length) return s;
        fixed++;
        return { ...next, ...(s.role && !next.role ? { role: s.role } : {}) };
      } catch { return s; }
    });
    const outChecks = checks.map((c, i) => {
      const v = verdict!.checks.find(x => x.n === i + 1), own = found[`c${i + 1}`]!;
      count([...own, ...(v?.fails ?? [])]);
      if ((!v?.fails.length && !own.length) || !v?.fix) return c;
      try {
        const next = parseCheck(v.fix, c.after, c.id);
        if (checkIssues(next).length > own.length) return c;
        fixed++;
        return next;
      } catch { return c; }
    });
    log.info('learn', 'quality gate done', { data: { id: l.id, checked: base.checked, fixed, fails, costUsd: r.costUsd } });
    return { steps: outSteps, checks: outChecks, quality: { ...base, fixed, fails }, run: r };
  }

  /** The review cards of a finished lesson (ADR 0189): one short run over its verified facts; a card that cites none,
   *  or names a node the diagram lacks, is left out. A lesson with no verified fact (made before ADR 0188, or a
   *  research that found nothing) keeps only its checks as cards. */
  private async makeCards(id: string): Promise<void> {
    const l0 = this.d.store.get(id);
    const verified = (l0?.facts ?? []).filter(f => f.check !== 'unsure').map(f => f.id);
    if (!l0 || l0.state !== 'ready' || !verified.length || l0.cards?.state === 'making' || l0.cards?.state === 'done' || this.cardJobs.has(id)) return;
    this.cardJobs.add(id);
    try {
      this.edit(id, l => ({ ...l, cards: { state: 'making' } }));
      const r = await this.run(this.teacherReq(l0), { cwd: this.folder(l0), prompt: cardsPrompt(this.d.lang(), l0), effort: 'medium', round: 'impara-cards', timeoutMs: 4 * MIN });
      if (!this.d.store.get(id)) return;
      if (!r.ok) { this.edit(id, l => ({ ...l, cards: { state: 'failed', error: r.error.slice(0, 300) } })); return; }
      let drafts: ReturnType<typeof parseCards>;
      try { drafts = parseCards(jsonIn(r.text), diagramNodes(l0.diagram), verified); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), cards: { state: 'failed', error: errText(e).slice(0, 300) } })); return; }
      const l1 = this.d.store.get(id);
      if (!l1) return;
      this.review.add(id, subjectOf(l1), drafts, this.now());
      this.edit(id, l => ({ ...l, ...this.cost(l, r), cards: { state: 'done', n: drafts.length } }));
      log.info('learn', 'review cards written', { data: { id, cards: drafts.length, costUsd: r.costUsd } });
    } catch (e) {
      this.edit(id, l => ({ ...l, cards: { state: 'failed', error: errText(e).slice(0, 300) } }));
    } finally { this.cardJobs.delete(id); this.d.store.sweep(id); }
  }

  /** A review session's cards (ADR 0189): «Ripassa» = the due ones and a few new; a subject's quiz = its cards, mixed. */
  queue(mode: unknown, subject?: string, lesson?: string): ReviewItem[] {
    const m: ReviewMode = mode === 'quiz' ? 'quiz' : 'due';
    // a lesson's «Studio» quiz (ADR 0205): its questions in order, the ones answered before with their memory
    const quizOf = lesson ? this.d.store.get(String(lesson)) : null;
    const cards = quizOf ? this.studioQuiz(quizOf) : queueOf(this.askable(), m, this.now(), subject ? { subject: subjectName(subject) } : {});
    const lessons = new Map<string, Lesson | null>();
    const lessonOf = (id: string) => { if (!lessons.has(id)) lessons.set(id, this.d.store.get(id)); return lessons.get(id)!; };
    return cards.flatMap((card): ReviewItem[] => {
      const l = lessonOf(card.lessonId);
      if (!l) return [];
      const facts = (card.cites ?? []).map(id => l.facts?.find(f => f.id === id)).filter((f): f is LessonFact => !!f).map(f => ({ id: f.id, claim: f.claim, ref: f.ref, from: f.from }));
      return [{ card, lesson: l.title, ...(card.kind === 'node' ? { diagram: l.diagram } : {}), facts }];
    });
  }

  /** A card's grade: its next review (FSRS). */
  gradeCard(cardId: string, grade: number): ReviewCard {
    if (!(REVIEW_GRADES as readonly number[]).includes(grade)) throw new Error('Voto non valido.');
    // a «Studio» quiz question answered for the first time becomes a review card (ADR 0205)
    if (!this.review.get(cardId)) {
      const m = /^(.+):sq(\d+)$/.exec(String(cardId));
      const l = m ? this.d.store.get(m[1]!) : null;
      const q = l ? this.studioQuiz(l).find(c => c.id === cardId) : null;
      if (l && q) { const { id: _id, lessonId: _l, subject: _s, createdAt: _c, mem: _m, origin: _o, ...draft } = q; this.review.addOne(l.id, subjectOf(l), draft, `sq${m![2]}`, 'studio', this.now()); }
    }
    const card = this.review.grade(cardId, grade as ReviewGrade, this.now());
    this.emit();
    return card;
  }

  /** A lesson's «Studio» quiz as review cards, in order: `<lesson>:sq<n>`, with the memory of the ones answered before. */
  private studioQuiz(l: Lesson): ReviewCard[] {
    const out = l.studio?.quiz?.out;
    if (out?.kind !== 'quiz') return [];
    const at = l.studio?.quiz?.at ?? l.createdAt;
    return out.qs.map((d, i): ReviewCard => this.review.get(`${l.id}:sq${i + 1}`) ?? { ...d, id: `${l.id}:sq${i + 1}`, lessonId: l.id, subject: subjectOf(l), origin: 'studio', createdAt: at, mem: null });
  }

  /** A «Studio» tile (ADR 0205): one short run over the lesson's verified facts only (no new research); the output is
   *  saved with the lesson (a new one replaces it when it arrives). Flashcards go into the review. */
  studio(id: string, kind: unknown): Lesson {
    const l = this.must(id);
    if (!isStudioMade(kind)) throw new Error('Richiesta non valida.');
    if (l.state === 'preparing' || l.state === 'failed' || !l.diagram) throw new Error('La lezione non è ancora pronta.');
    if (!(l.facts ?? []).some(f => f.check !== 'unsure')) throw new Error('Lo Studio lavora solo sui fatti verificati, e questa lezione non ne ha.');
    const key = `${l.id}/${kind}`;
    if (this.studioJobs.has(key)) throw new Error('Lo sto già preparando.');
    const why = this.d.cannotTeach();
    if (why) throw new Error(why);
    const next = this.edit(l.id, x => ({ ...x, studio: { ...x.studio, [kind]: { ...x.studio?.[kind], state: 'making', at: this.now(), error: undefined } } }))!;
    void this.makeStudio(l.id, kind);
    return next;
  }

  private async makeStudio(id: string, kind: StudioMade): Promise<void> {
    const l0 = this.d.store.get(id);
    if (!l0) return;
    const key = `${id}/${kind}`;
    this.studioJobs.add(key);
    const set = (patch: Partial<NonNullable<Lesson['studio']>[StudioMade]>, r?: Extract<TeachResult, { ok: true }>) =>
      this.edit(id, l => ({ ...l, ...(r ? this.cost(l, r) : {}), studio: { ...l.studio, [kind]: { ...l.studio?.[kind], at: this.now(), ...patch } } }));
    try {
      const verified = (l0.facts ?? []).filter(f => f.check !== 'unsure').map(f => f.id);
      const r = await this.run(this.teacherReq(l0), { cwd: this.folder(l0), prompt: studioPrompt(this.d.lang(), kind, l0), effort: 'low', round: 'impara-studio', timeoutMs: 4 * MIN });
      if (!this.d.store.get(id)) return;
      if (!r.ok) { set({ state: 'failed', error: r.error.slice(0, 300) }); return; }
      let got: ReturnType<typeof parseStudio>;
      try { got = parseStudio(kind, jsonIn(r.text), verified, diagramNodes(l0.diagram)); }
      catch (e) { set({ state: 'failed', error: errText(e).slice(0, 300) }, r); return; }
      if (got.cards) this.review.replaceOwn(id, subjectOf(this.d.store.get(id) ?? l0), 's:f', got.cards, 'studio', this.now());
      set({ state: 'done', out: got.out, error: undefined }, r);
      log.info('learn', 'studio ready', { data: { id, kind, costUsd: r.costUsd } });
    } catch (e) {
      set({ state: 'failed', error: errText(e).slice(0, 300) });
    } finally { this.studioJobs.delete(key); this.d.store.sweep(id); }
  }

  /** The user moves a lesson (and its cards) to another subject. */
  setSubject(id: string, raw: unknown): Lesson {
    const l = this.must(id);
    const subject = subjectName(raw);
    if (!subject) throw new Error('Scrivi il nome della materia.');
    this.review.setSubject(l.id, subject);
    return this.edit(l.id, x => ({ ...x, subject }))!;
  }

  /** The teacher of a lesson's follow-ups: the one it was made with. */
  private teacherReq(l: Pick<Lesson, 'teacher'>): Pick<LessonStart, 'teacher'> { return l.teacher ? { teacher: l.teacher } : {}; }

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
    const next = this.edit(l.id, x => ({ ...x, error: undefined, busyError: undefined, ...(x.busy && !this.extras.has(x.id) ? { busy: undefined } : {}), ...(x.cards?.state === 'failed' ? { cards: undefined } : {}) }))!;
    if (l.state === 'more' && !this.jobs.has(l.id)) void this.rest(l.id);
    // a failed cards run, or a lesson finished before cards existed (ADR 0189): «Crea le carte»
    else if (l.state === 'ready' && (l.cards?.state === 'failed' || !l.cards)) void this.makeCards(l.id);
    return next;
  }

  /** Where the user is now (the rail, Avanti, Indietro): any key of the play-list. */
  move(id: string, at: string): Lesson {
    const l = this.must(id);
    if (!playlist(l).some(p => p.key === at)) throw new Error('Pezzo non trovato.');
    return this.edit(l.id, x => ({ ...x, at }))!;
  }

  /** A check answered (zero tokens: its right answer came with it). The first answer stays; a later call only adds the
   *  «Eri sicuro?» (then `choice` is not looked at; without one it must still be valid). Order and match (ADR 0204) take a list (shared/quiz.ts). */
  answer(id: string, checkId: string, choice: unknown, confidence?: LessonConfidence): Lesson {
    const l = this.must(id);
    const c = l.checks.find(x => x.id === checkId);
    if (!c) throw new Error('Domanda non trovata.');
    const conf = confidence === 0 || confidence === 1 || confidence === 2 ? confidence : undefined;
    if (!(c.answer && conf !== undefined) && !quizValid(c, choice)) throw new Error('Risposta non valida.');
    return this.edit(l.id, x => ({ ...x, checks: x.checks.map(k => k.id !== checkId ? k
      : k.answer ? (conf !== undefined && k.answer.confidence === undefined ? { ...k, answer: { ...k.answer, confidence: conf } } : k)
      : { ...k, answer: { choice: storedChoice(k, choice as number | number[]), ...(Array.isArray(choice) ? { seq: [...choice] } : {}), ...(conf !== undefined ? { confidence: conf } : {}), at: this.now() } }) }))!;
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
      const r = await this.run(this.teacherReq(l0), { cwd: this.folder(l0), prompt: extraPrompt(this.d.lang(), l0, piece, kind, ask, this.material(id), this.d.store.dir(id)), effort: 'low', round: 'impara-extra', timeoutMs: 3 * MIN });
      if (!r.ok) { this.edit(id, l => ({ ...l, busy: undefined, busyError: `Non è arrivata: ${r.error}`.slice(0, 300) })); return; }
      let got: ReturnType<typeof parseExtra>;
      try { got = parseExtra(jsonIn(r.text), diagramNodes(l0.diagram), piece.id, kind, ask, this.now(), (l0.facts ?? []).map(f => f.id)); }
      catch (e) { this.edit(id, l => ({ ...l, ...this.cost(l, r), busy: undefined, busyError: `La risposta non era valida (${errText(e)}).`.slice(0, 300) })); return; }
      this.edit(id, l => ({ ...l, ...this.cost(l, r), steps: [...l.steps, got.step], checks: got.check ? [...l.checks, { ...got.check, after: got.step.id }] : l.checks,
        busy: undefined, at: stepKey(got.step.id) }));
      log.info('learn', 'extra piece ready', { data: { id, kind, costUsd: r.costUsd } });
    } catch (e) {
      this.edit(id, l => ({ ...l, busy: undefined, busyError: errText(e).slice(0, 300) }));
    } finally { this.extras.delete(id); this.d.store.sweep(id); }
  }

  /** The tutor's session, started while the learner opens the tutor or types (ADR 0190): the engine starts now (its
   *  start is most of the wait) and gets the question when it comes; unused for a few minutes, it closes, having sent
   *  nothing and cost nothing. One per lesson. */
  tutorWarm(id: string): void {
    const l = this.d.store.get(String(id));
    if (!l || l.state === 'preparing' || l.state === 'failed' || this.warm.has(l.id) || this.tutoring.has(l.id) || this.d.cannotTeach()) return;
    let give!: (p: string | null) => void;
    const prompt = new Promise<string | null>(r => { give = r; });
    const timer = setTimeout(() => { if (this.warm.get(l.id) === w) this.warm.delete(l.id); give(null); }, WARM_MS);
    timer.unref?.();
    const w: Warm = { give: p => { clearTimeout(timer); give(p); }, listen: null, result: Promise.resolve({ ok: false, error: '' }) };
    w.result = this.run(this.teacherReq(l), { cwd: this.folder(l), prompt, effort: 'low', round: 'impara-tutor', timeoutMs: WARM_MS + 3 * MIN, onText: t => w.listen?.(t) });
    this.warm.set(l.id, w);
  }

  /** A question to the tutor (ADR 0190), typed, spoken or from a node of the board: answered beside the lesson, word
   *  by word; coach (the default) lets the learner try first, tell («Dimmelo e basta») answers at once. One at a time. */
  tutor(id: string, at: string, question: string, mode: TutorMode = 'coach'): Lesson {
    const l = this.must(id);
    if (l.state === 'preparing' || l.state === 'failed' || !l.diagram) throw new Error('La lezione non è ancora pronta.');
    if (this.tutoring.has(l.id) || l.tutor?.some(x => x.state === 'asking')) throw new Error('Il tutor sta già rispondendo.');
    const q = String(question ?? '').replace(/\s+/g, ' ').trim().slice(0, TUTOR_Q_MAX);
    if (!q) throw new Error('Scrivi la domanda.');
    const why = this.d.cannotTeach();
    if (why) throw new Error(why);
    const key = String(at ?? '');
    const piece = key === 'end' ? null : this.pieceAt(l, key);
    const now = this.now();
    const turn: TutorTurn = { id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, q, at: key, mode: mode === 'tell' || mode === 'quiz' ? mode : 'coach', a: '', state: 'asking', createdAt: now };
    const next = this.edit(l.id, x => ({ ...x, tutor: [...(x.tutor ?? []), turn].slice(-TUTOR_KEEP) }))!;
    void this.answerTutor(l.id, turn, piece);
    return next;
  }

  private async answerTutor(id: string, turn: TutorTurn, piece: LessonStep | null): Promise<void> {
    this.tutoring.add(id);
    const set = (patch: Partial<TutorTurn>, r?: Extract<TeachResult, { ok: true }>) =>
      this.edit(id, l => ({ ...l, ...(r ? this.cost(l, r) : {}), tutor: (l.tutor ?? []).map(x => (x.id === turn.id ? { ...x, ...patch } : x)) }));
    try {
      const l = this.d.store.get(id);
      if (!l) return;
      const prompt = tutorPrompt(this.d.lang(), { ...l, tutor: (l.tutor ?? []).filter(x => x.id !== turn.id) }, piece, turn.q, turn.mode, this.folder(l));
      let heard = false;
      const listen = (t: string) => { heard = true; this.d.tutorText?.(id, turn.id, tutorShown(t, true)); };
      const cold = () => this.run(this.teacherReq(l), { cwd: this.folder(l), prompt, effort: 'low', round: 'impara-tutor', timeoutMs: 3 * MIN, onText: listen });
      const w = this.warm.get(id);
      this.warm.delete(id);
      let r: TeachResult;
      if (w) { w.listen = listen; w.give(prompt); r = await w.result; if (!r.ok && !heard) r = await cold(); } // a warm engine that died meanwhile: once more, cold
      else r = await cold();
      if (!this.d.store.get(id)) return;
      if (!r.ok) { set({ state: 'failed', error: r.error.slice(0, 300) }); return; }
      const a = tutorShown(r.text);
      if (!a) { set({ state: 'failed', error: 'nessuna risposta' }, r); return; }
      // a full explanation the verified facts support leaves a review card (cites checked as for every card)
      let card: string | undefined;
      const raw = turn.mode === 'quiz' ? null : tutorCard(r.text);
      if (raw && typeof raw === 'object') {
        const verified = (l.facts ?? []).filter(f => f.check !== 'unsure').map(f => f.id);
        const [draft] = parseCards({ cards: [{ ...(raw as object), kind: 'recall' }] }, [], verified);
        if (draft) { try { card = this.review.addOne(id, subjectOf(this.d.store.get(id) ?? l), draft, `t:${turn.id}`, 'tutor', this.now()).id; } catch (e) { log.warn('learn', 'tutor card not written', { cause: errText(e) }); } }
      }
      set({ a, state: 'done', ...(card ? { card } : {}) }, r);
      log.info('learn', 'tutor answered', { data: { id, mode: turn.mode, warm: !!w, card: !!card, costUsd: r.costUsd } });
    } catch (e) {
      set({ state: 'failed', error: errText(e).slice(0, 300) });
    } finally { this.tutoring.delete(id); this.d.store.sweep(id); }
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
      const r = await this.run(this.teacherReq(l0), { cwd: this.folder(l0), prompt: gradePrompt(this.d.lang(), l0, answer), effort: 'low', round: 'impara-grade', timeoutMs: 2 * MIN });
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
    // a lesson waiting for the user's answers: its preparation ends (nothing is written back to a removed lesson)
    const wake = this.waits.get(id);
    this.waits.delete(id);
    this.topicWaits.get(id)?.wake();
    // a run still working in the folder (Windows keeps it busy): the lesson is gone now, its folder when the run ends
    // the tutor's session started ahead ends unsent; its engine still has the folder until it exits
    const w = this.warm.get(id);
    w?.give(null);
    this.warm.delete(id);
    if (w) void w.result.finally(() => this.d.store.sweep(id));
    try { this.d.store.remove(String(id), !!w || this.jobs.has(id) || this.extras.has(id) || this.cardJobs.has(id) || this.tutoring.has(id) || [...this.studioJobs].some(k => k.startsWith(`${id}/`))); } finally { wake?.(); }
    try { this.review.removeLesson(String(id)); } catch (e) { log.warn('learn', 'review cards not removed', { cause: errText(e) }); }
    log.info('learn', 'lesson removed', { data: { id } });
    this.emit();
  }
}
