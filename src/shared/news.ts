// The «Giornale» (ADR 0265, by editions since ADR 0280): the newspaper's shapes, shared by main (main/news/: fetch,
// parse, dedup, rank, the AI pass, the store), the renderer (components/impara/news/) and the Orchestrator's tools
// (main/appctl/news.ts). An EDITION is one subject the user follows («AI per chi costruisce agenti», «Auto
// elettriche»): a name, one sentence on what interests them, its own sources, sections and key words. A source is
// read without tokens (a feed, a public API, GitHub releases or a page); the stories are deduplicated across the
// edition's sources, ranked by recency, source, relevance to the user's sentence and how many others picked them up,
// and the best new ones get a short summary and «perché conta per te» from one AI pass per edition, whose tokens are
// measured and shown. The front page holds a few stories only (the edition's cap); the rest wait under «Altre». Only
// a title, a short summary and the link are kept, never the article.

/** One section of an edition: a short id, the name shown, and the words that send a story there. */
export interface NewsSectionDef { id: string; name: string; words: string[] }

/** One subject the user follows. */
export interface NewsEdition {
  id: string;
  name: string;
  /** one sentence in the user's words: what they want from this paper (the AI pass reads it; the key words come from it) */
  interest: string;
  sections: NewsSectionDef[];
  /** key words of the subject, by strength: `core` is the heart of the interest, `near` its surroundings. Plain words,
   *  matched whole (with a short ending: «agent» matches «agents»), at zero tokens. */
  core: string[];
  near: string[];
  /** how many stories the front page holds (NEWS_FRONT_CAP by default) */
  cap: number;
  /** made from one of the app's ready-made editions (its default sources can be restored) */
  template?: string;
  createdAt: number;
}

/** The first edition's id, and the id an older single-paper state is migrated to (its stories keep their ids). */
export const NEWS_AI_EDITION = 'ai';
export const NEWS_FRONT_CAP = 7;
export const NEWS_FRONT_DAYS = 7;
/** the front page's rule in words, for the Orchestrator's tool text */
export const FRONT_NOTE = `${NEWS_FRONT_CAP} by default, the best of the last ${NEWS_FRONT_DAYS} days, the rest wait under «Altre»`;
export const NEWS_EDITIONS_MAX = 12;
export const NEWS_SECTIONS_MAX = 8;
export const NEWS_WORDS_MAX = 60;

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
  /** the edition it belongs to */
  edition: string;
  /** where its stories go when the AI pass and the words say nothing else: a section id of its edition, or '' */
  section: string;
  /** its own section wins over a story's words (a changelog that names a model stays a tool story) */
  pin?: boolean;
  /** 0..1: how much a story from it weighs (a lab's own post > a newsletter) */
  weight: number;
  /** a primary source (the lab, the project, the researcher), not an aggregator: wins the deduplication */
  primary: boolean;
  on: boolean;
  /** part of a ready-made edition's list (ADR 0265's sources for «AI») rather than added by the user or the Orchestrator */
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
  edition: string;
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
  /** a section id of its edition, or '' */
  section: string;
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
  /** «Meno così»: the user does not want stories like this one; it leaves every list and its source weighs a little less */
  less?: boolean;
}

/** One refresh: what it cost (tokens measured by the engine; null = the engine gave none) and what it brought. */
export interface NewsRefresh {
  at: number;
  /** the edition it refreshed; absent = every edition (and the refreshes of the single paper before ADR 0280) */
  edition?: string;
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
  /** the user's editions, in their order; none on a clean install */
  editions: NewsEdition[];
  /** the ready-made editions the app offers (id and name), to start from */
  templates: { id: string; name: string; interest: string; sources: number }[];
  items: NewsItem[];
  sources: (NewsSource & { status?: NewsSourceStatus })[];
  last: NewsRefresh | null;
  /** each edition's last refresh (its own, or the last one of every edition) */
  lastBy: Record<string, NewsRefresh>;
  progress: NewsProgress | null;
  schedule: NewsSchedule;
  /** the expected cost of one refresh: the mean of the last ones, else a guess from the stories per refresh */
  estimate: { tokens: number; usd: number | null; measured: boolean };
  /** why the AI pass cannot run now (no Claude on), or null */
  noAi: string | null;
}

