// The «Giornale» in main (ADR 0265, editions ADR 0280): keeps the user's newspaper, one EDITION per subject they follow.
// A refresh («Aggiorna», the Orchestrator's app_news_refresh, or the optional daily one) reads every source that is on,
// at zero tokens and at most 6 at a time (fetch with a deadline and a size cap, through the app's own network like
// every other main-process request), parses it (parse.ts), dates a page's new stories from their own article when the
// page lists none; then, edition by edition, merges the same story across its sources (dedup.ts), ranks its paper
// against its key words (rank.ts) and sends its best stories without a summary to ONE AI pass (summarize.ts, a hidden
// run with no tool), whose tokens and cost are measured from the engine's own report. Editions, their sources and
// sections are edited here (the «Fonti» panel, the new-edition form and the Orchestrator's tools all call the same
// methods); a source can be tried before it is added. The state (editions, sources, their last reading, stories, the
// last refreshes) is one JSON file in userData/news, written atomically; only titles, short summaries and links are
// kept. A clean install has no edition. The daily refresh is off by default (it costs tokens).
// Wired in wiring-builders.ts (buildNews) and demo-wiring.ts; IPC news:* in ipc-handlers/media.ts; the Orchestrator's
// tools in appctl/news.ts; tests: test/unit/news-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Lang } from '@shared/contract';
import {
  NEWS_AI_EDITION, NEWS_EDITIONS_MAX, NEWS_FRONT_CAP, NEWS_KEEP, NEWS_KEEP_DAYS, NEWS_SECTIONS_MAX, NEWS_SUMMARY_MAX, NEWS_WORDS_MAX, safeUrl, wordsFromInterest,
  type NewsEdition, type NewsEditionEdit, type NewsEditionFields, type NewsItem, type NewsMark, type NewsProgress, type NewsRefresh, type NewsSchedule, type NewsSectionDef, type NewsSource, type NewsSourceEdit, type NewsSourceStatus, type NewsSourceTest, type NewsState,
} from '@shared/news';
import { articleDate, parseFeed, parseGithub, parseHfPapers, parseHn, parseMarkdownDated, parsePage, sniff, type RawStory } from './parse';
import { canonicalUrl, dedupe } from './dedup';
import { rank, sectionOf } from './rank';
import { guessTokens, parseSummaries, summaryPrompt } from './summarize';
import { NEWS_TEMPLATES, editionFromTemplate, sourceFromUrl, templateOf } from './sources';

export interface NewsResponse { status: number; contentType: string; text: string }
/** One GET: the status, the content type and the body (already capped). */
export type NewsFetch = (url: string, opts?: { follow?: boolean }) => Promise<NewsResponse>;
export type NewsAi = (prompt: string) => Promise<{ ok: true; text: string; tokens: number | null; costUsd: number | null } | { ok: false; error: string }>;

