// Impara «News» (ADR 0265): the AI newspaper's shapes, shared by main (main/news/: fetch, parse, dedup, rank, the AI
// pass, the store) and the renderer (components/impara/news/). A source is read without tokens (a feed, a public API,
// GitHub releases or a page); the stories are deduplicated across sources, ranked by recency, source, relevance to the
// user and how many others picked them up, and the new ones get a short summary and «perché conta per te» from one AI
// pass, whose tokens are measured and shown. Only a title, a short summary and the link are kept, never the article.
// The «Le mie PR» section is the Task page's PRs (the learn-from-my-PRs flow of ADR 0185), drawn by the renderer.

/** The paper's sections; «prs» is drawn from the user's PRs, never from a source. */
export const NEWS_SECTIONS = ['models', 'harness', 'skills', 'research'] as const;
export type NewsSection = (typeof NEWS_SECTIONS)[number];
export const isNewsSection = (v: unknown): v is NewsSection => typeof v === 'string' && (NEWS_SECTIONS as readonly string[]).includes(v);

/** How a source is read: a feed (RSS or Atom), GitHub releases (Atom, prereleases dropped), Hugging Face Daily Papers
 *  (API, by votes), Hacker News (Algolia API, by points, AI words only), a page (its links and dates; a Markdown page
 *  by its dated headings). */
export const NEWS_READS = ['feed', 'github', 'hf-papers', 'hn', 'page'] as const;
export type NewsRead = (typeof NEWS_READS)[number];

export interface NewsSource {
  id: string;
  name: string;
  /** https only */
  url: string;
  read: NewsRead;
  /** where its stories go when the AI pass and the words say nothing else */
  section: NewsSection;
  /** 0..1: how much a story from it weighs (a lab's own post > a newsletter) */
  weight: number;
  /** a primary source (the lab, the project, the researcher), not an aggregator: wins the deduplication */
  primary: boolean;
  on: boolean;
  /** shipped with the app (ADR 0265's list) rather than added by the user */
  builtin: boolean;
  /** page: a regular expression a link's path must match (default: any link under the page's own path) */
  match?: string;
  /** hn: minimum points; hf-papers: minimum votes */
  min?: number;
}

/** A source's last reading, shown in «Fonti». */
export interface NewsSourceStatus {
  at: number;
  ok: boolean;
  /** short, in the user's words (HTTP 429, not a feed, …) */
  error?: string;
  /** stories read, and how many of them were new */
  found: number;
  fresh: number;
}

export interface NewsAlso { source: string; name: string; url: string }

export interface NewsItem {
  id: string;
  title: string;
  /** the primary link (always kept) */
  url: string;
  source: string;
  sourceName: string;
  /** published (ms); a page without dates gives the first time the app saw it, and `undated` */
  at: number;
  undated?: boolean;
  seenAt: number;
  /** a few words from the source (≤ 320 characters), only until the AI pass writes the summary */
  snippet: string;
  /** the AI pass: 2-3 sentences, and one sentence on why it matters to this user */
  summary?: string;
  why?: string;
  /** the AI pass: how much it matters to this user, 0 (not at all) to 3 (directly their work) */
  fit?: number;
  section: NewsSection;
  /** the same story elsewhere (merged by the deduplication) */
  also: NewsAlso[];
  /** points (HN) or votes (papers), when the source gives them */
  signal?: number;
  score: number;
  /** why it is where it is: each part 0..1 */
  rank: { recency: number; source: number; relevance: number; echo: number };
  read?: boolean;
  saved?: boolean;
  /** the lesson «Spiegamelo» started on it */
  lesson?: string;
}

/** One refresh: what it cost (tokens measured by the engine; null = the engine gave none) and what it brought. */
export interface NewsRefresh {
  at: number;
  durationMs: number;
  sources: number;
  failed: number;
  found: number;
  fresh: number;
  merged: number;
  summarized: number;
  tokens: number | null;
  costUsd: number | null;
  /** the AI pass did not run or failed: why */
  aiError?: string;
}

export interface NewsSchedule { on: boolean; hour: number }

export interface NewsProgress { phase: 'fetch' | 'merge' | 'summarize'; done: number; total: number }

export interface NewsState {
  items: NewsItem[];
  sources: (NewsSource & { status?: NewsSourceStatus })[];
  last: NewsRefresh | null;
  progress: NewsProgress | null;
  schedule: NewsSchedule;
  /** the expected cost of one refresh: the mean of the last ones, else a guess from the stories per refresh */
  estimate: { tokens: number; usd: number | null; measured: boolean };
  /** why the AI pass cannot run now (no Claude on), or null */
  noAi: string | null;
}

/** renderer → main */
export type NewsMark = { id: string; read?: boolean; saved?: boolean; lesson?: string };
export type NewsSourceEdit =
  | { op: 'add'; url: string; name?: string }
  | { op: 'remove'; id: string }
  | { op: 'toggle'; id: string; on: boolean }
  | { op: 'reset' };

/** Keep at most this many stories (the saved ones never drop); older than this many days drop too. */
export const NEWS_KEEP = 400;
export const NEWS_KEEP_DAYS = 30;
/** At most this many new stories go to one AI pass (the best ranked). */
export const NEWS_SUMMARY_MAX = 30;
export const SNIPPET_MAX = 320;

/** A url the app may keep and open: http(s), no credentials. */
export function safeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}
