// Impara «News» (ADR 0264): the same story from several sources becomes one. Two stories are the same when their links
// are the same once tracking parts are dropped (utm_*, ref, www., a trailing slash), when one's link is the other's
// (an aggregator that links the primary: Hacker News, a newsletter's own link), or when their titles say the same
// thing within a few days (enough shared words, or the same product and version, e.g. «Claude Code 2.1.322»). The story
// kept is the primary source's, else the heavier source's, else the oldest; the others go into `also`, and their
// points or votes add to its echo. A pure module: tests in test/unit/news-dedup.test.ts.
import type { NewsAlso, NewsItem, NewsSource } from '@shared/news';

const TRACKING = /^(utm_\w+|ref|ref_src|source|fbclid|gclid|mc_cid|mc_eid|s|si)$/i;
/** A link as a key: lower-case host without www., no tracking parameters, no trailing slash; the anchor is kept
 *  (a changelog's versions differ only by it). */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname}${path}${u.search}${u.hash}`;
  } catch { return raw.trim().toLowerCase(); }
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'now', 'new', 'our', 'we', 'how', 'its', 'at', 'by', 'from', 'as', 'this', 'that', 'introducing', 'announcing', 'il', 'la', 'di', 'e', 'per', 'con', 'un', 'una']);
/** The words that carry a title's meaning (lower-case, no stop words; numbers and versions kept whole). */
export function titleWords(title: string): Set<string> {
  const words = title.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu) ?? [];
  return new Set(words.filter(w => w.length > 1 && !STOP.has(w)));
}
const VERSION = /(?<![\d.])\d+\.\d+(?:\.\d+)?(?![\d.])/g;
const DAY = 86_400_000;

/** Whether two titles, published within `days` of each other, tell the same story. */
export function sameStory(a: { title: string; at: number }, b: { title: string; at: number }, days = 4): boolean {
  if (Math.abs(a.at - b.at) > days * DAY) return false;
  const x = titleWords(a.title), y = titleWords(b.title);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(w => y.has(w));
  // the same version number with a shared name beside it (a product: «Claude Code 2.1.322» and «claude code
  // v2.1.322»); a bare version alone is too weak
  const va = a.title.match(VERSION) ?? [], vb = new Set(b.title.match(VERSION) ?? []);
  if (va.some(v => vb.has(v)) && shared.some(w => !/^\d/.test(w))) return true;
  const small = Math.min(x.size, y.size);
  return small >= 3 && shared.length >= 3 && shared.length / small >= 0.6;
}

/** The story that stays: a primary source first, then the heavier source, then the one published first. */
function better(a: NewsItem, b: NewsItem, src: (id: string) => NewsSource | undefined): NewsItem {
  const sa = src(a.source), sb = src(b.source);
  if (!!sa?.primary !== !!sb?.primary) return sa?.primary ? a : b;
  if ((sa?.weight ?? 0) !== (sb?.weight ?? 0)) return (sa?.weight ?? 0) > (sb?.weight ?? 0) ? a : b;
  return a.at <= b.at ? a : b;
}

function merge(keep: NewsItem, drop: NewsItem): NewsItem {
  const also: NewsAlso[] = [...keep.also];
  const add = (x: NewsAlso) => { if (x.url !== keep.url && !also.some(y => y.url === x.url || y.source === x.source && x.source !== keep.source)) also.push(x); };
  add({ source: drop.source, name: drop.sourceName, url: drop.url });
  for (const x of drop.also) add(x);
  return {
    ...keep,
    also: also.slice(0, 8),
    at: Math.min(keep.at, drop.at),
    snippet: keep.snippet || drop.snippet,
    summary: keep.summary ?? drop.summary,
    why: keep.why ?? drop.why,
    ...(keep.fit ?? drop.fit) !== undefined ? { fit: keep.fit ?? drop.fit } : {},
    ...(keep.signal !== undefined || drop.signal !== undefined ? { signal: Math.max(keep.signal ?? 0, drop.signal ?? 0) } : {}),
    read: keep.read || drop.read,
    saved: keep.saved || drop.saved,
    ...(keep.lesson ?? drop.lesson ? { lesson: keep.lesson ?? drop.lesson } : {}),
  };
}

/** One story per event. `items` may hold old and new stories together; the result keeps the order of first sight and
 *  says how many were merged. */
export function dedupe(items: readonly NewsItem[], sources: readonly NewsSource[]): { items: NewsItem[]; merged: number } {
  const byId = new Map(sources.map(s => [s.id, s]));
  const src = (id: string) => byId.get(id);
  const out: NewsItem[] = [];
  const byUrl = new Map<string, number>();
  let merged = 0;
  for (const it of items) {
    const keys = [canonicalUrl(it.url), ...it.also.map(a => canonicalUrl(a.url))];
    let at = keys.map(k => byUrl.get(k)).find((i): i is number => i !== undefined);
    if (at === undefined) at = out.findIndex(o => sameStory(o, it));
    if (at === undefined || at < 0) {
      byUrl.set(keys[0]!, out.length);
      out.push(it);
      continue;
    }
    const prev = out[at]!;
    const keep = better(prev, it, src);
    out[at] = merge(keep, keep === prev ? it : prev);
    for (const k of [out[at]!.url, ...out[at]!.also.map(a => a.url)]) byUrl.set(canonicalUrl(k), at);
    merged++;
  }
  return { items: out, merged };
}
