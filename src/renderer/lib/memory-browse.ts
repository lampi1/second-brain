// Memoria → Diario e note (#368): the pure part of the memory browser (components/brain-model/MemoryBrowser.tsx). The
// shelves a document sits on (Diario: now.md and the journal days; Idee; Errori; Note: knowledge, shared and the roles'
// old memories), the search (every word must appear, accents and case ignored) with how many lines match and the first
// one as a snippet, and the order (Adesso first, then the newest journal day). DOM-free; tests:
// test/unit/brain-ui/memory-browse.test.ts.
import type { MemoryDoc } from '@shared/brain-model';

export const SHELVES = ['all', 'diary', 'ideas', 'errors', 'notes'] as const;
export type Shelf = (typeof SHELVES)[number];

export function shelfOf(kind: MemoryDoc['kind']): Exclude<Shelf, 'all'> {
  return kind === 'now' || kind === 'journal' ? 'diary' : kind === 'ideas' ? 'ideas' : kind === 'errors' ? 'errors' : 'notes';
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** The words of a query (folded), at most 8, each of 2 characters or more. */
export const words = (q: string): string[] => fold(q).split(/\s+/).filter(w => w.length >= 2).slice(0, 8);

/** A line of markdown as plain text for a snippet: list markers, emphasis, table pipes and links reduced. */
const plainLine = (l: string): string => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^#+\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__|`)/g, '').replace(/\s*\|\s*/g, ' · ').replace(/^·\s*|\s*·$/g, '').replace(/\s+/g, ' ').trim();

export interface Hit { doc: MemoryDoc; lines: number; snippet: string }

/** The documents on a shelf that hold every word of the query, each with its matching lines and a snippet (the first
 *  matching line, or the first line of text when there is no query). */
/** Each document's lines and folded text, computed once per document (a keystroke must not fold 4 MB again). */
const prepared = new WeakMap<MemoryDoc, { lines: string[]; all: string }>();
function prepare(doc: MemoryDoc): { lines: string[]; all: string } {
  let p = prepared.get(doc);
  if (!p) {
    p = { lines: doc.text.split(/\r?\n/).filter(l => l.trim() && !/^\s*(---|\|?\s*:?-{3,})/.test(l)), all: fold(`${doc.title} ${doc.group} ${doc.text}`) };
    prepared.set(doc, p);
  }
  return p;
}
export function search(docs: readonly MemoryDoc[], shelf: Shelf, q: string): Hit[] {
  const ws = words(q);
  const out: Hit[] = [];
  for (const doc of docs) {
    if (shelf !== 'all' && shelfOf(doc.kind) !== shelf) continue;
    const { lines, all } = prepare(doc);
    if (!ws.length) { out.push({ doc, lines: 0, snippet: plainLine(lines.find(l => !/^#\s/.test(l)) ?? lines[0] ?? '').slice(0, 180) }); continue; }
    if (!ws.every(w => all.includes(w))) continue;
    const hits = lines.filter(l => ws.some(w => fold(l).includes(w)));
    const first = hits[0] ?? lines[0] ?? '';
    out.push({ doc, lines: hits.length, snippet: around(plainLine(first), ws) });
  }
  return out;
}

/** A snippet of at most 180 characters that starts shortly before the first word found. */
function around(line: string, ws: readonly string[]): string {
  const f = fold(line);
  const at = Math.min(...ws.map(w => f.indexOf(w)).filter(i => i >= 0), line.length);
  if (line.length <= 180 || at < 60) return line.length > 180 ? `${line.slice(0, 179)}…` : line;
  const start = Math.max(0, at - 50);
  return `…${line.slice(start, start + 170)}${start + 170 < line.length ? '…' : ''}`;
}

/** The order of the list: Adesso, the journal newest first, ideas, errors, then the notes by group and title. */
export function ordered(docs: readonly MemoryDoc[]): MemoryDoc[] {
  const rank = { now: 0, journal: 1, ideas: 2, errors: 3, knowledge: 4, shared: 5, agent: 6 } as const;
  return [...docs].sort((a, b) => rank[a.kind] - rank[b.kind]
    || (a.kind === 'journal' ? b.title.localeCompare(a.title) : a.group.localeCompare(b.group) || a.title.localeCompare(b.title)));
}

/** Where each word occurs in a text, folded the same way, for the highlight: [start, end) offsets. The folding keeps
 *  the length of plain letters; a letter with a combining accent folds to one, so offsets are found on a per-character
 *  fold of the original. */
export function ranges(text: string, ws: readonly string[]): [number, number][] {
  if (!ws.length) return [];
  const f = [...text].map(c => fold(c) || c).join('');
  if (f.length !== text.length) return [];
  const out: [number, number][] = [];
  for (const w of ws) for (let i = f.indexOf(w); i >= 0 && out.length < 500; i = f.indexOf(w, i + w.length)) out.push([i, i + w.length]);
  return out.sort((a, b) => a[0] - b[0]);
}
