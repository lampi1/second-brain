// Errors and ideas grouped by theme (SPEC 23 b; shown on Memoria → Idee and Qualità): the entries of ai-errors.md (one dated line
// each) and ideas.md (one "## date · [area] · title · `state`" section each) take the vectors the hybrid index already
// has for their chunks, are clustered by meaning (average linkage over cosine), and each theme gets a label (its most
// distinctive words), its size and whether it is growing (a larger share of the last 7 days than of the 7 before). Pairs
// of entries that say almost the same thing are flagged as duplicates. Pure; computed in main from
// HybridSearch.vectors and served as /api/themes (wiring.ts); pinned by test/unit/search-themes.test.ts.
import type { ChunkRow } from './store';

import type { Duplicate, Theme, ThemeEntry, ThemeKind, Themes } from '@shared/themes';

export type { ThemeKind, Themes };
export const THEME_FILES: Record<ThemeKind, string> = { errors: 'ai-errors.md', ideas: 'ideas.md' };

// own: `v` was embedded from the entry's own text (not shared with another entry of its chunk)
// src: the chunk an error line's vector comes from (two lines of one chunk share it: not duplicates of each other)
interface Item extends ThemeEntry { v: Float32Array; words: string[]; body?: string; own?: boolean; src?: number }
type Row = ChunkRow & { v: Float32Array };

// e5 cosines are compressed (unrelated texts still score ~0.75): thresholds measured on the real brain
export const JOIN = 0.88;      // average similarity for two groups to be one theme (0.86 already chains most errors into one)
export const DUPLICATE = 0.95; // two entries saying almost the same thing
const MIN_THEME = 2;
const MAX_THEMES = 12;
const MAX_DUPLICATES = 10;
const MAX_ENTRIES = 600; // the newest: an n² similarity matrix, computed in the main process
const BASELINE = 5;      // entries the file needs in the 7 days before for "growing" to mean anything
const DAY_MS = 86_400_000;

const STOP = new Set(('alla alle allo anche ancora come con cosa dal dalla dalle dei del della delle dello detto due già gli '
  + 'invece lui nei nel nella nelle non per perché più poi prima quando quella quelle quello questa queste questo senza '
  + 'sono sta stato sua sue sul sulla tra una uno vero visto regola dopo fatto fare solo ogni dove ora altro trovato second brain errore errori '
  + 'about after also and are but can for from had has have into its not now only that the then there this was were '
  + 'what when which while will with without').normalize('NFD').replace(/\p{M}/gu, '').split(' '));

const fold = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u)
  .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w));

