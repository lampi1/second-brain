// Impara's «Studio» and quality gate (ADR 0205). Studio (the NotebookLM-like column beside a lesson): tiles that make
// more from the lesson's VERIFIED facts only, one short hidden run each, no new research: a mind map of the whole
// lesson, a one-page summary citing the facts, a glossary, flashcards (into the FSRS review), a 10-question quiz (played
// in the review session), a timeline when the lesson has one, a two-voice podcast script read by the app's local
// voices; «Mettimi alla prova» is the tutor asking questions (no run of its own). Each output is saved with the lesson
// and reopens as it was. The quality gate: a cheap run scores the draft pieces against a fixed checklist (one idea per
// piece, a concrete example, every claim cites a fact, a diagram of at most 12 parts, questions that make one think)
// and rewrites only the failing pieces, once; the checks it can make alone (citations, size) are made here at zero
// tokens. Everything the model writes is untrusted: parsed and capped here. Shared by main/learn (service.ts,
// prompt.ts) and the renderer (components/impara/ImparaStudio.tsx); pinned by test/unit/lesson-studio.test.ts.
import { parseCards, type CardDraft } from './review';
import { contentLines, visualParts, VISUAL_PARTS_MAX } from './lesson-visual';
import type { LessonCheck, LessonStep } from './lesson';

export type StudioKind = 'mindmap' | 'summary' | 'glossary' | 'flashcards' | 'quiz' | 'timeline' | 'challenge' | 'oral' | 'practice' | 'podcast';
/** In the column's order (owner's report, I3; the three «do something» tiles first since ADR 0213). */
export const STUDIO_KINDS: readonly StudioKind[] = ['practice', 'oral', 'challenge', 'mindmap', 'summary', 'quiz', 'flashcards', 'glossary', 'podcast', 'timeline'];
/** The tiles where the learner does something with the tutor, no run of their own (ADR 0213): «Mettimi alla prova»
 *  (written questions), «Interrogazione a voce» (asked and answered aloud, a mark at the end), «Esercitati» (exercises
 *  to solve, each corrected). */
export type StudioLive = 'challenge' | 'oral' | 'practice';
export const isStudioLive = (k: unknown): k is StudioLive => k === 'challenge' || k === 'oral' || k === 'practice';
/** The tiles a run makes. */
export type StudioMade = Exclude<StudioKind, StudioLive>;
export const isStudioMade = (k: unknown): k is StudioMade => typeof k === 'string' && !isStudioLive(k) && (STUDIO_KINDS as readonly string[]).includes(k);

export interface GlossaryTerm { term: string; meaning: string; cites: string[] }
/** who: 0 = the host who asks, 1 = the expert who explains */
export interface PodcastLine { who: 0 | 1; say: string }
export type StudioOut =
  | { kind: 'mindmap'; src: string }
  | { kind: 'summary'; md: string }
  | { kind: 'glossary'; terms: GlossaryTerm[] }
  /** the cards went into the review; their questions and answers kept here for the preview */
  | { kind: 'flashcards'; n: number; cards: { q: string; answer: string }[] }
  | { kind: 'quiz'; qs: CardDraft[] }
  /** none: the lesson has no story in time (the model says why) */
  | { kind: 'timeline'; src: string | null; none?: string }
  | { kind: 'podcast'; title: string; lines: PodcastLine[] };
