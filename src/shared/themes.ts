// The shape of /api/themes (SPEC 23 b): errors or ideas grouped by theme, computed in main (search/hybrid/themes.ts)
// and shown by renderer/dashboard/Themes.tsx (the ideas' themes on Memoria → Idee, the errors' themes on Qualità).

export type ThemeKind = 'errors' | 'ideas';
/** One error line or one idea, by its 1-based line in the brain file. */
export interface ThemeEntry { line: number; text: string; day: string | null }
/** `recent`: entries of the last 7 days; `before`: of the 7 days before; growing = clearly more now. */
export interface Theme { label: string; entries: ThemeEntry[]; recent: number; before: number; growing: boolean }
/** Two entries that say almost the same thing (cosine `score`). */
export interface Duplicate { a: ThemeEntry; b: ThemeEntry; score: number }
/** ready false: the model is not there yet (or has not embedded the file): nothing to group by meaning. */
export interface Themes { kind: ThemeKind; ready: boolean; entries: number; themes: Theme[]; duplicates: Duplicate[] }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const entryOf = (v: unknown): ThemeEntry => {
  const o = obj(v);
  return { line: num(o.line), text: typeof o.text === 'string' ? o.text : '', day: typeof o.day === 'string' ? o.day : null };
};

/** The renderer's guard on /api/themes: anything malformed becomes an empty, not-ready answer. */
export function normThemes(v: unknown): Themes {
  const o = obj(v);
  return {
    kind: o.kind === 'ideas' ? 'ideas' : 'errors',
    ready: o.ready === true,
    entries: num(o.entries),
    themes: list(o.themes).map(t => {
      const x = obj(t);
      return { label: typeof x.label === 'string' ? x.label : '', entries: list(x.entries).map(entryOf), recent: num(x.recent), before: num(x.before), growing: x.growing === true };
    }),
    duplicates: list(o.duplicates).map(d => { const x = obj(d); return { a: entryOf(x.a), b: entryOf(x.b), score: num(x.score) }; }),
  };
}
