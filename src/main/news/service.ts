// Impara «News» in main (ADR 0265): keeps the AI newspaper. A refresh («Aggiorna», or the optional daily one) reads every
// source that is on, at zero tokens and at most 6 at a time (fetch with a deadline and a size cap, through the app's
// own network like every other main-process request), parses it (parse.ts), dates a page's new stories from their own
// article when the page lists none, merges the same story across sources (dedup.ts), ranks the paper (rank.ts), then
// sends the best stories without a summary to ONE AI pass (summarize.ts, a hidden run with no tool) and measures its
// tokens and cost from the engine's own report. The state (sources, their last reading, stories, the last refreshes)
// is one JSON file in userData/news, written atomically; only titles, short summaries and links are kept. The daily
// refresh is off by default (it costs tokens); its estimate is the mean of the measured refreshes.
// Wired in wiring-builders.ts (buildNews) and demo-wiring.ts; IPC news:* in ipc-handlers/media.ts; tests:
// test/unit/news-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Lang } from '@shared/contract';
import {
  NEWS_KEEP, NEWS_KEEP_DAYS, NEWS_SUMMARY_MAX, safeUrl,
  type NewsItem, type NewsMark, type NewsProgress, type NewsRefresh, type NewsSchedule, type NewsSource, type NewsSourceEdit, type NewsSourceStatus, type NewsState,
} from '@shared/news';
import { articleDate, parseFeed, parseGithub, parseHfPapers, parseHn, parseMarkdownDated, parsePage, sniff, type RawStory } from './parse';
import { canonicalUrl, dedupe } from './dedup';
import { rank, sectionOf } from './rank';
import { guessTokens, parseSummaries, summaryPrompt } from './summarize';
import { DEFAULT_SOURCES, sourceFromUrl } from './sources';

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
  v: 1;
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
const SEEN_MAX = 5000;

