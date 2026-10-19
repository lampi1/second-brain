// "Discutine" / "Apri una chat" on the ideas and the AI's suggestions (Idee), on the recurring AI errors and on every
// number of Qualità and Costi (ADR 0037): the ready texts (a draft for the Orchestrator that quotes the topic with its source
// file, its numbers or its line, the first message of a dedicated work chat), the line of an idea in its file, and the "discussa" record (which chat,
// when) kept per topic in the app's own storage. The idea's state in ideas.md is never changed here: only the Orchestrator
// changes it, when the owner asks. DOM-free and unit-tested (test/unit/brain-ui/discuss.test.ts); the buttons are
// components/Discuss.tsx.
import type { Idea, Reflection } from '../types';
import { t as i18nT } from '../../i18n';
import { short } from './text';

/** A recurring error or a number of a stats page, quoted as it is on screen: its source file and its facts (count,
 *  period, comparison). `id` keys the "discussa" record: stable across reloads (the pattern or the metric, not values). */
export interface Quote {
  id: string;
  what: 'errore' | 'numero';
  title: string;
  /** where the number comes from, as the page says it ("ai-errors.md", "costi del cervello, /api/cost") */
  source: string;
  /** one fact per line, already in plain Italian with numbers and dates */
  facts: string[];
  /** the opening question; the default one by `what` otherwise */
  question?: string;
  /** the source is a file of the brain folder (the dedicated chat can reread it); else it works from the facts */
  inBrain?: boolean;
}

/** What can be discussed: an idea of ideas.md (the owner's or the AI's), a reflection of ai-reflections.md, a quoted
 *  error pattern or number. */
export type Topic =
  | { kind: 'idea'; idea: Idea }
  | { kind: 'reflection'; reflection: Reflection }
  | { kind: 'quote'; quote: Quote };

export const IDEAS_FILE = 'ideas.md';
export const REFLECTIONS_FILE = 'ai-reflections.md';
/** The brain file that holds the topic; null for a quote (its source may be several files or the app's logs). */
export const fileOf = (t: Topic): string | null =>
  (t.kind === 'idea' ? IDEAS_FILE : t.kind === 'reflection' ? REFLECTIONS_FILE : null);
export const titleOf = (t: Topic): string =>
  (t.kind === 'idea' ? t.idea.titolo : t.kind === 'reflection' ? t.reflection.titolo : t.quote.title);
export const dateOf = (t: Topic): string =>
  (t.kind === 'idea' ? t.idea.data : t.kind === 'reflection' ? t.reflection.data : '');

/** Stable key of a topic (date + title, as the brain's live feed keys ideas; a quote by its id). */
export const topicKey = (t: Topic): string =>
  t.kind === 'idea' ? `idea|${t.idea.data}|${t.idea.titolo}`
    : t.kind === 'reflection' ? `refl|${t.reflection.data}|${t.reflection.chat}|${t.reflection.titolo}`
      : `quote|${t.quote.id}`;

/** 1-based line of the topic's heading in its file: the "## …" line with its date and title, else any line with the
 *  title; null when the file does not have it (the message then names only the file). */
export function lineOf(fileText: string, t: Topic): number | null {
  const title = titleOf(t).trim();
  if (!fileText || !title) return null;
  const lines = fileText.split(/\r?\n/);
  const date = dateOf(t);
  const head = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(title) && (!date || l.includes(date)));
  if (head >= 0) return head + 1;
  const any = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(title));
  if (any >= 0) return any + 1;
  const loose = lines.findIndex(l => l.includes(title));
  return loose >= 0 ? loose + 1 : null;
}

const where = (t: Topic, line: number | null) => (t.kind === 'quote' ? t.quote.source : `${fileOf(t)}${line ? `, line ${line}` : ''}`);
const ddmm = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}` : iso; };
const field = (label: string, v: string, max = 280) => (v.trim() ? `- ${label}: ${short(v.trim().replace(/\s+/g, ' '), max)}` : '');
const STATE_RULE = 'Do not change the state in ideas.md: I will decide after we talk about it.';
/** ideas.md's state words, in the prompt's English (unknown values pass through as written). */
const STATE_WORD: Record<string, string> = { aperta: 'open', 'in corso': 'in progress', fatta: 'done', scartata: 'discarded' };
const stateWord = (s: string): string => STATE_WORD[s] ?? s;

export const ERROR_QUESTION = 'Why does it happen and how do we prevent it? Propose just one: a clearer rule or an automatic check.';
export const NUMBER_QUESTION = 'What does this number tell us? If there is something to change, give me the first small step.';
/** The first question that opens the discussion, by kind and state (a quote: its own, else by error or number). */
export function openingQuestion(t: Topic): string {
  if (t.kind === 'quote') return t.quote.question ?? (t.quote.what === 'errore' ? ERROR_QUESTION : NUMBER_QUESTION);
  if (t.kind === 'reflection') return 'Do you still agree with yourself? What would you change, concretely, in how we work?';
  const i = t.idea;
  if (i.stato === 'fatta') return 'Did it work as we wanted? What would you keep and what would you change?';
  if (i.stato === 'scartata') return 'We had ruled it out: has something changed that makes it useful now?';
  if (i.stato === 'in corso') return 'Where are we? What is the next small step?';
  if (i.chi === 'IA') return 'Are you still convinced? Give me pros, cons and the first small step to try it.';
  return 'Does it still make sense? Give me pros, cons and the first small step to try it.';
}

/** The draft for the Orchestrator ("Discutine"): quotes the topic with file and line, ends with the opening question. */
export function discussText(t: Topic, line: number | null): string {
  if (t.kind === 'quote') {
    const q = t.quote;
    return blocks(
      [`Let's discuss ${q.what === 'errore' ? 'the recurring error' : 'the number'} «${q.title}» (source: ${q.source}).`],
      q.facts.map(f => (f.trim() ? `- ${short(f.trim().replace(/\s+/g, ' '), 300)}` : '')),
      [openingQuestion(t)],
    );
  }
  if (t.kind === 'reflection') {
    const r = t.reflection;
    return blocks(
      [`Let's discuss your reflection «${r.titolo}» (${where(t, line)}, from ${ddmm(r.data)}, chat ${r.chat}).`],
      [field('You noticed', r.notato), field('You think', r.penso), field('Confidence', r.sicurezza, 80), field('You don\'t know', r.nonso)],
      [openingQuestion(t)],
    );
  }
  const i = t.idea;
  const whose = i.chi === 'IA' ? `the AI's suggestion` : 'my idea';
  return blocks(
    [`Let's discuss ${whose} «${i.titolo}» (${where(t, line)}, from ${ddmm(i.data)}, state ${i.stato ? stateWord(i.stato) : 'open'}).`],
    [field('In short', i.idea), field('Why', i.perche), field('How', i.come),
      field('Noticed', i.notato), field('Think', i.penso), field('Don\'t know', i.nonso),
      i.fonte ? field('Born in', i.fonte.replace(/^IA\s*·\s*/, ''), 120) : ''],
    [`${openingQuestion(t)} ${STATE_RULE}`],
  );
}
/** Paragraphs of non-empty lines, separated by one blank line; an empty paragraph disappears. */
const blocks = (...ps: string[][]): string => ps.map(p => p.filter(Boolean).join('\n')).filter(Boolean).join('\n\n');

