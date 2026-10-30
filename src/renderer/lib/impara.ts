// Impara in the renderer (ADR 0185): main's list and the open lesson (impara:changed keeps both current), the actions
// of the page and the player (each an impara:* call, a failure said in a toast), the user's choices that outlive a
// restart (voice of the app, «Rispondo a voce», depth, level, who explains, full screen: localStorage, a convenience
// only) and the colours a lit
// piece gets on the diagram, taken from the theme's tokens as hex (mermaid's classDef cannot take rgba).
// The tutor's answers as they stream (ADR 0190: 'impara:tutor', `tutorLive`), and the start form's draft when another
// page sends the user here to learn something («Capiscila», «Spiegamelo», «Imparalo»: `learnAbout`).
// The «Studio» column (ADR 0205): a tile's run (`makeStudio`), a lesson's quiz played as a review session
// (`studioQuizArg`), and which tab of the side column is open (`side`, remembered).
// Used by components/impara/, brain/components/RecordLearnButton.tsx, brain-model/ApprovedTab.tsx, GuidePage.tsx.
import type { StudioKind } from '@shared/lesson-studio';
import type { ImparaState, Lesson, LessonConfidence, LessonDepth, LessonExtraKind, LessonKind, LessonLevel, LessonStart, LessonTeacher, FocusColors, TutorMode } from '@shared/lesson';
import type { ReviewCard, ReviewGrade, ReviewItem, ReviewMode } from '@shared/review';
import { createStore } from '../store/createStore';
import { toast } from '../store/ui';
import { t } from '../i18n';

export interface ImparaUi { state: ImparaState | null; lessons: Record<string, Lesson> }
export const impara = createStore<ImparaUi>({ state: null, lessons: {} });

/** teacher null = the app's choice (Claude's strongest model, high effort); full = the lesson fills the window (the
 *  owner, 2026-10-29: «di base a tutto schermo»); coach = the tutor's «Prima provo io» (ADR 0190) */
export interface ImparaPrefs { voice: boolean; mic: boolean; depth: LessonDepth; level: LessonLevel; teacher: LessonTeacher | null; full: boolean; coach: boolean; side: ImparaSide }
/** the column beside the lesson (ADR 0205): the tutor, the «Studio» tiles, or closed */
export type ImparaSide = 'tutor' | 'studio' | null;
const PREFS_KEY = 'sb.impara.v1';
const DEFAULT_PREFS: ImparaPrefs = { voice: true, mic: false, depth: 'lesson', level: 'basics', teacher: null, full: true, coach: true, side: 'studio' };
const teacherIn = (v: unknown): LessonTeacher | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return typeof o.engine === 'string' ? { engine: o.engine, model: typeof o.model === 'string' ? o.model : null, effort: typeof o.effort === 'string' ? o.effort as LessonTeacher['effort'] : null } : null;
};
function readPrefs(): ImparaPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ImparaPrefs> | null;
    if (!p) return DEFAULT_PREFS;
    return {
      voice: typeof p.voice === 'boolean' ? p.voice : DEFAULT_PREFS.voice, mic: typeof p.mic === 'boolean' ? p.mic : DEFAULT_PREFS.mic,
      depth: p.depth === 'quick' || p.depth === 'deep' ? p.depth : 'lesson', level: p.level === 'new' || p.level === 'expert' ? p.level : 'basics',
      teacher: teacherIn(p.teacher), full: typeof p.full === 'boolean' ? p.full : DEFAULT_PREFS.full, coach: typeof p.coach === 'boolean' ? p.coach : DEFAULT_PREFS.coach,
      side: p.side === 'tutor' || p.side === 'studio' || p.side === null ? p.side : DEFAULT_PREFS.side,
    };
  } catch { return DEFAULT_PREFS; }
}
export const imparaPrefs = createStore<ImparaPrefs>(readPrefs());
export function setImparaPrefs(patch: Partial<ImparaPrefs>): void {
  imparaPrefs.set(s => ({ ...s, ...patch }));
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(imparaPrefs.get())); } catch { /* storage off: kept for this session */ }
}

