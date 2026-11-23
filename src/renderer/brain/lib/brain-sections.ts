// Pure helpers of the Log page (ADR 0111): the day labels. Kept apart from the page, which imports the app's bridge.
// Used by components/LogPage.tsx.
import { locale, t } from '../../i18n';

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Oggi", "Ieri" or the date, for a day header. */
export function dayLabel(day: string, now = new Date()): string {
  if (day === isoDay(now)) return t('brainText.sections.today');
  if (day === isoDay(new Date(now.getTime() - 864e5))) return t('brainText.sections.yesterday');
  const d = new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}
