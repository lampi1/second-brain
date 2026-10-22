// Pure helpers of the brain's Script page (ADR 0076) and the Log page (ADR 0111): the scripts' search and filters and
// the day labels. Kept apart from the pages (which import the app's bridge) so unit tests load them without a window.
// Used by brain/pages/Script.tsx and components/LogPage.tsx; tests: test/unit/brain/scripts.test.ts.
import type { BrainScriptSummary } from '@shared/contract';
import { locale, t } from '../../i18n';

export type ScriptFilter = 'all' | 'ok' | 'fix';
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
  if (day === isoDay(now)) return t('brainText.sections.today');
  if (day === isoDay(new Date(now.getTime() - 864e5))) return t('brainText.sections.yesterday');
  const d = new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}
