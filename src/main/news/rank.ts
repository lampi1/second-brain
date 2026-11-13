// The «Giornale» (ADR 0265, editions ADR 0280): the order of an edition's paper and each story's section, at zero
// tokens. A story's score is a sum of four parts, each 0..1 and shown to the user as «perché è qui»: recency (half
// life 36 hours), its source's weight, relevance to the edition (its key words in the title and snippet: `core` the
// heart of the user's interest, `near` its surroundings; and the AI pass's own 0-3 judgement once it ran) and echo
// (how many other sources carry it, Hacker News points, paper votes). The section comes from the story's words when
// they are clear, else from its source; the AI pass may still move it. A pure module: tests in
// test/unit/news-rank.test.ts.
import { wordPattern, type NewsEdition, type NewsItem, type NewsSource } from '@shared/news';

export const WEIGHTS = { recency: 0.4, source: 0.2, relevance: 0.28, echo: 0.12 } as const;
const HALF_LIFE_H = 36;
export const UNDATED_RECENCY = 0.15;

type Words = Pick<NewsEdition, 'core' | 'near' | 'sections'>;
interface Compiled { core: RegExp | null; near: RegExp | null; sections: [string, RegExp][] }
const compiled = new WeakMap<object, Compiled>();
/** An edition's words as patterns, built once per edition object (the service replaces the object on every edit). */
function patterns(ed: Words): Compiled {
  let c = compiled.get(ed);
  if (!c) {
    c = { core: wordPattern(ed.core), near: wordPattern(ed.near), sections: ed.sections.flatMap(s => { const re = wordPattern(s.words); return re ? [[s.id, re] as [string, RegExp]] : []; }) };
    compiled.set(ed, c);
  }
  return c;
}
const count = (re: RegExp | null, s: string) => (re ? (s.match(re) ?? []).length : 0);
const has = (re: RegExp, s: string) => { re.lastIndex = 0; return re.test(s); };

/** 0..1: how much a story speaks of the edition's subject. */
export function relevance(title: string, snippet: string, ed: Words): number {
  const p = patterns(ed);
  const t = `${title} ${title} ${snippet}`; // the title counts twice
  return Math.min(1, count(p.core, t) * 0.22 + count(p.near, t) * 0.08);
}

/** 0..1, by age: 1 now, 0.5 after 36 hours, never below 0. */
export const recency = (at: number, now: number): number => Math.max(0, Math.min(1, 0.5 ** (Math.max(0, now - at) / 3_600_000 / HALF_LIFE_H)));

/** 0..1: other sources that carry it, and the points or votes it got. */
export function echo(it: Pick<NewsItem, 'also' | 'signal' | 'source'>, sources: ReadonlyMap<string, NewsSource>): number {
  const others = it.also.length;
  const s = sources.get(it.source);
  // HN points: 150 → ~0.35, 600 → ~0.65; paper votes: 20 → ~0.3, 100 → ~0.65
  const sig = it.signal ? Math.min(1, Math.log10(1 + it.signal / (s?.read === 'hf-papers' ? 8 : 40)) / 1.4) : 0;
  return Math.min(1, others * 0.3 + sig);
}

/** The section a story's own words point to, else its source's (a pinned source keeps its own). */
export function sectionOf(title: string, snippet: string, src: Pick<NewsSource, 'section' | 'pin'>, ed: Words): string {
  const known = (id: string) => ed.sections.some(s => s.id === id);
  const fallback = known(src.section) ? src.section : '';
  if (src.pin && fallback) return fallback;
  const p = patterns(ed), t = `${title} ${snippet.slice(0, 160)}`;
  return p.sections.find(([, re]) => has(re, title))?.[0] ?? p.sections.find(([, re]) => has(re, t))?.[0] ?? fallback;
}

/** Scores every story of one edition and sorts its paper: the best first; a story already read sinks a little, a saved one never. */
export function rank(items: readonly NewsItem[], sources: readonly NewsSource[], now: number, ed: Words): NewsItem[] {
  const byId = new Map(sources.map(s => [s.id, s]));
  return items.map(it => {
    const parts = {
      // a story whose date nobody gave (a page, its article had none) is not treated as new
      recency: it.undated ? UNDATED_RECENCY : recency(it.at, now),
      source: byId.get(it.source)?.weight ?? 0.5,
      // the AI pass's judgement (fit 0..3) weighs more than the words, once there is one
      relevance: it.fit !== undefined ? 0.35 * relevance(it.title, `${it.summary ?? ''} ${it.snippet}`, ed) + 0.65 * (it.fit / 3) : relevance(it.title, `${it.summary ?? ''} ${it.snippet}`, ed),
      echo: echo(it, byId),
    };
    const score = parts.recency * WEIGHTS.recency + parts.source * WEIGHTS.source + parts.relevance * WEIGHTS.relevance + parts.echo * WEIGHTS.echo;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return { ...it, rank: { recency: round(parts.recency), source: round(parts.source), relevance: round(parts.relevance), echo: round(parts.echo) }, score: round(score * (it.read && !it.saved ? 0.85 : 1)) };
  }).sort((a, b) => b.score - a.score || b.at - a.at);
}
