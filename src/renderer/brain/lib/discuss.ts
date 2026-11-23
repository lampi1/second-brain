// "Discuti" on the recurring AI errors and on every number of Qualità and Costi (ADR 0037): the ready draft for the
// Orchestrator (quotes the topic with its source and its numbers) and the "discussa" record (which chat, when) kept per
// topic in the app's own storage (a DevOps record's too: components/RecordDiscussButton.tsx). DOM-free and unit-tested
// (test/unit/brain-ui/discuss.test.ts); the buttons are components/Discuss.tsx.
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
}

/** What can be discussed: a quoted error pattern or number. */
export type Topic = { kind: 'quote'; quote: Quote };
export const titleOf = (t: Topic): string => t.quote.title;
/** Stable key of a topic: the quote's id. */
export const topicKey = (t: Topic): string => `quote|${t.quote.id}`;

export const ERROR_QUESTION = 'Why does it happen and how do we prevent it? Propose just one: a clearer rule or an automatic check.';
export const NUMBER_QUESTION = 'What does this number tell us? If there is something to change, give me the first small step.';
/** The question that opens the discussion: the quote's own, else by error or number. */
export const openingQuestion = (t: Topic): string => t.quote.question ?? (t.quote.what === 'errore' ? ERROR_QUESTION : NUMBER_QUESTION);

/** The draft for the Orchestrator ("Discuti"): quotes the topic with its source, ends with the opening question. */
export function discussText(t: Topic): string {
  const q = t.quote;
  return blocks(
    [`Let's discuss ${q.what === 'errore' ? 'the recurring error' : 'the number'} «${q.title}» (source: ${q.source}).`],
    q.facts.map(f => (f.trim() ? `- ${short(f.trim().replace(/\s+/g, ' '), 300)}` : '')),
    [openingQuestion(t)],
  );
}
/** Paragraphs of non-empty lines, separated by one blank line; an empty paragraph disappears. */
const blocks = (...ps: string[][]): string => ps.map(p => p.filter(Boolean).join('\n')).filter(Boolean).join('\n\n');

// ── the "discussa" record ───────────────────────────────────────────────────────────────────────────────────────────
/** One discussion: with the Orchestrator (the draft was sent); `chat` = a dedicated work chat, kept only to read the
 *  records written before 2026-10-19, when the bar could still open one. */
export interface Discussed { via: 'orchestrator' | 'chat'; chatId: string; chatTitle: string; at: number }
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
      const list = v.filter((d): d is Discussed => !!d && typeof d === 'object' && (d.via === 'orchestrator' || d.via === 'chat') && typeof d.chatId === 'string' && typeof d.at === 'number')
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