/** a move not yet confirmed by main, per lesson: a change that left main before it (the rest, an extra, the reply to
 *  an earlier move) must not jump the user back */
const moving = new Map<string, { at: string; n: number }>();
let moveN = 0;
const mine = (l: Lesson): Lesson => { const m = moving.get(l.id); return m ? { ...l, at: m.at } : l; };
const put = (l: Lesson) => impara.set(s => ({ ...s, lessons: { ...s.lessons, [l.id]: mine(l) } }));

let wired = false;
/** main's list, once (the page mounts it). */
export function startImpara(): void {
  if (wired || typeof window === 'undefined' || !window.sb) return;
  wired = true;
  window.sb.on('impara:changed', ({ state, lesson }) => impara.set(s => ({ state, lessons: lesson ? { ...s.lessons, [lesson.id]: mine(lesson) } : s.lessons })));
  window.sb.on('impara:tutor', ({ turn, text }) => tutorLive.set(s => ({ ...s, [turn]: text })));
  void window.sb.invoke('impara:state', undefined).then(state => impara.set(s => ({ ...s, state: s.state ?? state })), () => {});
}

export const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const fail = (e: unknown) => { toast(errText(e), 'err'); return null; };

/** The whole lesson, read once when it opens (then impara:changed keeps it). */
export async function loadLesson(id: string): Promise<Lesson | null> {
  const l = await window.sb.invoke('impara:get', { id }).catch(fail);
  if (l) put(l);
  return l;
}
const call = async (p: Promise<Lesson>): Promise<Lesson | null> => { try { const l = await p; put(l); return l; } catch (e) { return fail(e); } };

export const startLesson = (req: LessonStart) => call(window.sb.invoke('impara:start', req));
/** Where the user is: shown at once (the file is written behind), so «Avanti» never waits for the disk. */
export function moveTo(id: string, at: string): Promise<Lesson | null> {
  const l = impara.get().lessons[id], n = ++moveN;
  moving.set(id, { at, n });
  if (l) put({ ...l, at });
  const done = () => { if (moving.get(id)?.n === n) moving.delete(id); };
  return window.sb.invoke('impara:move', { id, at }).then(x => { done(); put(x); return x; }, e => { done(); return fail(e); });
}
export const askExtra = (id: string, kind: LessonExtraKind, at: string, text?: string) => call(window.sb.invoke('impara:ask', { id, kind, at, ...(text ? { text } : {}) }));
export const answerCheck = (id: string, checkId: string, choice: number, confidence?: LessonConfidence) =>
  call(window.sb.invoke('impara:answer', { id, checkId, choice, ...(confidence !== undefined ? { confidence } : {}) }));
export const explainBack = (id: string, text: string) => call(window.sb.invoke('impara:explain', { id, text }));
export const retryLesson = (id: string) => call(window.sb.invoke('impara:retry', { id }));
/** The answers to the questions before the lesson ('' = skipped). */
export const clarifyLesson = (id: string, answers: string[]) => call(window.sb.invoke('impara:clarify', { id, answers }));
/** The review (ADR 0189): a session's cards, a card's grade, a lesson moved to another subject. */
export const reviewQueue = (mode: ReviewMode, subject?: string, lesson?: string): Promise<ReviewItem[] | null> =>
  window.sb.invoke('impara:queue', { mode, ...(subject ? { subject } : {}), ...(lesson ? { lesson } : {}) }).catch(fail);
export const gradeCard = (card: string, grade: ReviewGrade): Promise<ReviewCard | null> => window.sb.invoke('impara:grade', { card, grade }).catch(fail);
export const setLessonSubject = (id: string, subject: string) => call(window.sb.invoke('impara:subject', { id, subject }));
/** The page argument of a review session: today's, or one subject's quiz. */
export const reviewArg = (subject?: string): string => (subject ? `ripasso:${encodeURIComponent(subject)}` : 'ripasso');
export function readReviewArg(arg: string | null | undefined): { subject?: string; lesson?: string } | null {
  if (arg === 'ripasso') return {};
  if (arg?.startsWith('quiz:') && arg.length > 5) return { lesson: arg.slice(5) };
  if (!arg?.startsWith('ripasso:')) return null;
  try { return { subject: decodeURIComponent(arg.slice(8)) }; } catch { return null; }
}