/** renderer → main */
export type NewsMark = { id: string; read?: boolean; saved?: boolean; lesson?: string; less?: boolean };
export type NewsSourceEdit =
  | { op: 'add'; edition: string; url: string; name?: string; section?: string; weight?: number; primary?: boolean; pin?: boolean }
  | { op: 'remove'; id: string }
  | { op: 'toggle'; id: string; on: boolean }
  | { op: 'reset'; edition: string };
export interface NewsEditionFields { name?: string; interest?: string; sections?: { id?: string; name: string; words?: string[] }[]; core?: string[]; near?: string[]; cap?: number }
export type NewsEditionEdit =
  | ({ op: 'create'; name: string; template?: string } & NewsEditionFields)
  | ({ op: 'update'; id: string } & NewsEditionFields)
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; to: number };
/** A source tried without being added: how it would be read and what it holds now. */
export interface NewsSourceTest { ok: boolean; url: string; read: NewsRead; found: number; newest: number | null; sample: string[]; error?: string }

/** Keep at most this many stories (the saved ones never drop); older than this many days drop too. */
export const NEWS_KEEP = 400;
export const NEWS_KEEP_DAYS = 30;
/** At most this many new stories of one edition go to its AI pass (the best ranked): the front page twice over. */
export const NEWS_SUMMARY_MAX = 14;
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

/** What the front page of an edition holds: the best `cap` stories of the last days (never one the AI pass judged
 *  irrelevant, never one the user dismissed), the first being the opening story; `more` is everything else still
 *  recent, in the same order. `items` is already sorted, best first. */
export function frontPage(items: readonly NewsItem[], cap: number, now: number): { front: NewsItem[]; more: NewsItem[] } {
  const since = now - NEWS_FRONT_DAYS * 86_400_000;
  const recent = items.filter(i => !i.less && i.at >= since);
  const good = recent.filter(i => i.fit !== 0);
  const front = good.slice(0, Math.max(1, cap));
  const chosen = new Set(front.map(i => i.id));
  return { front, more: recent.filter(i => !chosen.has(i.id)) };
}

/** A key word as a pattern: whole word, any case, with a short ending («agent» → «agents», «agentic»). */
export function wordPattern(words: readonly string[]): RegExp | null {
  const clean = words.map(w => w.trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 40);
  if (!clean.length) return null;
  const esc = clean.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join('|')})[\\p{L}\\p{N}]{0,3}(?![\\p{L}\\p{N}])`, 'giu');
}

const INTEREST_STOP = new Set(['che', 'chi', 'cosa', 'come', 'quando', 'dove', 'per', 'con', 'del', 'della', 'dei', 'delle', 'degli', 'nel', 'nella', 'sul', 'sulla', 'alla', 'alle', 'agli', 'una', 'uno', 'gli', 'non', 'più', 'meno', 'solo', 'anche', 'mio', 'mia', 'miei', 'mie', 'sono', 'voglio', 'vorrei', 'interessa', 'interessano', 'davvero', 'tutto', 'tutti', 'tutte', 'ogni', 'the', 'and', 'for', 'with', 'what', 'when', 'that', 'this', 'from', 'about', 'want', 'only', 'really', 'more', 'less', 'und', 'der', 'die', 'das', 'mit', 'für', 'was', 'wie', 'ich', 'nicht', 'nuove', 'nuovi', 'nuovo', 'nuova', 'new', 'news', 'notizie', 'novità', 'sapere', 'know', 'cambia', 'cambiano']);
/** Key words read from the user's own sentence and the edition's name, at zero tokens: every meaningful word, the
 *  name's first (they are the heart). Used when nobody gave the words (the Orchestrator gives better ones). */
export function wordsFromInterest(name: string, interest: string): { core: string[]; near: string[] } {
  const pick = (s: string) => [...new Set((s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? []).filter(w => !INTEREST_STOP.has(w)))];
  const core = pick(name).slice(0, 12);
  const near = pick(interest).filter(w => !core.includes(w)).slice(0, 30);
  return { core, near };
}
