// Impara «News» (ADR 0265): turns what a source sends into raw stories, at zero tokens and with no dependency (a small
// tag reader, not an XML library: feeds are read for a title, a link, a date and a few words). Readers: RSS 2.0 and
// Atom (feeds and GitHub's releases.atom, whose prereleases are dropped), Hugging Face Daily Papers (JSON, by votes),
// Hacker News through Algolia (JSON, by points, only stories that link out and speak of AI), a page (its links and the
// heading and date inside or beside each) and a Markdown page with dated headings (release notes). Everything here is
// untrusted text from the web: it is stripped to plain text and capped, links are kept only when http(s).
// Used by service.ts; tests: test/unit/news-parse.test.ts.
import { safeUrl, SNIPPET_MAX } from '@shared/news';

export interface RawStory { title: string; url: string; at: number | null; snippet: string; signal?: number; /** a link site's own discussion page */ discuss?: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
/** Plain text: CDATA opened, tags (and scripts, styles) dropped, entities decoded, spaces folded. */
export function plain(s: string): string {
  // a feed may escape its html (&lt;p&gt;): decode once, then drop tags, then decode what the text itself escaped
  const strip = (x: string) => x.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  return decode(strip(decode(strip(unCdata(s))))).replace(/\s+/g, ' ').trim();
}
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const snippetOf = (s: string) => cap(plain(s), SNIPPET_MAX);

function date(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(plain(s));
  return Number.isFinite(t) ? t : null;
}
/** The inner text of the first `<name …>…</name>` (namespaced names written in full, e.g. content:encoded). */
function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m?.[1];
}
function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map(m => m[1]!);
}
/** An Atom link: rel=alternate (or no rel) first. */
function atomLink(entry: string): string | undefined {
  const links = [...entry.matchAll(/<link\b([^>]*)\/?>/gi)].map(m => m[1]!);
  const attr = (a: string, k: string) => new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, 'i').exec(a)?.[1];
  const alt = links.find(a => { const r = attr(a, 'rel'); return !r || r === 'alternate'; }) ?? links[0];
  return alt ? decode(attr(alt, 'href') ?? '') : undefined;
}

/** RSS 2.0 or Atom. base resolves relative links. */
export function parseFeed(xml: string, base: string): RawStory[] {
  const out: RawStory[] = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  if (isAtom) {
    for (const e of blocks(xml, 'entry')) {
      const url = safeUrl(atomLink(e) ?? '', base);
      const title = plain(tag(e, 'title') ?? '');
      if (!url || !title) continue;
      out.push({ title: cap(title, 200), url, at: date(tag(e, 'published') ?? tag(e, 'updated')), snippet: snippetOf(tag(e, 'summary') ?? tag(e, 'content') ?? '') });
    }
    return out;
  }
  for (const it of blocks(xml, 'item')) {
    const link = plain(tag(it, 'link') ?? '') || (/<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i.exec(it)?.[1] ?? '');
    const url = safeUrl(plain(link), base);
    const title = plain(tag(it, 'title') ?? '');
    if (!url || !title) continue;
    out.push({ title: cap(title, 200), url, at: date(tag(it, 'pubDate') ?? tag(it, 'dc:date')), snippet: snippetOf(tag(it, 'description') ?? tag(it, 'content:encoded') ?? '') });
  }
  return out;
}