/** Title of the dedicated work chat ("Idea · <titolo>", short enough for a tile). */
export const chatTitle = (t: Topic): string =>
  `${t.kind === 'idea' ? i18nT('brainLib.discuss.kindIdea') : t.kind === 'reflection' ? i18nT('brainLib.discuss.kindReflection') : t.quote.what === 'errore' ? i18nT('brainLib.discuss.kindError') : i18nT('brainLib.discuss.kindNumber')} · ${short(titleOf(t), 44)}`;

/** First message of the dedicated work chat ("Apri una chat"): read the topic, propose before touching anything. */
export function chatPrompt(t: Topic, line: number | null): string {
  if (t.kind === 'quote') {
    const q = t.quote;
    return [
      `Let's work on ${q.what === 'errore' ? 'the recurring error' : 'the number'} «${q.title}» (source: ${q.source}${q.inBrain ? ', in the brain folder' : ''}).`,
      ...q.facts.filter(f => f.trim()).map(f => `- ${short(f.trim().replace(/\s+/g, ' '), 300)}`),
      `${q.inBrain ? 'Re-read the source' : 'Start from the numbers above'}, then in 5 lines: ${q.what === 'errore' ? 'why it happens and just one proposal to prevent it' : 'what the number tells us and what you would do'}, before touching anything.`,
    ].join('\n');
  }
  const what = t.kind === 'idea' ? `on the idea «${t.idea.titolo}»` : `on the AI's reflection «${t.reflection.titolo}»`;
  return [
    `Let's work ${what} (${where(t, line)} in the brain folder).`,
    `Read it completely${line ? ` from line ${line}` : ''}, then propose to me in 5 lines how to start and the first step, before touching anything.`,
    'Only the Orchestrator changes the state of the idea in ideas.md, when I ask it to.',
  ].join('\n');
}

// ── the "discussa" record ───────────────────────────────────────────────────────────────────────────────────────────
/** One discussion: with the Orchestrator (the draft was sent) or in a dedicated work chat. */
export interface Discussed { via: 'regia' | 'chat'; chatId: string; chatTitle: string; at: number }
export type DiscussedMap = Record<string, Discussed[]>;
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const KEY = 'sb.discussed.v1';
const MAX_KEYS = 400;

export function readDiscussed(kv: KV | null): DiscussedMap {
  try {
    const raw = JSON.parse(kv?.getItem(KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: DiscussedMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const list = v.filter((d): d is Discussed => !!d && typeof d === 'object' && (d.via === 'regia' || d.via === 'chat') && typeof d.chatId === 'string' && typeof d.at === 'number')
        .map(d => ({ via: d.via, chatId: d.chatId, chatTitle: typeof d.chatTitle === 'string' ? d.chatTitle : '', at: d.at }));
      if (list.length) out[k] = list;
    }
    return out;
  } catch { return {}; }
}

/** Add a discussion (newest first, at most 5 per topic, the oldest topics dropped past MAX_KEYS). */
export function addDiscussed(m: DiscussedMap, key: string, d: Discussed): DiscussedMap {
  const list = [d, ...(m[key] ?? []).filter(x => !(x.chatId === d.chatId && x.via === d.via))].slice(0, 5);
  const next: DiscussedMap = { ...m, [key]: list };
  const keys = Object.keys(next);
  if (keys.length > MAX_KEYS) {
    const byAge = keys.sort((a, b) => (next[a]![0]!.at) - (next[b]![0]!.at));
    for (const k of byAge.slice(0, keys.length - MAX_KEYS)) delete next[k];
  }
  return next;
}

export function writeDiscussed(kv: KV | null, m: DiscussedMap): void {
  try { kv?.setItem(KEY, JSON.stringify(m)); } catch { /* storage off: the mark lives until the app restarts */ }
}