export interface StudioItem { state: 'making' | 'done' | 'failed'; at: number; error?: string; out?: StudioOut }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const one = (v: unknown, max: number): string => str(v, max).replace(/\s+/g, ' ');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const FORBIDDEN = /%%\{|^\s*(?:click|href|classDef|class|style|linkStyle)\b|<\s*script|javascript:/im;

/** [f1] citations kept only for known facts (an unknown one is taken out of the text). */
export const keepCites = (md: string, facts: readonly string[]): string => md.replace(/\s?\[(f\d+)\]/g, (all, id: string) => (facts.includes(id) ? all : ''));

/** A mermaid mind map or timeline the model wrote, checked: the right header, no directive or link, at most `max` lines. */
function mermaidOf(v: unknown, head: RegExp, max: number): string | null {
  const src = str(v, 3000);
  if (!src || !head.test(src) || FORBIDDEN.test(src)) return null;
  const n = contentLines(src).length;
  return n >= 2 && n <= max ? src : null;
}

/** What one Studio run wrote, checked. `facts` = the verified facts' ids (every output stands on them); `nodes` = the
 *  lesson diagram's ids (a quiz may ask to click one). Flashcards come back as `cards` too (they go into the review).
 *  Throws when nothing usable came back. */
export function parseStudio(kind: StudioMade, v: unknown, facts: readonly string[], nodes: readonly string[] = []): { out: StudioOut; cards?: CardDraft[] } {
  const o = obj(v);
  if (kind === 'mindmap') {
    const src = mermaidOf(o.mermaid ?? o.mindmap, /^mindmap\b/, 40);
    if (!src) throw new Error('mappa mentale non valida');
    return { out: { kind, src } };
  }
  if (kind === 'timeline') {
    const none = one(o.none, 240);
    const src = mermaidOf(o.mermaid ?? o.timeline, /^timeline\b/, 30);
    if (!src && !none) throw new Error('linea del tempo non valida');
    return { out: src ? { kind, src } : { kind, src: null, none } };
  }
  if (kind === 'summary') {
    const md = keepCites(str(o.summary ?? o.md, 4000), facts);
    if (md.length < 40) throw new Error('riassunto vuoto');
    return { out: { kind, md } };
  }
  if (kind === 'glossary') {
    const terms = (Array.isArray(o.terms) ? o.terms : []).map(obj).map(t => ({
      term: one(t.term, 60), meaning: one(t.meaning, 300),
      cites: [...new Set((Array.isArray(t.cites) ? t.cites : []).filter((x): x is string => typeof x === 'string' && facts.includes(x)))].slice(0, 3),
    })).filter(t => t.term && t.meaning).slice(0, 16);
    if (!terms.length) throw new Error('glossario vuoto');
    return { out: { kind, terms: terms.sort((a, b) => a.term.localeCompare(b.term)) } };
  }
  if (kind === 'quiz' || kind === 'flashcards') {
    const raw = (Array.isArray(o.cards) ? o.cards : Array.isArray(o.questions) ? o.questions : []).map(obj)
      // a flashcard is a recall card; a quiz keeps its kinds (truefalse among them, ADR 0204)
      .map(c => (kind === 'flashcards' ? { ...c, kind: 'recall' } : c));
    const qs = parseCards({ cards: raw }, nodes, facts);
    if (qs.length < (kind === 'quiz' ? 4 : 2)) throw new Error(kind === 'quiz' ? 'quiz con troppe poche domande valide' : 'troppe poche carte valide');
    return kind === 'quiz' ? { out: { kind, qs } } : { out: { kind, n: qs.length, cards: qs.map(c => ({ q: c.q, answer: c.answer })) }, cards: qs };
  }
  // podcast
  const lines = (Array.isArray(o.lines) ? o.lines : []).map(obj).map((l): PodcastLine => ({ who: l.who === 1 || l.who === 'B' || l.who === 'expert' ? 1 : 0, say: one(l.say, 400) }))
    .filter(l => l.say).slice(0, 30);
  if (lines.length < 4) throw new Error('copione troppo corto');
  return { out: { kind: 'podcast', title: one(o.title, 120), lines } };
}

// ── the quality gate ───────────────────────────────────────────────────────────────────────────────────────────────

/** The checklist (owner's report, I7). */
export type QualityRule = 'one-idea' | 'example' | 'cites' | 'diagram' | 'questions';
export const QUALITY_RULES: readonly QualityRule[] = ['one-idea', 'example', 'cites', 'diagram', 'questions'];
/** What the gate found: pieces and checks looked at, how many were rewritten, the failures by rule (before the
 *  rewrite); none = the gate's run did not answer (the draft was kept). */
export interface LessonQuality { checked: number; fixed: number; fails: Partial<Record<QualityRule, number>>; at: number; none?: boolean }

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** What a piece fails that the app can see alone: no citation while there are facts, too long for one idea, a visual of
 *  more than 12 parts. */
export function pieceIssues(s: Pick<LessonStep, 'cites' | 'say' | 'text' | 'beats' | 'visual'>, hasFacts: boolean): QualityRule[] {
  const out: QualityRule[] = [];
  if (hasFacts && !s.cites?.length) out.push('cites');
  if ((s.beats?.length ?? 0) > 4 || words(s.say) > 80 || words(s.text) > 170) out.push('one-idea');
  if (s.visual && visualParts(s.visual) > VISUAL_PARTS_MAX) out.push('diagram');
  return out;
}

/** What a check fails alone: a question that cannot make one think (fewer than 3 options, a very short question, an
 *  option much longer than the others: the right one shows). */
export function checkIssues(c: Pick<LessonCheck, 'q' | 'options' | 'correct'> & { kind?: LessonCheck['kind'] }): QualityRule[] {
  // the option checks are for a choice among 3-4 (predict, choice, cloze): a true/false has two by design, order and
  // match have none (ADR 0204)
  const pick = !c.kind || c.kind === 'predict' || c.kind === 'choice' || c.kind === 'cloze';
  const lens = c.options.map(o => o.length);
  const others = lens.filter((_, i) => i !== c.correct);
  const giveaway = pick && others.length > 0 && (lens[c.correct] ?? 0) > 2.2 * Math.max(...others) && (lens[c.correct] ?? 0) > 40;
  return (pick && c.options.length < 3) || c.q.length < 20 || giveaway ? ['questions'] : [];
}

/** The gate's answer: for each piece (by its number in the draft, from 1) pass or the rules it fails, with a rewrite;
 *  the same for the checks. Only well-formed verdicts are kept. */
export interface GateVerdict { n: number; fails: QualityRule[]; fix?: unknown }
export function parseGate(v: unknown): { pieces: GateVerdict[]; checks: GateVerdict[] } {
  const o = obj(v);
  const read = (x: unknown): GateVerdict[] => (Array.isArray(x) ? x : []).map(obj).flatMap(r => {
    const n = Number(r.n);
    if (!Number.isInteger(n) || n < 1 || n > 20) return [];
    const fails = (Array.isArray(r.fails) ? r.fails : []).filter((f): f is QualityRule => (QUALITY_RULES as readonly unknown[]).includes(f));
    return [{ n, fails: r.pass === true ? [] : fails, ...(r.fix && typeof r.fix === 'object' ? { fix: r.fix } : {}) }];
  });
  return { pieces: read(o.pieces), checks: read(o.checks) };
}