/** A GitHub release that is not a final one: alpha, beta, rc, nightly, preview, canary, dev builds. */
export const isPrerelease = (title: string): boolean => /(?:^|[\s\-_.+v(])(alpha|beta|rc|nightly|preview|canary|dev|snapshot|insiders)(?:[\s\-_.+\d)]|$)/i.test(title);
/** GitHub's releases.atom: a feed whose prereleases are dropped. */
export function parseGithub(xml: string, base: string): RawStory[] {
  return parseFeed(xml, base).filter(s => !isPrerelease(s.title) && !isPrerelease(s.url.split('/').pop() ?? ''));
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Hugging Face Daily Papers: each paper with at least `min` votes, linked to its page on huggingface.co/papers. */
export function parseHfPapers(json: unknown, min = 20): RawStory[] {
  if (!Array.isArray(json)) throw new Error('risposta non valida (attesa una lista)');
  const out: RawStory[] = [];
  for (const raw of json.slice(0, 200)) {
    const r = obj(raw), p = obj(r.paper);
    const id = str(p.id), title = plain(str(r.title) || str(p.title));
    const votes = typeof p.upvotes === 'number' ? p.upvotes : 0;
    if (!/^[\w.-]{4,40}$/.test(id) || !title || votes < min) continue;
    out.push({ title: cap(title, 200), url: `https://huggingface.co/papers/${id}`, at: date(str(r.publishedAt) || str(p.publishedAt)), snippet: snippetOf(str(p.ai_summary) || str(r.summary) || str(p.summary)), signal: votes });
  }
  return out;
}

/** The words a Hacker News title must have to be about AI as this paper means it. */
const AI_WORDS = /\b(ai|llms?|gpt[\w.-]*|claude|anthropic|openai|gemini|deepmind|mistral|llama|qwen|deepseek|model[s]?|agent(s|ic)?|mcp|codex|cursor|copilot|transformer[s]?|inference|fine-?tun\w*|rlhf|benchmark[s]?|evals?|prompt\w*|embedding[s]?|diffusion|neural|machine learning|hugging ?face|tokens?|reasoning|fable|opus|sonnet|haiku|mythos)\b/i;
export const aboutAi = (title: string) => AI_WORDS.test(title);
/** Hacker News (Algolia search_by_date): stories with a link out, at least `min` points, about AI. */
export function parseHn(json: unknown, min = 150): RawStory[] {
  const hits = obj(json).hits;
  if (!Array.isArray(hits)) throw new Error('risposta non valida (manca hits)');
  const out: RawStory[] = [];
  for (const raw of hits.slice(0, 200)) {
    const h = obj(raw);
    const url = safeUrl(str(h.url)), title = plain(str(h.title));
    const points = typeof h.points === 'number' ? h.points : 0;
    if (!url || !title || points < min || !aboutAi(title) || /^(ask|tell) hn\b/i.test(title)) continue;
    const id = str(h.objectID);
    out.push({ title: cap(title, 200), url, at: date(str(h.created_at)), snippet: '', signal: points, ...(/^\d{1,12}$/.test(id) ? { discuss: `https://news.ycombinator.com/item?id=${id}` } : {}) });
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
/** «Nov 9, 2026», «November 9, 2026», «9 November 2026», «2026-11-09» in a text, as UTC noon (a day, not a time). */
export function textDate(s: string): number | null {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 12);
  m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(s);
  if (m) return Date.UTC(+m[3]!, monthOf(m[1]!), +m[2]!, 12);
  m = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/i.exec(s);
  if (m) return Date.UTC(+m[3]!, monthOf(m[2]!), +m[1]!, 12);
  return null;
}

/** A page's stories: each link to the same site whose path matches (`match`, else under the page's own path), titled by
 *  the heading inside it (else its text, 15-200 characters), dated by a `<time datetime>` or a date in or beside it; the
 *  same link seen twice (a picture, a title, a date) is one story. Navigation links (no heading, short text) drop. */
export function parsePage(html: string, pageUrl: string, match?: string): RawStory[] {
  const page = new URL(pageUrl);
  let re: RegExp | null = null;
  if (match) { try { re = new RegExp(match); } catch { re = null; } }
  const under = page.pathname.replace(/\/+$/, '');
  const byUrl = new Map<string, RawStory & { heading: boolean; order: number }>();
  let order = 0;
  const body = html.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]!)?.[1];
    if (!href || href.startsWith('#')) continue;
    const abs = safeUrl(decode(href), pageUrl);
    if (!abs) continue;
    const u = new URL(abs);
    if (u.host !== page.host) continue;
    u.hash = ''; u.search = '';
    const path = u.pathname.replace(/\/+$/, '');
    if (path === under || (re ? !re.test(path) : !path.startsWith(`${under}/`))) continue;
    const inner = m[2]!;
    const h = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner);
    const heading = h ? plain(h[1]!) : '';
    const text = plain(inner);
    const title = heading || (text.length >= 15 && text.length <= 200 ? text : '');
    const time = /<time[^>]*datetime=["']([^"']+)["']/i.exec(inner)?.[1];
    const at = (time ? date(time) : null) ?? textDate(text);
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(inner);
    const key = u.toString();
    const had = byUrl.get(key);
    if (!had) {
      if (!title && at === null) continue;
      byUrl.set(key, { title: cap(title, 200), url: key, at, snippet: p ? snippetOf(p[1]!) : '', heading: !!heading, order: order++ });
      continue;
    }
    if (title && (!had.title || (heading && !had.heading))) { had.title = cap(title, 200); had.heading = !!heading; }
    if (had.at === null && at !== null) had.at = at;
    if (!had.snippet && p) had.snippet = snippetOf(p[1]!);
  }
  return [...byUrl.values()].filter(s => s.title && s.title !== s.url).sort((a, b) => a.order - b.order).slice(0, 60)
    .map(({ heading: _h, order: _o, ...s }) => s);
}

