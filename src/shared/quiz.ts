// The question types of Impara's quizzes (ADR 0204; owner, 2026-10-30, report «Impara v3» I5: «più tipi … scelta,
// vero/falso con il perché, metti in ordine i passi, completa il codice, abbina le coppie»): one shape for a lesson's
// check (shared/lesson.ts LessonCheck) and a review card (shared/review.ts ReviewCard), the parser that checks and caps
// what the model wrote, whether a response is right, and the stable shuffle a question shows its steps or pairs in.
// The click on the diagram stays a review card of its own (kind 'node'). Every kind keeps `options` + `correct`, so a
// stored answer is right exactly when `answer.choice === correct` (order and match store `correct` when right, -1 when
// not): the lessons saved before keep working unchanged. Shared by main (learn/service.ts, review-store.ts) and the
// renderer (components/impara/ImparaQuiz.tsx); tests: test/unit/quiz.test.ts.

export type QuizKind = 'choice' | 'predict' | 'truefalse' | 'cloze' | 'order' | 'match';
export const QUIZ_KINDS: readonly QuizKind[] = ['choice', 'predict', 'truefalse', 'cloze', 'order', 'match'];
/** kinds answered by picking one option (keys 1-4 / A-D) */
export const PICK_KINDS: readonly QuizKind[] = ['choice', 'predict', 'truefalse', 'cloze'];
export const isPick = (k: string): boolean => (PICK_KINDS as readonly string[]).includes(k);

/** The blank a cloze's code shows where the answer goes. */
export const BLANK = '___';

/** The body of a question, as a check and a card both carry it. */
export interface QuizBody {
  kind: QuizKind;
  q: string;
  /** pick kinds: 2-4 options (truefalse: true first, then false); order and match: none */
  options: string[];
  /** pick kinds: the right option; order and match: 0 */
  correct: number;
  /** order: the steps in the right order; match: the left side of each pair */
  items?: string[];
  /** match: the right side, pairs[i] goes with items[i] */
  pairs?: string[];
  /** cloze: a few lines of real code with one BLANK */
  code?: string;
}

/** A response: an option's index (pick kinds), or a list: order = the items' indices in the order given; match = for
 *  each left item, the index of the right side the user paired with it. */
export type QuizResponse = number | number[];

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strs = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map(x => str(x, max)) : []);

/** The question the model wrote, checked: throws a short Italian sentence when it cannot be asked as written. An empty
 *  or repeated option drops the question (dropping only the option would move `correct` onto another one). */
export function parseQuiz(v: unknown, opts: { qMax?: number; optionMax?: number; trueFalse?: readonly [string, string] } = {}): QuizBody {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('domanda: atteso un oggetto');
  const o = v as Record<string, unknown>;
  const q = str(o.q, opts.qMax ?? 320);
  if (!q) throw new Error('domanda: manca il testo');
  const max = opts.optionMax ?? 220;
  const kind: QuizKind = (QUIZ_KINDS as readonly string[]).includes(String(o.kind)) ? o.kind as QuizKind : 'choice';
  if (kind === 'order') {
    const items = strs(o.items, 160);
    if (items.length < 3 || items.length > 6 || items.some(x => !x) || new Set(items).size !== items.length) throw new Error('ordine: servono da 3 a 6 passi diversi');
    return { kind, q, options: [], correct: 0, items };
  }
  if (kind === 'match') {
    const items = strs(o.items, 100), pairs = strs(o.pairs, 160);
    if (items.length < 3 || items.length > 5 || pairs.length !== items.length || [...items, ...pairs].some(x => !x) || new Set(items).size !== items.length || new Set(pairs).size !== pairs.length) {
      throw new Error('coppie: servono da 3 a 5 coppie diverse');
    }
    return { kind, q, options: [], correct: 0, items, pairs };
  }
  let options = strs(o.options, max);
  if (kind === 'truefalse') {
    // true first, false second, whatever the model wrote; `correct` 0 = the statement is true
    options = options.length === 2 && options.every(Boolean) ? options : [...(opts.trueFalse ?? ['Vero', 'Falso'])];
    const c = o.correct === true || o.correct === 0 || o.correct === 'true' ? 0 : o.correct === false || o.correct === 1 || o.correct === 'false' ? 1 : -1;
    if (c < 0) throw new Error('vero/falso: correct dev’essere true o false');
    return { kind, q, options, correct: c };
  }
  if (options.length < 2 || options.length > 4 || options.some(x => !x) || new Set(options).size !== options.length) throw new Error('domanda: servono da 2 a 4 risposte diverse');
  const correct = Number(o.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new Error('domanda: correct fuori dalle risposte');
  if (kind === 'cloze') {
    const code = typeof o.code === 'string' ? o.code.replace(/\r\n/g, '\n').split('\n').slice(0, 14).join('\n').slice(0, 1200) : '';
    if (code.split(BLANK).length !== 2) throw new Error('completa il codice: serve un solo ___ nel codice');
    return { kind, q, options, correct, code };
  }
  return { kind, q, options, correct };
}

/** Is the response right? */
export function quizRight(b: Pick<QuizBody, 'kind' | 'correct' | 'items' | 'pairs' | 'options'>, r: QuizResponse): boolean {
  if (b.kind === 'order') return Array.isArray(r) && r.length === (b.items?.length ?? -1) && r.every((x, i) => x === i);
  if (b.kind === 'match') return Array.isArray(r) && r.length === (b.pairs?.length ?? -1) && r.every((x, i) => x === i);
  return typeof r === 'number' && r === b.correct;
}

/** A response the question can take (main checks the renderer's before keeping it). */
export function quizValid(b: Pick<QuizBody, 'kind' | 'items' | 'pairs' | 'options'>, r: unknown): r is QuizResponse {
  if (b.kind === 'order' || b.kind === 'match') {
    const n = (b.kind === 'order' ? b.items : b.pairs)?.length ?? 0;
    return Array.isArray(r) && r.length === n && r.every(x => Number.isInteger(x) && x >= 0 && x < n) && new Set(r).size === n;
  }
  return typeof r === 'number' && Number.isInteger(r) && r >= 0 && r < b.options.length;
}

/** The `choice` a stored answer keeps: the option for pick kinds; for order and match `correct` when right, else -1. */
export const storedChoice = (b: Pick<QuizBody, 'kind' | 'correct' | 'items' | 'pairs' | 'options'>, r: QuizResponse): number =>
  typeof r === 'number' ? r : quizRight(b, r) ? b.correct : -1;

/** A stable shuffle of 0..n-1 for one question (the same order every time it is shown), never the solved order. */
export function shuffled(n: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  // a list already in order would give the answer away: rotate it by one
  if (n > 1 && out.every((x, i) => x === i)) out.push(out.shift()!);
  return out;
}