export interface NewsDeps {
  dir: string;
  fetch: NewsFetch;
  /** the AI pass (a hidden run with no tool) */
  ai: NewsAi;
  /** why the AI pass cannot run now, or null */
  noAi: () => string | null;
  lang: () => Lang;
  changed: (state: NewsState) => void;
  now?: () => number;
  /** the daily refresh's clock (fake timers in the tests) */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

interface Saved {
  v: 2;
  editions: NewsEdition[];
  sources: NewsSource[];
  status: Record<string, NewsSourceStatus>;
  items: NewsItem[];
  history: NewsRefresh[];
  schedule: NewsSchedule;
  /** the day (YYYY-MM-DD, local) of the last daily refresh */
  autoDay?: string;
  /** default sources the user removed: a newer default list does not bring them back */
  removed?: string[];
  /** links seen but not kept (a first reading's undated archive, stories aged out or trimmed): never new again */
  seen?: string[];
  /** sources read successfully at least once: a later failure does not make the next reading a «first» one */
  everRead?: string[];
}

const MAX_BODY = 4_000_000;
const PER_SOURCE = 40;
const DATE_LOOKUPS = 8;
const FIRST_LOOKUPS = 24;
const PARALLEL = 6;
const SUMMARY_DAYS = 14;
const DAY = 86_400_000;
const CHECK_MS = 15 * 60_000;
const SEEN_MAX = 8000;
const HISTORY_MAX = 60;
const LESS_STEP = 0.05;

/** The app's GET: a deadline, the body capped, a plain client name (never the user's). Redirects are followed by hand,
 *  at most 5, and only to a public https link: a public source could otherwise point the app at the LAN. */
export const netFetch: NewsFetch = async (url, opts) => {
  let at = url;
  for (let hop = 0; ; hop++) {
    const r = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'second-brain-news/1.0 (+https://github.com/lampi1/second-brain)', Accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/markdown, text/html;q=0.9, */*;q=0.5' } });
    const to = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    // an article looked up for its date is never followed
    if (to && opts?.follow !== false) {
      const next = new URL(to, at).toString();
      if (hop >= 5 || !publicHttps(next)) throw new Error('rimando non seguito: non porta a un link https pubblico');
      at = next;
      continue;
    }
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) throw new Error('pagina troppo grande');
    const text = await r.text();
    return { status: r.status, contentType: r.headers.get('content-type') ?? '', text: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text };
  }
};

/** Whether a link may be fetched for its date: https on a public host (never loopback, the LAN or link-local). */
export function publicHttps(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, ''); // «localhost.» is localhost
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa') || !h.includes('.') && !h.includes(':')) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|198\.1[89]\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
    if (h.includes(':') && (h === '::1' || h === '::' || /^(f[cd]|fe[89a-f])/.test(h) || h.startsWith('::ffff:') || h.startsWith('64:ff9b:'))) return false;
    return true;
  } catch { return false; }
}
/** A story's id: its canonical link within its edition (the first edition keeps the ids of the single paper it came from). */
const idOf = (url: string, edition: string) => createHash('sha1').update((edition === NEWS_AI_EDITION ? '' : `${edition}\n`) + canonicalUrl(url)).digest('hex').slice(0, 12);
const slug = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const wordList = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.map(w => line(w, 40).toLowerCase()).filter(w => w.length >= 2))].slice(0, max) : []);
const sumOrNull = (xs: (number | null)[]) => (xs.some(x => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A short, user-facing reason for a failed reading (never a stack). */
export function why(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/timeout|aborted/i.test(m)) return 'nessuna risposta in 20 secondi';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return 'sito non raggiungibile';
  if (/fetch failed|ECONNREFUSED|ECONNRESET/i.test(m)) return 'connessione non riuscita';
  return m.slice(0, 120);
}
/** A title that is only a version («2.1.322», «v0.9.1») says which product it is. */
const product = (s: NewsSource) => s.name.replace(/\s*\((GitHub|changelog)\)\s*$/i, '').replace(/\s+(Changelog|releases?|release notes)$/i, '');
const titled = (title: string, s: NewsSource) => (/^v?\d+(\.\d+)+\S*$/.test(title.trim()) ? `${product(s)} ${title.trim()}` : title);

export class NewsService {
  private s: Saved;
  private running: Promise<NewsRefresh> | null = null;
  /** the edition the running refresh reads (undefined = all) */
  private runningFor: string | undefined;
  private progress: NewsProgress | null = null;
  private timer: unknown = null;
  private readonly file: string;
  constructor(private readonly d: NewsDeps) {
    this.file = path.join(d.dir, 'state.json');
    this.s = this.load();
    this.arm();
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  private load(): Saved {
    const fresh: Saved = { v: 2, editions: [], sources: [], status: {}, items: [], history: [], schedule: { on: false, hour: 7 } };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Omit<Saved, 'v'>> & { v?: number };
      if (!Array.isArray(raw.sources) || !Array.isArray(raw.items)) return fresh;
      const removed = new Set(Array.isArray(raw.removed) ? raw.removed : []);
      let editions: NewsEdition[], sources = raw.sources, items = raw.items;
      if (raw.v === 1) {
        // the single AI paper of ADR 0265 becomes the first edition: its sources, stories and marks stay as they are
        const t = templateOf(NEWS_AI_EDITION)!;
        const pinned = new Set(t.sources.filter(x => x.pin).map(x => x.id));
        editions = [editionFromTemplate(t, this.d.lang(), this.now())];
        sources = sources.map(x => ({ ...x, edition: NEWS_AI_EDITION, ...(x.builtin && pinned.has(x.id) ? { pin: true } : {}) }));
        items = items.map(i => ({ ...i, edition: NEWS_AI_EDITION }));
      } else if (raw.v === 2 && Array.isArray(raw.editions)) editions = raw.editions;
      else return fresh;
      // a source added to a template after the user's last start comes in (on), unless they removed it
      const have = new Set(sources.map(x => x.id));
      for (const e of editions) {
        const t = templateOf(e.template);
        if (t) sources = [...sources, ...t.sources.filter(x => !have.has(x.id) && !removed.has(x.id)).map(x => ({ ...x, edition: e.id }))];
      }
      return { ...fresh, ...raw, v: 2, editions, sources, items, status: raw.status ?? {}, history: raw.history ?? [], schedule: raw.schedule ?? fresh.schedule };
    } catch { return fresh; }
  }

  private save(): void {
    fs.mkdirSync(this.d.dir, { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.s));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  private emit(): void { this.d.changed(this.state()); }

  state(): NewsState {
    // what one refresh of everything is expected to cost: each edition's mean of its last measured passes
    const per = this.s.editions.map(e => this.s.history.filter(h => h.edition === e.id && h.tokens !== null && h.summarized > 0).slice(-5));
    // the single paper's refreshes (before the editions) stand in for the first edition until it has its own
    const old = this.s.history.filter(h => !h.edition && h.tokens !== null && h.summarized > 0).slice(-5);
    const first = this.s.editions.findIndex(e => e.id === NEWS_AI_EDITION);
    if (first >= 0 && !per[first]!.length) per[first] = old;
    const groups = per.filter(g => g.length);
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    const estimate = groups.length
      ? { tokens: Math.round(groups.reduce((a, g) => a + mean(g.map(h => h.tokens!)), 0)), usd: groups.some(g => g.some(h => h.costUsd !== null)) ? groups.reduce((a, g) => { const u = g.filter(h => h.costUsd !== null).map(h => h.costUsd!); return a + (u.length ? mean(u) : 0); }, 0) : null, measured: true }
      : { tokens: guessTokens(NEWS_SUMMARY_MAX) * Math.max(1, this.s.editions.length), usd: null, measured: false };
    const mine = new Set(this.s.editions.map(e => e.template).filter(Boolean));
    return {
      editions: this.s.editions,
      templates: NEWS_TEMPLATES.filter(t => !mine.has(t.id) && !this.s.editions.some(e => e.id === t.id)).map(t => { const n = t.names[this.d.lang()] ?? t.names.it; return { id: t.id, name: n.name, interest: n.interest, sources: t.sources.length }; }),
      items: this.s.items,
      sources: this.s.sources.map(s => ({ ...s, ...(this.s.status[s.id] ? { status: this.s.status[s.id] } : {}) })),
      last: this.s.history.at(-1) ?? null,
      lastBy: Object.fromEntries(this.s.editions.flatMap(e => { const h = this.s.history.findLast(x => x.edition === e.id || !x.edition); return h ? [[e.id, h]] : []; })),
      progress: this.progress,
      schedule: this.s.schedule,
      estimate,
      noAi: this.d.noAi(),
    };
  }

  private edition(id: string): NewsEdition {
    const e = this.s.editions.find(x => x.id === id);
    if (!e) throw new Error('edizione sconosciuta');
    return e;
  }

  /** One source's stories now (no AI). `lookups`: how many undated stories may be dated from their own article. */
  private async read(src: NewsSource, known: ReadonlySet<string>, firstRead: boolean, lookupsMax = firstRead ? FIRST_LOOKUPS : DATE_LOOKUPS): Promise<{ stories: RawStory[]; dropped: string[] }> {
    const r = await this.d.fetch(src.url);
    if (r.status === 429) throw new Error('HTTP 429: troppe richieste, riprovo al prossimo aggiornamento');
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    let stories: RawStory[];
    let page = false;
    if (src.read === 'hf-papers') stories = parseHfPapers(JSON.parse(r.text), src.min ?? 25);
    else if (src.read === 'hn') stories = parseHn(JSON.parse(r.text), src.min ?? 150);
    else if (src.read === 'github') stories = parseGithub(r.text, src.url);
    else {
      const kind = sniff(r.text, r.contentType, src.url);
      // a template's feed that stops being a feed is an error to see; a pasted link guessed as a feed is simply a page
      if (src.read === 'feed' && kind !== 'feed') { if (src.builtin) throw new Error('non è un feed RSS o Atom'); src.read = 'page'; }
      else if (src.read === 'page' && kind === 'feed' && !src.builtin) src.read = 'feed';
      page = kind !== 'feed';
      stories = kind === 'feed' ? parseFeed(r.text, src.url) : kind === 'md' ? parseMarkdownDated(r.text, src.url) : parsePage(r.text, src.url, src.match);
    }
    // an empty feed is just a quiet source; a page with no story means its layout changed
    if (!stories.length && page) throw new Error('nessuna storia trovata nella pagina');
    // the newest first (a feed may be in any order); undated stories keep the page's order
    const dated = stories.filter(s => s.at !== null).sort((a, b) => b.at! - a.at!);
    const undated = stories.filter(s => s.at === null);
    const out = [...dated, ...undated].slice(0, PER_SOURCE);
    // a page that lists no dates: its NEW stories are dated from their own article (zero tokens, a few requests)
    let lookups = 0;
    for (const s of out) {
      if (s.at !== null || known.has(idOf(s.url, src.edition)) || !publicHttps(s.url) || lookups >= lookupsMax) continue;
      lookups++;
      try { const a = await this.d.fetch(s.url, { follow: false }); if (a.status >= 200 && a.status < 300) s.at = articleDate(a.text); } catch { /* stays undated */ }
    }
    // on a source's first reading a story still without a date is most likely old (pages list their archive too):
    // it is left out rather than shown as new; later, a link that was not there before is new, dated when first seen
    // (remembered as seen, so the next reading does not take that archive for new)
    const dropped = out.filter(s => firstRead && s.at === null).map(s => idOf(s.url, src.edition));
    return { stories: out.filter(s => !firstRead || s.at !== null).map(s => ({ ...s, title: titled(s.title, src) })), dropped };
  }

  /** A source tried without adding it: how it would be read, how many stories it holds now, the newest three titles.
   *  Zero tokens, one request (a page's undated stories are not looked up). */
  async testSource(rawUrl: string): Promise<NewsSourceTest> {
    const url = safeUrl(rawUrl);
    if (!url || !publicHttps(url)) return { ok: false, url: rawUrl, read: 'page', found: 0, newest: null, sample: [], error: 'Serve un link https pubblico.' };
    const src: NewsSource = { id: 'test', edition: 'test', ...sourceFromUrl(url) };
    try {
      const { stories } = await this.read(src, new Set(), false, 0);
      const dated = stories.filter(s => s.at !== null);
      return { ok: true, url: src.url, read: src.read, found: stories.length, newest: dated.length ? Math.max(...dated.map(s => s.at!)) : null, sample: stories.slice(0, 3).map(s => s.title) };
    } catch (e) { return { ok: false, url: src.url, read: src.read, found: 0, newest: null, sample: [], error: why(e) }; }
  }

  /** «Aggiorna»: read, merge, rank, summarize; one edition or all. One at a time: a second call joins the running one. */
  refresh(edition?: string): Promise<NewsRefresh> {
    if (edition !== undefined) this.edition(edition);
    // a call for another edition waits for the running one, then reads its own
    if (this.running && this.runningFor !== undefined && this.runningFor !== edition) return this.running.then(() => this.refresh(edition), () => this.refresh(edition));
    if (!this.running) {
      this.runningFor = edition;
      this.running = this.doRefresh(edition).finally(() => { this.running = null; this.progress = null; this.emit(); });
    }
    return this.running;
  }

  private async doRefresh(only?: string): Promise<NewsRefresh> {
    const t0 = this.now();
    const eds = this.s.editions.filter(e => !only || e.id === only).map(e => e.id);
    const on = this.s.sources.filter(s => s.on && eds.includes(s.edition));
    const known = new Set([...this.s.items.flatMap(i => [i.id, ...i.also.map(a => idOf(a.url, i.edition))]), ...(this.s.seen ?? [])]);
    const dropped: string[] = [];
    const stillThere = (id: string) => this.s.sources.some(x => x.id === id);
    this.progress = { phase: 'fetch', done: 0, total: on.length };
    this.emit();
    const got: { src: NewsSource; stories: RawStory[] }[] = [];
    const failedBy = new Map<string, number>(), foundBy = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
    const queue = [...on];
    const worker = async () => {
      for (let src = queue.shift(); src; src = queue.shift()) {
        const at = this.now();
        try {
          const r = await this.read(src, known, !this.s.status[src.id]?.ok && !(this.s.everRead ?? []).includes(src.id));
          // a source removed while it was being read leaves no trace
          if (!stillThere(src.id)) continue;
          const stories = r.stories;
          dropped.push(...r.dropped);
          if (!(this.s.everRead ?? []).includes(src.id)) this.s.everRead = [...(this.s.everRead ?? []), src.id];
          const fresh = stories.filter(x => !known.has(idOf(x.url, src.edition))).length;
          this.s.status[src.id] = { at, ok: true, found: stories.length, fresh };
          got.push({ src, stories });
          bump(foundBy, src.edition, stories.length);
        } catch (e) {
          bump(failedBy, src.edition, 1);
          if (stillThere(src.id)) this.s.status[src.id] = { at, ok: false, error: why(e), found: 0, fresh: 0 };
        } finally {
          this.progress = { phase: 'fetch', done: (this.progress?.done ?? 0) + 1, total: on.length };
          this.emit();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, on.length) }, worker));

    this.progress = { phase: 'merge', done: 0, total: 1 };
    this.emit();
    const parts: NewsRefresh[] = [];
    for (const id of eds) {
      // an edition deleted while its sources were being read leaves no trace
      const ed = this.s.editions.find(e => e.id === id);
      if (!ed) continue;
      parts.push(await this.refreshEdition(ed, got.filter(g => g.src.edition === id), known, dropped, { t0, sources: on.filter(s => s.edition === id).length, failed: failedBy.get(id) ?? 0, found: foundBy.get(id) ?? 0 }));
    }
    this.s.history = [...this.s.history, ...parts].slice(-HISTORY_MAX);
    this.save();
    const sum = (f: (p: NewsRefresh) => number) => parts.reduce((a, p) => a + f(p), 0);
    const errors = [...new Set(parts.map(p => p.aiError).filter((e): e is string => !!e))];
    return {
      at: t0, ...(only ? { edition: only } : {}), durationMs: this.now() - t0, sources: on.length, failed: sum(p => p.failed), found: sum(p => p.found), fresh: sum(p => p.fresh), merged: sum(p => p.merged), summarized: sum(p => p.summarized),
      tokens: sumOrNull(parts.map(p => p.tokens)), costUsd: sumOrNull(parts.map(p => p.costUsd)), ...(errors.length ? { aiError: errors.join(' · ') } : {}),
    };
  }

  /** One edition's part of a refresh: its new stories, the merge, the ranking and its AI pass. */
  private async refreshEdition(ed: NewsEdition, got: { src: NewsSource; stories: RawStory[] }[], known: Set<string>, dropped: readonly string[], n: { t0: number; sources: number; failed: number; found: number }): Promise<NewsRefresh> {
    const idIn = (url: string) => idOf(url, ed.id);
    const mine = () => this.s.items.filter(i => i.edition === ed.id);
    const sources = this.s.sources.filter(s => s.edition === ed.id);
    // new stories (unknown links, not too old); a known one only refreshes its points or votes
    const now = this.now();
    const oldest = now - NEWS_KEEP_DAYS * DAY;
    const before = mine();
    const byId = new Map(before.map(i => [i.id, i]));
    const fresh: NewsItem[] = [];
    const freshById = new Map<string, NewsItem>();
    // sources in their list order, so the deduplication meets the primary ones first
    got.sort((a, b) => this.s.sources.indexOf(a.src) - this.s.sources.indexOf(b.src));
    for (const { src, stories } of got) {
      stories.forEach(st => {
        const id = idIn(st.url);
        const had = byId.get(id);
        if (had) { if (st.signal !== undefined) had.signal = st.signal; return; }
        // the same link from a second source in this refresh: an echo of the first (Hacker News linking the lab's post)
        const twin = freshById.get(id);
        if (twin) {
          if (twin.source !== src.id && !twin.also.some(a => a.source === src.id)) twin.also.push({ source: src.id, name: src.name, url: st.discuss ?? st.url });
          if (st.signal !== undefined) twin.signal = Math.max(twin.signal ?? 0, st.signal);
          return;
        }
        if (known.has(id)) return;
        const at = st.at ?? now;
        if (at < oldest) return;
        fresh.push({
          // a link site's story is the linked page's: it is named by that site (the primary), the link site stays its source
          id, edition: ed.id, title: st.title, url: st.url, source: src.id, sourceName: src.read === 'hn' ? `${new URL(st.url).hostname.replace(/^www\./, '')} · ${src.name}` : src.name, at: Math.min(at, now), ...(st.at === null ? { undated: true } : {}), seenAt: now,
          snippet: st.snippet, section: sectionOf(st.title, st.snippet, src, ed), also: [], ...(st.signal !== undefined ? { signal: st.signal } : {}), score: 0, rank: { recency: 0, source: 0, relevance: 0, echo: 0 },
        });
        freshById.set(id, fresh.at(-1)!);
        known.add(id);
      });
    }
    const kept = before.filter(i => i.saved || i.at >= oldest);
    const { items: merged, merged: mergedN } = dedupe([...kept, ...fresh], sources);
    let items = rank(merged, sources, now, ed);

    // the AI pass: the best stories without a summary, recent enough to matter (never one the user dismissed)
    let tokens: number | null = null, costUsd: number | null = null, summarized = 0, aiError: string | undefined;
    const todo = items.filter(i => !i.summary && !i.less && i.at >= now - SUMMARY_DAYS * DAY).slice(0, Math.max(NEWS_SUMMARY_MAX, ed.cap * 2));
    const noAi = this.d.noAi();
    if (todo.length && noAi) aiError = noAi;
    else if (todo.length) {
      this.progress = { phase: 'summarize', done: 0, total: todo.length };
      this.emit();
      const fence = `STORIES-${randomBytes(6).toString('hex')}`;
      try {
        const r = await this.d.ai(summaryPrompt(todo, this.d.lang(), fence, ed));
        if (!r.ok) aiError = r.error;
        else {
          tokens = r.tokens; costUsd = r.costUsd;
          const out = new Map(parseSummaries(r.text, todo.map(i => i.id), ed.sections.map(s => s.id)).map(o => [o.id, o]));
          summarized = out.size;
          items = rank(items.map(i => { const o = out.get(i.id); return o ? { ...i, summary: o.summary, why: o.why, ...(o.fit !== undefined ? { fit: o.fit } : {}), section: o.section ?? i.section, snippet: '' } : i; }), sources, now, ed);
        }
      } catch (e) { aiError = why(e); }
    }
    // the edition was deleted while its AI pass ran: nothing of it is kept
    if (!this.s.editions.some(e => e.id === ed.id)) return { at: n.t0, edition: ed.id, durationMs: this.now() - n.t0, sources: n.sources, failed: n.failed, found: n.found, fresh: 0, merged: 0, summarized: 0, tokens, costUsd };
    // what the user did while this refresh ran (read, saved, a lesson, «meno così») is on the current stories: carry it over
    const now2 = new Map(mine().map(i => [i.id, i]));
    // (also from a story this refresh merged into another one: its link is now one of the «also» links)
    items = items.map(i => {
      const cs = [i.id, ...i.also.map(a => idIn(a.url))].map(id => now2.get(id)).filter((c): c is NewsItem => !!c);
      if (!cs.length) return i;
      const lesson = cs.find(c => c.id === i.id)?.lesson ?? cs.find(c => c.lesson)?.lesson;
      return { ...i, read: cs.some(c => c.read) || undefined, saved: cs.some(c => c.saved) || undefined, ...(lesson ? { lesson } : {}), ...(now2.get(i.id)?.less ? { less: true } : {}) };
    });
    // a story saved (or given a lesson) while the AI pass ran stays, even past the days the paper keeps
    const ids2 = new Set(items.map(i => i.id));
    for (const c of now2.values()) if ((c.saved || c.lesson) && !ids2.has(c.id)) items.push(c);
    const final = this.trim(items);
    // a story that leaves the paper (aged out, trimmed) and a first reading's undated archive stay known
    const keptIds = new Set(final.flatMap(i => [i.id, ...i.also.map(a => idIn(a.url))]));
    const gone = [...before, ...items].flatMap(i => [i.id, ...i.also.map(a => idIn(a.url))]).filter(id => !keptIds.has(id));
    this.s.seen = [...new Set([...(this.s.seen ?? []), ...dropped, ...gone])].filter(id => !keptIds.has(id)).slice(-SEEN_MAX);
    this.s.items = [...this.s.items.filter(i => i.edition !== ed.id), ...final];
    return { at: n.t0, edition: ed.id, durationMs: this.now() - n.t0, sources: n.sources, failed: n.failed, found: n.found, fresh: fresh.length, merged: mergedN, summarized, tokens, costUsd, ...(aiError ? { aiError } : {}) };
  }

  /** At most NEWS_KEEP stories per edition: the saved ones always, then the best. */
  private trim(items: NewsItem[]): NewsItem[] {
    if (items.length <= NEWS_KEEP) return items;
    const saved = items.filter(i => i.saved);
    const rest = items.filter(i => !i.saved).slice(0, Math.max(0, NEWS_KEEP - saved.length));
    const keep = new Set([...saved, ...rest].map(i => i.id));
    return items.filter(i => keep.has(i.id));
  }

  /** Read or unread, saved for later, the lesson «Impara» started, «meno così» (and its undo). */
  mark(m: NewsMark): NewsState {
    const it = this.s.items.find(i => i.id === m.id);
    if (!it) throw new Error('notizia sconosciuta');
    if (typeof m.read === 'boolean') it.read = m.read;
    if (typeof m.saved === 'boolean') it.saved = m.saved;
    if (typeof m.lesson === 'string' && /^[\w-]{1,40}$/.test(m.lesson)) it.lesson = m.lesson;
    if (typeof m.less === 'boolean' && m.less !== !!it.less) {
      // the story leaves every list, and its source weighs a little less from the next ranking on (the undo gives it back)
      if (m.less) it.less = true; else delete it.less;
      const src = this.s.sources.find(s => s.id === it.source);
      if (src) src.weight = Math.round(Math.max(0.2, Math.min(1, src.weight + (m.less ? -LESS_STEP : LESS_STEP))) * 100) / 100;
    }
    this.save();
    this.emit();
    return this.state();
  }

  /** An edition's sections, cleaned: a short unique id each, a name, its words. */
  private sections(raw: NewsEditionFields['sections'], had: readonly NewsSectionDef[] = []): NewsSectionDef[] {
    const out: NewsSectionDef[] = [];
    for (const r of (Array.isArray(raw) ? raw : []).slice(0, NEWS_SECTIONS_MAX)) {
      const name = line(r?.name, 40);
      if (!name) continue;
      // a section keeps its id when it is named by it or still has its name: sources and stories point at the id
      const base = (typeof r.id === 'string' && had.some(h => h.id === r.id) ? r.id : had.find(h => h.name.toLowerCase() === name.toLowerCase())?.id ?? slug(name)) || `s${out.length + 1}`;
      let id = base;
      for (let k = 2; out.some(o => o.id === id); k++) id = `${base}-${k}`;
      const words = wordList(r.words, 30);
      out.push({ id, name, words: words.length ? words : wordList(name.split(/\s+/), 6) });
    }
    return out;
  }

  /** Editions: create (empty, with the given sections and words, or from a ready-made one), change, delete, reorder. */
  editEdition(e: NewsEditionEdit): NewsState {
    const now = this.now();
    if (e.op === 'create') {
      if (this.s.editions.length >= NEWS_EDITIONS_MAX) throw new Error(`Al massimo ${NEWS_EDITIONS_MAX} edizioni: eliminane una prima.`);
      const t = e.template !== undefined ? templateOf(e.template) : undefined;
      if (e.template !== undefined && !t) throw new Error('modello di edizione sconosciuto');
      let ed: NewsEdition;
      if (t) {
        if (this.s.editions.some(x => x.id === t.id || x.template === t.id)) throw new Error('Questa edizione c\'è già.');
        ed = editionFromTemplate(t, this.d.lang(), now);
        const removed = new Set(this.s.removed ?? []);
        for (const x of t.sources) removed.delete(x.id);
        this.s.removed = [...removed];
        this.s.sources = [...this.s.sources.filter(x => !t.sources.some(y => y.id === x.id)), ...t.sources.map(x => ({ ...x, edition: ed.id }))];
      } else {
        const name = line(e.name, 60);
        if (!name) throw new Error('Serve un nome per l\'edizione.');
        if (this.s.editions.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new Error('C\'è già un\'edizione con questo nome.');
        const base = slug(name) || 'edizione';
        let id = base === NEWS_AI_EDITION ? `${base}-2` : base;
        for (let k = 2; this.s.editions.some(x => x.id === id) || templateOf(id); k++) id = `${base}-${k}`;
        const interest = line(e.interest, 400);
        const auto = wordsFromInterest(name, interest);
        const core = wordList(e.core, NEWS_WORDS_MAX), near = wordList(e.near, NEWS_WORDS_MAX);
        ed = { id, name, interest, sections: this.sections(e.sections), core: core.length ? core : auto.core, near: near.length ? near : auto.near, cap: this.cap(e.cap), createdAt: now };
      }
      this.s.editions = [...this.s.editions, ed];
    } else if (e.op === 'update') {
      const had = this.edition(e.id);
      const name = e.name !== undefined ? line(e.name, 60) : had.name;
      if (!name) throw new Error('Serve un nome per l\'edizione.');
      if (this.s.editions.some(x => x !== had && x.name.toLowerCase() === name.toLowerCase())) throw new Error('C\'è già un\'edizione con questo nome.');
      const interest = e.interest !== undefined ? line(e.interest, 400) : had.interest;
      // words nobody gave follow the sentence when it changes (only if they were the app's own reading of the old one)
      const wasAuto = JSON.stringify(wordsFromInterest(had.name, had.interest)) === JSON.stringify({ core: had.core, near: had.near });
      const auto = wordsFromInterest(name, interest);
      const core = e.core !== undefined ? wordList(e.core, NEWS_WORDS_MAX) : wasAuto ? auto.core : had.core;
      const near = e.near !== undefined ? wordList(e.near, NEWS_WORDS_MAX) : wasAuto ? auto.near : had.near;
      // a new object: rank.ts keeps an edition's patterns by object
      const ed: NewsEdition = { ...had, name, interest, core, near, sections: e.sections !== undefined ? this.sections(e.sections, had.sections) : had.sections, cap: e.cap !== undefined ? this.cap(e.cap) : had.cap };
      this.s.editions = this.s.editions.map(x => (x === had ? ed : x));
      // its stories follow the new sections and words at once (zero tokens)
      const sources = this.s.sources.filter(s => s.edition === ed.id);
      const byId = new Map(sources.map(s => [s.id, s]));
      const known = new Set(ed.sections.map(s => s.id));
      for (const s of this.s.sources) if (s.edition === ed.id && s.section && !known.has(s.section)) s.section = '';
      const mine = this.s.items.filter(i => i.edition === ed.id).map(i => (e.sections !== undefined && !known.has(i.section) || e.sections !== undefined && !i.summary ? { ...i, section: sectionOf(i.title, i.snippet || i.summary || '', byId.get(i.source) ?? { section: '' }, ed) } : i));
      this.s.items = [...this.s.items.filter(i => i.edition !== ed.id), ...rank(mine, sources, now, ed)];
    } else if (e.op === 'delete') {
      const had = this.edition(e.id);
      const gone = new Set(this.s.sources.filter(s => s.edition === had.id).map(s => s.id));
      this.s.editions = this.s.editions.filter(x => x !== had);
      this.s.sources = this.s.sources.filter(s => !gone.has(s.id));
      for (const id of gone) delete this.s.status[id];
      this.s.everRead = (this.s.everRead ?? []).filter(id => !gone.has(id));
      this.s.items = this.s.items.filter(i => i.edition !== had.id);
      this.s.history = this.s.history.filter(h => h.edition !== had.id);
    } else if (e.op === 'move') {
      const had = this.edition(e.id);
      const rest = this.s.editions.filter(x => x !== had);
      rest.splice(Math.max(0, Math.min(rest.length, Math.round(Number(e.to)) || 0)), 0, had);
      this.s.editions = rest;
    }
    this.save();
    this.emit();
    return this.state();
  }

  private cap(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) ? Math.max(3, Math.min(12, Math.round(v))) : NEWS_FRONT_CAP; }

  /** «Fonti»: add (a pasted link, to an edition), remove, pause or resume, back to a ready-made edition's list. */
  editSources(e: NewsSourceEdit): NewsState {
    const removed = new Set(this.s.removed ?? []);
    if (e.op === 'add') {
      const ed = this.edition(e.edition);
      const url = safeUrl(e.url);
      if (!url || !publicHttps(url)) throw new Error('Serve un link https pubblico.');
      const def = sourceFromUrl(url, e.name);
      if (this.s.sources.some(s => s.edition === ed.id && canonicalUrl(s.url) === canonicalUrl(def.url))) throw new Error('Questa fonte c\'è già.');
      if (this.s.sources.filter(s => s.edition === ed.id).length >= 60) throw new Error('Al massimo 60 fonti per edizione: toglierne una prima.');
      const id = `u-${createHash('sha1').update(`${ed.id === NEWS_AI_EDITION ? '' : `${ed.id}\n`}${def.url}`).digest('hex').slice(0, 8)}`;
      const section = typeof e.section === 'string' && ed.sections.some(s => s.id === e.section) ? e.section : '';
      const weight = typeof e.weight === 'number' && Number.isFinite(e.weight) ? Math.round(Math.max(0.2, Math.min(1, e.weight)) * 100) / 100 : def.weight;
      this.s.sources = [...this.s.sources, { id, edition: ed.id, ...def, section, weight, ...(typeof e.primary === 'boolean' ? { primary: e.primary } : {}), ...(e.pin === true && section ? { pin: true } : {}) }];
    } else if (e.op === 'remove') {
      const src = this.s.sources.find(s => s.id === e.id);
      if (!src) throw new Error('fonte sconosciuta');
      this.s.sources = this.s.sources.filter(s => s.id !== e.id);
      delete this.s.status[e.id];
      if (src.builtin) removed.add(e.id);
    } else if (e.op === 'toggle') {
      const src = this.s.sources.find(s => s.id === e.id);
      if (!src) throw new Error('fonte sconosciuta');
      src.on = e.on === true;
    } else if (e.op === 'reset') {
      const ed = this.edition(e.edition), t = templateOf(ed.template);
      if (!t) throw new Error('Questa edizione non ha un elenco di base da ripristinare.');
      const mine = this.s.sources.filter(s => s.edition === ed.id && !s.builtin);
      this.s.sources = [...this.s.sources.filter(s => s.edition !== ed.id), ...t.sources.map(s => ({ ...s, edition: ed.id })), ...mine];
      for (const s of t.sources) removed.delete(s.id);
    }
    this.s.removed = [...removed];
    this.save();
    this.emit();
    return this.state();
  }

  /** The daily refresh: off by default (it costs tokens), at a local hour. */
  setSchedule(sc: Partial<NewsSchedule>): NewsState {
    const hour = Number.isInteger(sc.hour) && sc.hour! >= 0 && sc.hour! <= 23 ? sc.hour! : this.s.schedule.hour;
    this.s.schedule = { on: typeof sc.on === 'boolean' ? sc.on : this.s.schedule.on, hour };
    this.save();
    this.arm();
    this.emit();
    return this.state();
  }

  /** Due now: on, past the hour, not yet today. */
  autoDue(now = this.now()): boolean {
    return this.s.schedule.on && this.s.editions.length > 0 && new Date(now).getHours() >= this.s.schedule.hour && this.s.autoDay !== localDay(now);
  }

  /** Called by the clock: the daily refresh when it is due. */
  tick(): Promise<NewsRefresh> | null {
    if (!this.autoDue()) return null;
    this.s.autoDay = localDay(this.now());
    this.save();
    return this.refresh();
  }

  private arm(): void {
    if (this.timer !== null) { this.d.clearInterval?.(this.timer); this.timer = null; }
    if (!this.s.schedule.on || !this.d.setInterval) return;
    this.timer = this.d.setInterval(() => { void this.tick()?.catch(() => { /* the status rows say which source failed */ }); }, CHECK_MS);
  }

  dispose(): void { if (this.timer !== null) this.d.clearInterval?.(this.timer); this.timer = null; }
}