/** The app's GET: a deadline, redirects followed, the body capped, a plain client name (never the user's). */
export const netFetch: NewsFetch = async (url, opts) => {
  // an article looked up for its date is fetched without following redirects (a public link could point to the LAN)
  const r = await fetch(url, { redirect: opts?.follow === false ? 'manual' : 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'second-brain-news/1.0 (+https://github.com/lampi1/second-brain)', Accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/markdown, text/html;q=0.9, */*;q=0.5' } });
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new Error('pagina troppo grande');
  const text = await r.text();
  return { status: r.status, contentType: r.headers.get('content-type') ?? '', text: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text };
};

/** Whether a link may be fetched for its date: https on a public host (never loopback, the LAN or link-local). */
export function publicHttps(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, ''); // «localhost.» is localhost
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h.includes(':') && (h === '::1' || h === '::' || /^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:'))) return false;
    return true;
  } catch { return false; }
}
const idOf = (url: string) => createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 12);
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
    const fresh: Saved = { v: 1, sources: DEFAULT_SOURCES.map(s => ({ ...s })), status: {}, items: [], history: [], schedule: { on: false, hour: 7 } };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Saved>;
      if (raw?.v !== 1 || !Array.isArray(raw.sources) || !Array.isArray(raw.items)) return fresh;
      // a source added to the default list after the user's last start comes in (on), unless they removed it
      const removed = new Set(Array.isArray(raw.removed) ? raw.removed : []);
      const have = new Set(raw.sources.map(s => s.id));
      const sources = [...raw.sources, ...DEFAULT_SOURCES.filter(s => !have.has(s.id) && !removed.has(s.id)).map(s => ({ ...s }))];
      return { ...fresh, ...raw, sources, status: raw.status ?? {}, history: raw.history ?? [], schedule: raw.schedule ?? fresh.schedule } as Saved;
    } catch { return fresh; }
  }

  private save(): void {
    fs.mkdirSync(this.d.dir, { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.s));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  private emit(): void { this.d.changed(this.state()); }

  state(): NewsState {
    const measured = this.s.history.filter(h => h.tokens !== null && h.summarized > 0).slice(-5);
    const usdRuns = measured.filter(h => h.costUsd !== null);
    const estimate = measured.length
      ? { tokens: Math.round(measured.reduce((a, h) => a + h.tokens!, 0) / measured.length), usd: usdRuns.length ? usdRuns.reduce((a, h) => a + h.costUsd!, 0) / usdRuns.length : null, measured: true }
      : { tokens: guessTokens(Math.min(NEWS_SUMMARY_MAX, 20)), usd: null, measured: false };
    return {
      items: this.s.items,
      sources: this.s.sources.map(s => ({ ...s, ...(this.s.status[s.id] ? { status: this.s.status[s.id] } : {}) })),
      last: this.s.history.at(-1) ?? null,
      progress: this.progress,
      schedule: this.s.schedule,
      estimate,
      noAi: this.d.noAi(),
    };
  }

  /** One source's stories now (no AI). */
  private async read(src: NewsSource, known: ReadonlySet<string>, firstRead: boolean): Promise<{ stories: RawStory[]; dropped: string[] }> {
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
      if (src.read === 'feed' && kind !== 'feed') throw new Error('non è un feed RSS o Atom');
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
      if (s.at !== null || known.has(idOf(s.url)) || !publicHttps(s.url) || lookups >= (firstRead ? FIRST_LOOKUPS : DATE_LOOKUPS)) continue;
      lookups++;
      try { const a = await this.d.fetch(s.url, { follow: false }); if (a.status >= 200 && a.status < 300) s.at = articleDate(a.text); } catch { /* stays undated */ }
    }
    // on a source's first reading a story still without a date is most likely old (pages list their archive too):
    // it is left out rather than shown as new; later, a link that was not there before is new, dated when first seen
    // (remembered as seen, so the next reading does not take that archive for new)
    const dropped = out.filter(s => firstRead && s.at === null).map(s => idOf(s.url));
    return { stories: out.filter(s => !firstRead || s.at !== null).map(s => ({ ...s, title: titled(s.title, src) })), dropped };
  }

  /** «Aggiorna»: read, merge, rank, summarize. One at a time: a second click joins the running one. */
  refresh(): Promise<NewsRefresh> {
    this.running ??= this.doRefresh().finally(() => { this.running = null; this.progress = null; this.emit(); });
    return this.running;
  }

  private async doRefresh(): Promise<NewsRefresh> {
    const t0 = this.now();
    const on = this.s.sources.filter(s => s.on);
    const known = new Set([...this.s.items.flatMap(i => [i.id, ...i.also.map(a => idOf(a.url))]), ...(this.s.seen ?? [])]);
    const dropped: string[] = [];
    const stillThere = (id: string) => this.s.sources.some(x => x.id === id);
    this.progress = { phase: 'fetch', done: 0, total: on.length };
    this.emit();
    const got: { src: NewsSource; stories: RawStory[] }[] = [];
    let failed = 0, found = 0;
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
          const fresh = stories.filter(x => !known.has(idOf(x.url))).length;
          this.s.status[src.id] = { at, ok: true, found: stories.length, fresh };
          got.push({ src, stories });
          found += stories.length;
        } catch (e) {
          failed++;
          if (stillThere(src.id)) this.s.status[src.id] = { at, ok: false, error: why(e), found: 0, fresh: 0 };
        } finally {
          this.progress = { phase: 'fetch', done: (this.progress?.done ?? 0) + 1, total: on.length };
          this.emit();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, on.length) }, worker));

    // new stories (unknown links, not too old); a known one only refreshes its points or votes
    this.progress = { phase: 'merge', done: 0, total: 1 };
    this.emit();
    const now = this.now();
    const oldest = now - NEWS_KEEP_DAYS * DAY;
    const byId = new Map(this.s.items.map(i => [i.id, i]));
    const fresh: NewsItem[] = [];
    const freshById = new Map<string, NewsItem>();
    // sources in their list order, so the deduplication meets the primary ones first
    got.sort((a, b) => this.s.sources.indexOf(a.src) - this.s.sources.indexOf(b.src));
    for (const { src, stories } of got) {
      stories.forEach(st => {
        const id = idOf(st.url);
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
          id, title: st.title, url: st.url, source: src.id, sourceName: src.read === 'hn' ? `${new URL(st.url).hostname.replace(/^www\./, '')} · ${src.name}` : src.name, at: Math.min(at, now), ...(st.at === null ? { undated: true } : {}), seenAt: now,
          snippet: st.snippet, section: sectionOf(st.title, st.snippet, src.section), also: [], ...(st.signal !== undefined ? { signal: st.signal } : {}), score: 0, rank: { recency: 0, source: 0, relevance: 0, echo: 0 },
        });
        freshById.set(id, fresh.at(-1)!);
        known.add(id);
      });
    }
    const kept = this.s.items.filter(i => i.saved || i.at >= oldest);
    const { items: merged, merged: mergedN } = dedupe([...kept, ...fresh], this.s.sources);
    let items = rank(merged, this.s.sources, now);

    // the AI pass: the best stories without a summary, recent enough to matter
    let tokens: number | null = null, costUsd: number | null = null, summarized = 0, aiError: string | undefined;
    const todo = items.filter(i => !i.summary && i.at >= now - SUMMARY_DAYS * DAY).slice(0, NEWS_SUMMARY_MAX);
    const noAi = this.d.noAi();
    if (todo.length && noAi) aiError = noAi;
    else if (todo.length) {
      this.progress = { phase: 'summarize', done: 0, total: todo.length };
      this.emit();
      const fence = `STORIES-${randomBytes(6).toString('hex')}`;
      try {
        const r = await this.d.ai(summaryPrompt(todo, this.d.lang(), fence));
        if (!r.ok) aiError = r.error;
        else {
          tokens = r.tokens; costUsd = r.costUsd;
          const out = new Map(parseSummaries(r.text, todo.map(i => i.id)).map(o => [o.id, o]));
          summarized = out.size;
          items = rank(items.map(i => { const o = out.get(i.id); return o ? { ...i, summary: o.summary, why: o.why, ...(o.fit !== undefined ? { fit: o.fit } : {}), section: o.section ?? i.section, snippet: '' } : i; }), this.s.sources, now);
        }
      } catch (e) { aiError = why(e); }
    }
    // what the user did while this refresh ran (read, saved, a lesson) is on the current stories: carry it over
    const now2 = new Map(this.s.items.map(i => [i.id, i]));
    // (also from a story this refresh merged into another one: its link is now one of the «also» links)
    items = items.map(i => {
      const cs = [i.id, ...i.also.map(a => idOf(a.url))].map(id => now2.get(id)).filter((c): c is NewsItem => !!c);
      if (!cs.length) return i;
      const lesson = cs.find(c => c.id === i.id)?.lesson ?? cs.find(c => c.lesson)?.lesson;
      return { ...i, read: cs.some(c => c.read) || undefined, saved: cs.some(c => c.saved) || undefined, ...(lesson ? { lesson } : {}) };
    });
    // a story saved (or given a lesson) while the AI pass ran stays, even past the days the paper keeps
    const ids2 = new Set(items.map(i => i.id));
    for (const c of now2.values()) if ((c.saved || c.lesson) && !ids2.has(c.id)) items.push(c);
    const final = this.trim(items);
    // a story that leaves the paper (aged out, trimmed) and a first reading's undated archive stay known
    const keptIds = new Set(final.flatMap(i => [i.id, ...i.also.map(a => idOf(a.url))]));
    const gone = [...this.s.items, ...items].flatMap(i => [i.id, ...i.also.map(a => idOf(a.url))]).filter(id => !keptIds.has(id));
    this.s.seen = [...new Set([...(this.s.seen ?? []), ...dropped, ...gone])].filter(id => !keptIds.has(id)).slice(-SEEN_MAX);
    this.s.items = final;
    const done: NewsRefresh = { at: t0, durationMs: this.now() - t0, sources: on.length, failed, found, fresh: fresh.length, merged: mergedN, summarized, tokens, costUsd, ...(aiError ? { aiError } : {}) };
    this.s.history = [...this.s.history, done].slice(-20);
    this.save();
    return done;
  }

  /** At most NEWS_KEEP stories: the saved ones always, then the best. */
  private trim(items: NewsItem[]): NewsItem[] {
    if (items.length <= NEWS_KEEP) return items;
    const saved = items.filter(i => i.saved);
    const rest = items.filter(i => !i.saved).slice(0, Math.max(0, NEWS_KEEP - saved.length));
    const keep = new Set([...saved, ...rest].map(i => i.id));
    return items.filter(i => keep.has(i.id));
  }

  /** Read or unread, saved for later, the lesson «Spiegamelo» started. */
  mark(m: NewsMark): NewsState {
    const it = this.s.items.find(i => i.id === m.id);
    if (!it) throw new Error('notizia sconosciuta');
    if (typeof m.read === 'boolean') it.read = m.read;
    if (typeof m.saved === 'boolean') it.saved = m.saved;
    if (typeof m.lesson === 'string' && /^[\w-]{1,40}$/.test(m.lesson)) it.lesson = m.lesson;
    this.save();
    this.emit();
    return this.state();
  }

  /** «Fonti»: add (a pasted link), remove, pause or resume, back to the default list. */
  editSources(e: NewsSourceEdit): NewsState {
    const removed = new Set(this.s.removed ?? []);
    if (e.op === 'add') {
      const url = safeUrl(e.url);
      if (!url || !url.startsWith('https://')) throw new Error('Serve un link https.');
      const def = sourceFromUrl(url, e.name);
      if (this.s.sources.some(s => canonicalUrl(s.url) === canonicalUrl(def.url))) throw new Error('Questa fonte c\'è già.');
      const id = `u-${createHash('sha1').update(def.url).digest('hex').slice(0, 8)}`;
      this.s.sources = [...this.s.sources, { id, ...def }];
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
      const mine = this.s.sources.filter(s => !s.builtin);
      this.s.sources = [...DEFAULT_SOURCES.map(s => ({ ...s })), ...mine];
      removed.clear();
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
    return this.s.schedule.on && new Date(now).getHours() >= this.s.schedule.hour && this.s.autoDay !== localDay(now);
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
