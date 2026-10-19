// Pure helpers of the brain's Script and Changelog pages (ADR 0076): the search and filters, the grouping by day and
// the day labels. Kept apart from the pages (which import the app's bridge) so unit tests load them without a window.
// Used by brain/pages/Script.tsx and brain/pages/Changelog.tsx; tests: test/unit/brain/scripts.test.ts.
import type { BrainScriptSummary, ChangelogEntry, ChangelogKind } from '@shared/contract';
import { lang, locale } from '../../i18n';

export type ScriptFilter = 'all' | 'ok' | 'fix';
const copy = (it: string, en: string) => lang() === 'en' ? en : it;
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Scripts matching every word (title, description, usage, tags, file, language) and the state filter. */
export function filterScripts(list: BrainScriptSummary[], q: string, f: ScriptFilter): BrainScriptSummary[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list.filter(s => (f === 'all' || (f === 'ok' ? s.tested.state === 'ok' : s.tested.state !== 'ok'))
    && words.every(w => fold([s.title, s.description, s.usage, s.file, s.language, ...s.tags].join(' ')).includes(w)));
}

/** "Oggi", "Ieri" or the date, for a day header. */
export function dayLabel(day: string, now = new Date()): string {
  if (day === isoDay(now)) return copy('Oggi', 'Today');
  if (day === isoDay(new Date(now.getTime() - 864e5))) return copy('Ieri', 'Yesterday');
  const d = new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Entries matching every word and the kind filter, grouped by day (newest day first, file order inside a day). */
export function groupChangelog(list: ChangelogEntry[], q: string, kind: ChangelogKind | 'all'): [string, ChangelogEntry[]][] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const m = new Map<string, ChangelogEntry[]>();
  for (const e of list) {
    if (kind !== 'all' && e.kind !== kind) continue;
    if (!words.every(w => fold(`${e.target} ${e.summary} ${e.by} ${e.kind} ${e.action}`).includes(w))) continue;
    const d = e.at.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), e]);
  }
  return [...m].sort(([a], [b]) => b.localeCompare(a));
}