/** A «Studio» tile (ADR 0205): its run starts, the lesson shows it being made, then the output. */
export const makeStudio = (id: string, kind: StudioKind) => call(window.sb.invoke('impara:studio', { id, kind }));
/** The page argument of a lesson's «Studio» quiz, played as a review session. */
export const studioQuizArg = (lessonId: string): string => `quiz:${lessonId}`;

export async function removeLesson(id: string): Promise<boolean> {
  try { await window.sb.invoke('impara:remove', { id }); impara.set(s => { const { [id]: _gone, ...rest } = s.lessons; return { ...s, lessons: rest }; }); toast(t('impara.removed'), 'ok'); return true; }
  catch (e) { fail(e); return false; }
}

// ── the diagram's colours ──
const css = (name: string, fb: string): string => (typeof document === 'undefined' ? fb : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
/** Any CSS colour as [r, g, b] (a 1×1 canvas reads it back), else the fallback's. */
function rgb(color: string, fb: [number, number, number]): [number, number, number] {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d');
    if (!g) return fb;
    g.fillStyle = '#000'; g.fillStyle = color; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  } catch { return fb; }
}
const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The three states of the nodes, from the current theme: lit (accent), seen (calm), still to come (dimmed). */
export function focusColors(): FocusColors {
  const blue = rgb(css('--blue', '#a59bff'), [165, 155, 255]), green = rgb(css('--green', '#4fd18b'), [79, 209, 139]);
  const s2 = rgb(css('--surface-2', '#1e2026'), [30, 32, 38]), s3 = rgb(css('--surface-3', '#272930'), [39, 41, 48]);
  const text = rgb(css('--text', '#eceef3'), [236, 238, 243]), text2 = rgb(css('--text-2', '#b9bfcb'), [185, 191, 203]), text4 = rgb(css('--text-4', '#7b8293'), [123, 130, 147]);
  const border = rgb(css('--border-2', '#2a2f3a'), [42, 47, 58]);
  return {
    now: { fill: hex(mix(s3, blue, 0.26)), stroke: hex(blue), text: hex(text) },
    done: { fill: hex(mix(s3, green, 0.1)), stroke: hex(mix(border, green, 0.55)), text: hex(text2) },
    dim: { fill: hex(s2), stroke: hex(border), text: hex(mix(text4, s2, 0.25)) },
  };
}

// ── the tutor (ADR 0190) ───────────────────────────────────────────────────────────────────────────────────────────

/** a tutor answer so far, by turn id, while it streams (the lesson has the whole answer once it ends) */
export const tutorLive = createStore<Record<string, string>>({});
export const askTutor = (id: string, at: string, q: string, mode: TutorMode = 'coach') => call(window.sb.invoke('impara:tutor', { id, at, q, mode }));
const warmed = new Map<string, number>();
/** Starts the tutor's engine ahead (opening the tutor, typing): at most every few seconds per lesson (keystrokes); main
 *  keeps one and starts another once the last one answered. */
export function warmTutor(id: string): void {
  const now = Date.now();
  if (now - (warmed.get(id) ?? 0) < 5_000) return;
  warmed.set(id, now);
  void window.sb.invoke('impara:tutorWarm', { id }).catch(() => {});
}

// ── learning from another page (ADR 0190) ──────────────────────────────────────────────────────────────────────────

/** What the start form opens with when another page sends the user to learn something; null = nothing waiting. */
export interface ImparaDraft { kind: LessonKind; ask: string; prUrl?: string; text?: string; subject?: string; from: string }
export const imparaDraft = createStore<ImparaDraft | null>(null);
/** «Capiscila», «Spiegamelo», «Imparalo»: Impara's start opens filled in (who explains and how deep stay the user's);
 *  the user starts it with one click, so nothing is spent without them. */
export function learnAbout(d: ImparaDraft): void {
  imparaDraft.set(() => d);
  // actions.ts imports half the renderer (this file among them): loaded on use, never at start
  void import('../actions').then(a => a.go({ page: 'impara' }));
}
