// The Ctrl+K full-text index, pure: documents (a chat with its messages, a git branch, a brain markdown file) kept in
// memory, matched by every word of the query (accent- and case-insensitive; "-", "_", "/", "." count as spaces, so
// "orchestrator overlay" finds feat/orchestrator-overlay), ranked (title > phrase > all words; word starts, recency over 30 days and
// how many messages matched add up), and cut into a snippet with the match marked. Why no library: a few MB of text
// scanned with indexOf answers in milliseconds, and the index must cost nothing at rest. Used by search/service.ts;
// pinned by test/unit/search.test.ts.
import type { SearchHit, SearchKind } from '../../shared/contract';

/** One searchable text with its date: a message, a whole file. `low` = fold(text), same length. */
export interface Part { at: number; text: string; low: string }

export interface Doc {
  key: string;
  kind: 'chat' | 'branch' | 'brain';
  title: string;
  titleLow: string;
  at: number;
  parts: Part[];
  sub?: string;
  chatId?: string;
  closed?: boolean;
  path?: string;
}

const DAY = 86_400_000;
const SEP = /[-_/.\\]/;
const FOLD_CHARS = /[À-ɏ\-_/.\\]/g;
const foldOne = (c: string): string => (SEP.test(c) ? ' ' : c.normalize('NFD')[0] ?? c);

/** Lower case, accents off, separators as spaces; the result has the same length as the input (offsets carry over). */
export function fold(s: string): string {
  const low = s.toLowerCase();
  if (low.length === s.length) return low.replace(FOLD_CHARS, foldOne);
  // a character whose lower case is longer (rare: "İ"): one by one, so offsets still carry over
  let out = '';
  for (const ch of s) { const l = ch.toLowerCase(); out += (l.length === ch.length ? l : ch).replace(FOLD_CHARS, foldOne); }
  return out;
}

export const part = (at: number, text: string): Part => ({ at, text, low: fold(text) });

/** The query's words, folded; a word of one letter is kept only when it is the whole query. */
export function terms(q: string): { words: string[]; phrase: string } {
  const phrase = fold(q).replace(/\s+/g, ' ').trim();
  const all = phrase.split(' ').filter(Boolean);
  const words = all.length > 1 ? all.filter(w => w.length > 1) : all;
  return { words: words.length ? [...new Set(words)] : all, phrase };
}

const isWordStart = (low: string, at: number): boolean => at === 0 || /[\s([{"'`*#>:,;]/.test(low[at - 1] ?? ' ');

/** Where every word occurs (first occurrence of each), or null if one is missing. */
function matchAll(low: string, words: string[]): number[] | null {
  const at: number[] = [];
  for (const w of words) { const i = low.indexOf(w); if (i < 0) return null; at.push(i); }
  return at;
}

function textScore(low: string, words: string[], phrase: string, pos: number[]): { score: number; at: number; len: number } {
  const p = words.length > 1 ? low.indexOf(phrase) : -1;
  if (p >= 0) return { score: 200 + (isWordStart(low, p) ? 60 : 0), at: p, len: phrase.length };
  const starts = pos.filter(i => isWordStart(low, i)).length;
  const first = Math.min(...pos);
  const w = words[pos.indexOf(first)] ?? '';
  return { score: 100 + Math.round((60 * starts) / Math.max(1, pos.length)), at: first, len: w.length };
}

const recency = (at: number, now: number): number => Math.round(150 * Math.max(0, 1 - (now - at) / (30 * DAY)));

/** A one-line excerpt of `text` around [at, at+len): about 50 characters before, 110 after, whitespace collapsed,
 *  markdown emphasis dropped; mark = the match inside it. */
export function snippet(text: string, at: number, len: number): { snippet: string; mark: [number, number] } {
  let start = Math.max(0, at - 50);
  let end = Math.min(text.length, at + len + 110);
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp >= 0 && sp < at) start = sp + 1; }
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at + len) end = sp; }
  // never half of an emoji (a surrogate pair) at either edge
  const lowSurrogate = (i: number) => { const c = text.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
  if (start > 0 && start < at && lowSurrogate(start)) start++;
  if (end < text.length && end > at + len && lowSurrogate(end)) end--;
  const clean = (s: string) => s.replace(/\*\*|`/g, '').replace(/\s+/g, ' ');
  const pre = (start > 0 ? '…' : '') + clean(text.slice(start, at)).trimStart();
  const hit = clean(text.slice(at, at + len));
  const post = clean(text.slice(at + len, end)).trimEnd() + (end < text.length ? '…' : '');
  return { snippet: pre + hit + post, mark: [pre.length, pre.length + hit.length] };
}

const lineOf = (text: string, at: number): number => { let n = 1; for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++; return n; };

/** One document against the query: its hit (with score) or null. */
export function matchDoc(d: Doc, words: string[], phrase: string, now: number): (SearchHit & { score: number }) | null {
  if (!words.length) return null;
  const base = { key: d.key, title: d.title, at: d.at, ...(d.sub ? { sub: d.sub } : {}), ...(d.chatId ? { chatId: d.chatId } : {}), ...(d.closed ? { closed: true } : {}), ...(d.path ? { path: d.path } : {}) };
  const tpos = matchAll(d.titleLow, words);
  const title = tpos ? textScore(d.titleLow, words, phrase, tpos) : null;
  // the best part: newest first, a phrase beats loose words; at most 200 matching parts are counted
  let best: { p: Part; score: number; at: number; len: number } | null = null;
  let count = 0;
  for (let i = d.parts.length - 1; i >= 0 && count < 200; i--) {
    const p = d.parts[i]!;
    const pos = matchAll(p.low, words);
    if (!pos) continue;
    count++;
    const t = textScore(p.low, words, phrase, pos);
    const score = t.score + recency(p.at, now);
    if (!best || score > best.score) best = { p, score, at: t.at, len: t.len };
  }
  const bonus = count ? Math.min(60, Math.round(15 * Math.log2(1 + count))) : 0;
  let kind: SearchKind = d.kind;
  let score: number;
  if (title) score = 600 + title.score + recency(d.at, now) + bonus;
  else if (best) { score = best.score + bonus; if (d.kind === 'chat') kind = 'message'; }
  else return null;
  const sn = best ? snippet(best.p.text, best.at, best.len) : null;
  return {
    ...base, kind, score,
    snippet: sn?.snippet ?? '', mark: sn?.mark ?? null,
    ...(best && d.kind === 'chat' ? { at: best.p.at } : {}),
    ...(best && d.kind === 'brain' ? { line: lineOf(best.p.text, best.at) } : {}),
    ...(count ? { count } : {}),
  };
}

/** The best hits of every kind (perKind each), best first within a kind. */
export function searchDocs(docs: Iterable<Doc>, q: string, opts: { now: number; perKind?: number }): SearchHit[] {
  const { words, phrase } = terms(q);
  if (!words.length) return [];
  const per = opts.perKind ?? 6;
  const byKind = new Map<SearchKind, (SearchHit & { score: number })[]>();
  for (const d of docs) {
    const h = matchDoc(d, words, phrase, opts.now);
    if (!h) continue;
    const list = byKind.get(h.kind) ?? [];
    list.push(h);
    byKind.set(h.kind, list);
  }
  const order: SearchKind[] = ['chat', 'message', 'branch', 'brain'];
  return order.flatMap(k => (byKind.get(k) ?? []).sort((a, b) => b.score - a.score || b.at - a.at).slice(0, per).map(({ score: _s, ...h }) => h));
}
