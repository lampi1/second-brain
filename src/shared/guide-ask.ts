// «Chiedi alla Guida» (ADR 0196): the question box on top of the Guida page. The question goes to one light model with no
// tools (main/guide/service.ts → agents/oneshot.ts, Flash's engine at its lightest tier), with the cards that match it
// in full, the list of every card and the app_guide index as context. This file is the pure half: the IPC shapes, which
// cards go in (word overlap with the question, within the one-shot's prompt limit), the prompt, and the answer's
// citations ([card:<id>] and `path`) checked against what was given, so a made-up card or file is never a link. Used
// by main/guide/service.ts, renderer/components/GuideAsk.tsx and test/unit/guide-ask.test.ts.
import { CONCEPTS, cardText, textOf, type ConceptCard, type GuideLang } from './concept-guide';
import { parseAnchor } from './guide-anchors';

export interface GuideAskRequest { question: string; lang: GuideLang }
export interface GuideAnswer {
  ok: boolean;
  /** the answer, Markdown-light: paragraphs, "- " lists, [card:<id>] and `path` citations */
  text: string;
  /** the cards and source files it cites, only those that were in its context */
  cards: string[];
  files: string[];
  costUsd: number | null;
  costBasis: 'reported' | 'estimated' | 'unknown';
  model: string | null;
  /** why it did not answer (no engine, too long, the engine's error) */
  reason?: string;
  noEngine?: boolean;
}
/** The cards whose anchored code changed (dev runs from the repo only; checked = false in a packaged build). */
export interface GuideStaleState { checked: boolean; cards: { id: string; points: number[]; refs: string[] }[] }

export const QUESTION_MAX = 500;
/** the one-shot's prompt limit is 12 000 characters (agents/oneshot.ts): what the context may take of it */
const PROMPT_BUDGET = 11_000;
const INDEX_MAX = 2_200;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(('come cosa dove quando perche quale quali posso puoi fare sono della delle degli nella nelle con per che una uno gli '
  + 'how what where when why which can could does the and for with this that from into '
  + 'wie was wo wann warum kann ich der die das und mit').split(' '));
const stems = (s: string) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => (w.length > 5 ? w.slice(0, 5) : w)))];

/** The cards that best match the question, best first (only those with at least one word in common). */
export function rankCards(question: string, lang: GuideLang, cards: readonly ConceptCard[] = CONCEPTS): ConceptCard[] {
  const q = stems(question);
  if (!q.length) return [];
  const has = (toks: string[], w: string) => toks.some(t => t.startsWith(w));
  return cards.map((c, i) => {
    const title = stems(`${textOf(c.title, lang)} ${c.title.en}`);
    const body = stems(`${textOf(c.summary, lang)} ${c.points.map(p => textOf(p, lang)).join(' ')} ${c.tech.map(t => textOf(t.text, lang)).join(' ')}`);
    const score = q.reduce((n, w) => n + (has(title, w) ? 3 : has(body, w) ? 1 : 0), 0);
    return { c, i, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map(x => x.c);
}

const LANG_NAME: Record<GuideLang, string> = { it: 'Italian', en: 'English', de: 'German' };

export const GUIDE_SYSTEM = (lang: GuideLang) => [
  'You answer a user\'s question about the second-brain desktop app, from the app\'s own Guida cards and app map below.',
  `Answer in ${LANG_NAME[lang]}, short: at most 8 sentences or a short list. Plain text; "- " for a list.`,
  'After each claim cite the card it comes from as [card:<id>] (ids from the cards list). Name a source file only as `path`, and only one listed in a card\'s sources.',
  'Say where to click when the cards say it. If the cards do not cover the question, say so in one sentence and suggest asking the Orchestrator; never guess.',
].join('\n');

/** The prompt: question, the matching cards in full, every card's id and title, the app map index; within the budget. */
export function guidePrompt(question: string, lang: GuideLang, index: string, cards: readonly ConceptCard[] = CONCEPTS): { prompt: string; given: ConceptCard[] } {
  const q = question.trim().slice(0, QUESTION_MAX);
  const list = `All Guida cards (id: title):\n${cards.map(c => `${c.id}: ${textOf(c.title, lang)}`).join('\n')}`;
  const map = index.trim() ? `App map (app_guide index):\n${index.trim().slice(0, INDEX_MAX)}` : '';
  const head = `Question: ${q}`;
  let room = PROMPT_BUDGET - head.length - list.length - map.length - 200;
  const given: ConceptCard[] = [];
  const parts: string[] = [];
  const ranked = rankCards(q, lang, cards);
  for (const c of ranked.length ? ranked : cards.filter(x => x.prominent)) {
    const text = `[card:${c.id}]\n${cardText(c, lang)}`;
    if (text.length > room) { if (given.length >= 1) break; continue; }
    parts.push(text); given.push(c); room -= text.length + 2;
    if (given.length >= 4) break;
  }
  const prompt = [head, parts.length ? `Matching cards:\n\n${parts.join('\n\n')}` : 'No card matches the question\'s words.', list, map].filter(Boolean).join('\n\n');
  return { prompt, given };
}

/** The citations of an answer, kept only when they name a known card or a file of a card that was given. */
export function citations(text: string, given: readonly ConceptCard[], cards: readonly ConceptCard[] = CONCEPTS): { cards: string[]; files: string[] } {
  const known = new Set(cards.map(c => c.id));
  const files = new Set(given.flatMap(c => [...c.sources, ...Object.values(c.anchors ?? {}).flat().map(r => parseAnchor(r).file)]));
  const outCards = [...new Set([...text.matchAll(/\[card:([a-z0-9-]+)\]/g)].map(m => m[1]!))].filter(id => known.has(id));
  const outFiles = [...new Set([...text.matchAll(/`([^`\s]+)`/g)].map(m => m[1]!))].filter(f => files.has(f));
  return { cards: outCards, files: outFiles };
}

/** An answer's text as pieces for the page: plain text, a card link, a file. Unknown card ids stay plain text. */
export type AnswerPiece = { kind: 'text'; text: string } | { kind: 'card'; id: string } | { kind: 'file'; path: string } | { kind: 'code'; text: string };
export function answerPieces(line: string, cardIds: ReadonlySet<string>, fileSet: ReadonlySet<string>): AnswerPiece[] {
  const out: AnswerPiece[] = [];
  let last = 0;
  for (const m of line.matchAll(/\[card:([a-z0-9-]+)\]|`([^`]+)`/g)) {
    if (m.index! > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push(cardIds.has(m[1]) ? { kind: 'card', id: m[1] } : { kind: 'text', text: '' });
    else out.push(fileSet.has(m[2]!) ? { kind: 'file', path: m[2]! } : { kind: 'code', text: m[2]! });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out.filter(p => p.kind !== 'text' || p.text);
}
