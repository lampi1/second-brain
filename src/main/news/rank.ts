// Impara «News» (ADR 0264): the order of the paper and each story's section, at zero tokens. A story's score is a sum
// of four parts, each 0..1 and shown to the user as «perché è qui»: recency (half life 36 hours), its source's weight,
// relevance to this user (a developer who builds agents, skills and harnesses: words of that work in the title and
// snippet, and the AI pass's own 0-3 judgement once it ran) and echo (how many other sources carry it, Hacker News points, paper votes). The section comes from the
// story's words when they are clear, else from its source; the AI pass may still move it. A pure module: tests in
// test/unit/news-rank.test.ts.
import type { NewsItem, NewsSection, NewsSource } from '@shared/news';

export const WEIGHTS = { recency: 0.4, source: 0.2, relevance: 0.28, echo: 0.12 } as const;
const HALF_LIFE_H = 36;
export const UNDATED_RECENCY = 0.15;

/** Words of the user's work, by strength: the first list is the core (agents, harnesses, skills, MCP), the second the
 *  near (models, evals, coding). Matched on whole words, case-insensitive. */
const CORE = /\b(agent(s|ic)?|sub-?agents?|harness(es)?|claude code|codex|cursor|opencode|gemini cli|skills?|mcp|model context protocol|tool[- ]?use|tool calling|computer use|context (window|engineering)|compaction|memory|orchestrat\w*|workflows?|hooks?|sdk|coding agents?|autonom\w*|self[- ]improv\w*)\b/gi;
const NEAR = /\b(claude|fable|opus|sonnet|haiku|mythos|gpt[\w.-]*|gemini|llama|mistral|qwen|deepseek|model(s)?|benchmark(s)?|evals?|swe-?bench|leaderboard|reasoning|prompt\w*|api|release|changelog|open[- ]weights?|fine-?tun\w*|post-?training|rl\b|inference|latency|pricing|tokens?)\b/gi;
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** 0..1: how much a story speaks of the user's work. */
export function relevance(title: string, snippet: string): number {
  const t = `${title} ${title} ${snippet}`; // the title counts twice
  const core = count(CORE, t), near = count(NEAR, t);
  return Math.min(1, core * 0.22 + near * 0.08);
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

const SECTION_WORDS: [NewsSection, RegExp][] = [
  ['skills', /\b(skills?|mcp|model context protocol|agent skills|sub-?agents?|multi-agent|agent sdk|a2a)\b/i],
  ['harness', /\b(claude code|codex( cli)?|cursor|opencode|gemini cli|copilot|cli|ide|harness|changelog|release notes)\b/i],
  ['research', /\b(paper|arxiv|study|we (find|show)|interpretability|alignment|theorem|dataset)\b/i],
  ['models', /\b(model(s)?|benchmark(s)?|evals?|leaderboard|swe-?bench|open[- ]weights?|gpt[\w.-]*|gemini \d|llama|qwen|deepseek|fable|opus|sonnet|haiku|mythos|system card)\b/i],
];
/** The section a story's own words point to, else its source's. */
export function sectionOf(title: string, snippet: string, fallback: NewsSection): NewsSection {
  const t = `${title} ${snippet.slice(0, 160)}`;
  // a source's section wins over a weak word (a harness changelog that mentions a model stays a harness story)
  if (fallback === 'harness' || fallback === 'research') return fallback;
  return SECTION_WORDS.find(([, re]) => re.test(title))?.[0] ?? SECTION_WORDS.find(([, re]) => re.test(t))?.[0] ?? fallback;
}

/** Scores every story and sorts the paper: the best first; a story already read sinks a little, a saved one never. */
export function rank(items: readonly NewsItem[], sources: readonly NewsSource[], now: number): NewsItem[] {
  const byId = new Map(sources.map(s => [s.id, s]));
  return items.map(it => {
    const parts = {
      // a story whose date nobody gave (a page, its article had none) is not treated as new
      recency: it.undated ? UNDATED_RECENCY : recency(it.at, now),
      source: byId.get(it.source)?.weight ?? 0.5,
      // the AI pass's judgement (fit 0..3) weighs more than the words, once there is one
      relevance: it.fit !== undefined ? 0.35 * relevance(it.title, `${it.summary ?? ''} ${it.snippet}`) + 0.65 * (it.fit / 3) : relevance(it.title, `${it.summary ?? ''} ${it.snippet}`),
      echo: echo(it, byId),
    };
    const score = parts.recency * WEIGHTS.recency + parts.source * WEIGHTS.source + parts.relevance * WEIGHTS.relevance + parts.echo * WEIGHTS.echo;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return { ...it, rank: { recency: round(parts.recency), source: round(parts.source), relevance: round(parts.relevance), echo: round(parts.echo) }, score: round(score * (it.read && !it.saved ? 0.85 : 1)) };
  }).sort((a, b) => b.score - a.score || b.at - a.at);
}
