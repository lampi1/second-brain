// Text helpers of the brain pages: names not numbers (a work item without its "[Area] - " prefix, a leading "#<id>" and
// commit prefixes dropped), counts and sums. Pure (no DOM), unit-tested in test/unit/brain-ui/text.test.ts. The owner's
// name is never in the code: it is read from the data (ownerOf) and only used to turn third-person lines into first
// person.
import type { Idea } from '../types';

export const short = (s: unknown, n = 80): string => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** drop a leading "#<id>", a conventional-commit prefix and double spaces */
export const clean = (s: unknown): string => String(s ?? '').replace(/^\s*#\d+\s*/, '').replace(/^\s*(fix|feat|chore|refactor|docs|test|perf|build|ci|style)(\([^)]*\))?!?:\s*/i, '').replace(/\s+/g, ' ').trim();
/** a work item title without its "[Area] - " prefix */
export const bugName = (t: unknown): string => clean(String(t ?? '').replace(/^\[[^\]]+\]\s*-?\s*/, ''));
export const topicOf = (t: unknown): string => String(t ?? '').match(/^\[([^\]]+)\]/)?.[1] ?? '';
export const quote = (s: string): string => `«${s}»`;
export const baseName = (s: unknown): string => String(s ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The brain owner's name as the data writes it: the most common author of the ideas that are not the AI's. */
export function ownerOf(ideas: Pick<Idea, 'chi'>[]): string {
  const n = new Map<string, number>();
  for (const i of ideas) if (i.chi && i.chi !== 'IA') n.set(i.chi, (n.get(i.chi) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
/** "<Owner> decide se…" → "decide se…" (lines written about the owner, read by the owner) */
export const firstPerson = (s: string, owner: string): string => (owner ? s.replace(new RegExp(`\\b${escRe(owner)}\\s+`, 'g'), '') : s);

/** Count rows by a key, most frequent first ('—' for empty). */
export function countBy<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r) || '—'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'));
}
export const sum = (a: number[]): number => a.reduce((x, y) => x + (y || 0), 0);