const mdPlain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
/** A Markdown page with dated headings (`### November 9, 2026`, or `## November, 2026` then `### Nov 5`): one story per
 *  day, titled by its first line, linked to the page's html address with the heading's anchor. */
export function parseMarkdownDated(md: string, pageUrl: string): RawStory[] {
  const html = pageUrl.replace(/\.md$/, '');
  const out: RawStory[] = [];
  let year: number | null = null;
  let cur: { head: string; at: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const lines = cur.lines.map(mdPlain).filter(l => l && !/^(Feature|Update|Fix|Deprecation)( · .*)?$/.test(l));
    const first = lines[0] ?? cur.head;
    out.push({ title: cap(first.replace(/^[-*]\s*/, ''), 160), url: `${html}#${slug(cur.head)}`, at: cur.at, snippet: cap(lines.join(' '), SNIPPET_MAX) });
    cur = null;
  };
  for (const line of md.split('\n')) {
    const h = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const text = mdPlain(h[2]!);
      const full = textDate(text);
      const ym = /^([A-Za-z]+),?\s+(\d{4})$/.exec(text);
      const md2 = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(text);
      if (full !== null) { flush(); cur = { head: text, at: full, lines: [] }; continue; }
      if (ym && monthOf(ym[1]!) >= 0) { flush(); year = +ym[2]!; continue; }
      if (md2 && year !== null && monthOf(md2[1]!) >= 0) { flush(); cur = { head: text, at: Date.UTC(year, monthOf(md2[1]!), +md2[2]!, 12), lines: [] }; continue; }
      flush();
      continue;
    }
    if (cur && line.trim()) cur.lines.push(line.trim());
  }
  flush();
  return out.slice(0, 40);
}

/** An article's own publication date: its meta tag, its JSON-LD datePublished, its first <time datetime>, else the first
 *  date written near the top of the page (null when none). Used for a page source's new stories that had none. */
export function articleDate(html: string): number | null {
  const meta = /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i.exec(html)?.[1]
    ?? /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1]
    ?? /<time[^>]*datetime=["']([^"']+)["']/i.exec(html)?.[1];
  const at = meta ? date(meta) : null;
  return at ?? textDate(plain(html.slice(0, 120_000)).slice(0, 4000));
}

/** What a body is, when the source's own read method is unknown (a source the user adds): a feed, a Markdown page or
 *  an html page. */
export function sniff(body: string, contentType: string, url: string): 'feed' | 'md' | 'page' {
  const head = body.slice(0, 600).trimStart();
  if (/xml|rss|atom/i.test(contentType) || /^<\?xml/.test(head) || /<(rss|feed)[\s>]/i.test(head)) return 'feed';
  if (/markdown/i.test(contentType) || /\.md$/i.test(new URL(url).pathname)) return 'md';
  return 'page';
}