function norm(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** ai-errors.md: one entry per dated list line ("- 2026-10-17 14:08 · who · area · kind · detto: … · vero: …"), with
 *  the vector of its chunk; the entry's words are what was said and what was true (not who or when). */
function errorItems(rows: Row[]): Item[] {
  const out: Item[] = [];
  for (const r of rows) {
    r.text.split('\n').forEach((l, i) => {
      const m = l.match(/^- (\d{4}-\d{2}-\d{2})\b(.*)$/);
      if (!m) return;
      const fields = m[2]!.split(' · ').slice(1);
      const body = fields.filter(f => /^(detto|vero|regola)\b/i.test(f.trim())).join(' ') || fields.slice(2).join(' ');
      out.push({ line: r.line + i, text: l.slice(2).replace(/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\s*·\s*/, '').trim(), day: m[1]!, v: r.v, src: r.id, words: fold(`${fields[1] ?? ''} ${fields[2] ?? ''} ${body}`) });
    });
  }
  return dedupeByLine(out);
}

/** ideas.md: one entry per "## date · [area] · title · `state`" section. Its `body` (title and "Idea:" line) is what
 *  HybridSearch.themes embeds: the chunks also carry the template (Come/Perché/Fonte) and cross sections, so all ideas
 *  look alike through them; their mean is only the fallback vector. Words come from the idea, not its source. */
function ideaItems(rows: Row[]): Item[] {
  const text = new Map<number, string>(), vecOf = new Map<number, Float32Array>();
  for (const r of rows) r.text.split('\n').forEach((l, i) => { text.set(r.line + i, l); vecOf.set(r.line + i, r.v); });
  const lines = [...text.keys()].sort((a, b) => a - b);
  const out: Item[] = [];
  lines.forEach((n, k) => {
    const m = text.get(n)!.match(/^## (\d{4}-\d{2}-\d{2}) · (?:\[[^\]]*\] · )?(.+?)(?: · `[^`]*`)?\s*$/);
    if (!m) return;
    const own: string[] = [], vs = new Set<Float32Array>();
    for (let j = k + 1; j < lines.length && !/^##? /.test(text.get(lines[j]!)!); j++) { own.push(text.get(lines[j]!)!); vs.add(vecOf.get(lines[j]!)!); }
    vs.add(vecOf.get(n)!);
    const field = (name: string) => own.filter(l => new RegExp(`^- \\*\\*${name}:\\*\\*`, 'i').test(l)).map(l => l.replace(/^- \*\*[^*]+\*\*\s*/, '')).join(' ');
    const idea = field('Idea') || own.join(' ').replace(/\*\*[^*]+:\*\*/g, '');
    const v = new Float32Array(vecOf.get(n)!.length);
    for (const x of vs) x.forEach((y, i) => { v[i] = v[i]! + y; });
    out.push({ line: n, text: m[2]!, day: m[1]!, v: norm(v), body: `${m[2]!}. ${idea}`.slice(0, 1000), words: fold(`${m[2]!} ${idea} ${field('Come')} ${field('Perché')}`) });
  });
  return out;
}

/** A chunk holding two short lines gives both the same vector; keep each line once. */
function dedupeByLine(items: Item[]): Item[] {
  const seen = new Set<number>();
  return items.filter(i => !seen.has(i.line) && !!seen.add(i.line));
}

/** Cosine similarity of every pair (vectors are unit length); each dot product computed once. */
export function similarities(vs: Float32Array[]): Float64Array[] {
  const sim = vs.map(() => new Float64Array(vs.length));
  for (let i = 0; i < vs.length; i++) {
    sim[i]![i] = 1;
    for (let j = i + 1; j < vs.length; j++) sim[i]![j] = sim[j]![i] = dot(vs[i]!, vs[j]!);
  }
  return sim;
}

/** Average-linkage clustering: merges the two most similar groups while their mean similarity is ≥ `join`. `link`
 *  (from similarities) is used up. Each group remembers its nearest one, so a merge rescans only the groups whose
 *  nearest changed instead of every pair: about n² work, not n³, on the Electron main thread. */
export function cluster(vs: Float32Array[], join = JOIN, link: Float64Array[] = similarities(vs)): number[][] {
  const n = vs.length;
  const groups = vs.map((_, i) => ({ ids: [i], alive: true }));
  const near = new Int32Array(n).fill(-1);
  const scan = (i: number) => {
    let b = -1, s = -Infinity;
    for (let j = 0; j < n; j++) if (j !== i && groups[j]!.alive && link[i]![j]! > s) { s = link[i]![j]!; b = j; }
    near[i] = b;
  };
  for (let i = 0; i < n; i++) scan(i);
  for (;;) {
    let best = -Infinity, bi = -1;
    for (let i = 0; i < n; i++) if (groups[i]!.alive && near[i]! >= 0 && link[i]![near[i]!]! > best) { best = link[i]![near[i]!]!; bi = i; }
    if (bi < 0 || best < join) break;
    const bj = near[bi]!, gi = groups[bi]!, gj = groups[bj]!, ni = gi.ids.length, nj = gj.ids.length;
    gi.ids.push(...gj.ids); gj.alive = false;
    // the linkage between groups, updated with Lance-Williams (average): s(k, i∪j) = (|i| s(k,i) + |j| s(k,j)) / (|i|+|j|)
    for (let k = 0; k < n; k++) {
      if (!groups[k]!.alive || k === bi) continue;
      const s = (ni * link[bi]![k]! + nj * link[bj]![k]!) / (ni + nj);
      link[bi]![k] = s; link[k]![bi] = s;
    }
    for (let k = 0; k < n; k++) {
      if (!groups[k]!.alive || k === bi) continue;
      if (near[k] === bi || near[k] === bj) scan(k);
      else if (link[k]![bi]! > link[k]![near[k]!]!) near[k] = bi;
    }
    scan(bi);
  }
  return groups.filter(g => g.alive).map(g => g.ids);
}

/** The theme's label: its words that are frequent inside and rare outside (tf-idf), the best three. */
function labelOf(members: Item[], all: Item[]): string {
  const df = new Map<string, number>();
  for (const it of all) for (const w of new Set(it.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const tf = new Map<string, number>();
  for (const it of members) for (const w of new Set(it.words)) tf.set(w, (tf.get(w) ?? 0) + 1);
  return [...tf].filter(([, c]) => c >= Math.min(2, members.length))
    .map(([w, c]) => ({ w, s: c * Math.log(1 + all.length / (df.get(w) ?? 1)) }))
    .sort((a, b) => b.s - a.s || a.w.localeCompare(b.w)).slice(0, 3).map(x => x.w).join(' · ');
}

const dayMs = (d: string | null): number | null => (d ? Date.parse(`${d}T12:00:00Z`) : null);

/** The themes of one file's entries; `today` as YYYY-MM-DD (Rome). `embed` gives entries with their own text (ideas)
 *  their own vector; without it (or if it fails) they keep the chunks' one. */
export async function themesOf(kind: ThemeKind, rows: Row[], today: string, opts: { join?: number; duplicate?: number; embed?: (texts: string[]) => Promise<Float32Array[]> } = {}): Promise<Themes> {
  const items = (kind === 'errors' ? errorItems(rows) : ideaItems(rows))
    .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '') || b.line - a.line).slice(0, MAX_ENTRIES);
  const own = items.filter(i => i.body);
  if (opts.embed && own.length) {
    const vs = await opts.embed(own.map(i => i.body!)).catch(() => null);
    if (vs?.length === own.length) own.forEach((it, k) => { it.v = vs[k]!; it.own = true; });
  }
  const now = dayMs(today)!;
  const age = (it: Item) => { const d = dayMs(it.day); return d === null ? Infinity : (now - d) / DAY_MS; };
  const recentAll = items.filter(i => age(i) < 7).length, beforeAll = items.filter(i => age(i) >= 7 && age(i) < 14).length;
  // growing = the theme's share of the week clearly above its share of the week before (more logging overall is not a
  // theme growing); without enough entries the week before there is no baseline and nothing is flagged
  const grows = (recent: number, before: number) => beforeAll >= BASELINE && recent >= 3 && recent / recentAll > 1.5 * (before / beforeAll);
  const sim = similarities(items.map(i => i.v));
  // duplicates first: clustering uses the matrix up. Only entries with a vector of their own text or of distinct
  // chunks (an idea left on the chunks' mean, when embedding failed, looks like every other idea)
  const top: { i: number; j: number; s: number }[] = []; // the best MAX_DUPLICATES pairs, best first
  const dup = opts.duplicate ?? DUPLICATE;
  const comparable = (a: Item, b: Item) => (a.own && b.own) || (a.src !== undefined && b.src !== undefined && a.src !== b.src);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const s = sim[i]![j]!;
    if (s < dup || (top.length === MAX_DUPLICATES && s <= top[MAX_DUPLICATES - 1]!.s) || !comparable(items[i]!, items[j]!)) continue;
    const at = top.findIndex(x => x.s < s);
    top.splice(at < 0 ? top.length : at, 0, { i, j, s });
    if (top.length > MAX_DUPLICATES) top.pop();
  }
  const duplicates: Duplicate[] = top.map(({ i, j, s }) => ({ a: entry(items[i]!), b: entry(items[j]!), score: Math.round(s * 1000) / 1000 }));
  const themes: Theme[] = cluster(items.map(i => i.v), opts.join, sim).filter(ids => ids.length >= MIN_THEME).map(ids => {
    const members = ids.map(i => items[i]!).sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '') || b.line - a.line);
    const recent = members.filter(m => age(m) < 7).length, before = members.filter(m => age(m) >= 7 && age(m) < 14).length;
    return { label: labelOf(members, items) || members[0]!.text.slice(0, 40), entries: members.map(({ line, text, day }) => ({ line, text, day })), recent, before, growing: grows(recent, before) };
  }).sort((a, b) => Number(b.growing) - Number(a.growing) || b.entries.length - a.entries.length).slice(0, MAX_THEMES);
  return { kind, ready: true, entries: items.length, themes, duplicates };
}

const entry = ({ line, text, day }: Item): ThemeEntry => ({ line, text, day });

/** One entry per dated line of ai-errors.md (the error recall embeds their text: recall.ts). */
export function errorEntries(rows: Row[]): ThemeEntry[] { return errorItems(rows).map(entry); }
