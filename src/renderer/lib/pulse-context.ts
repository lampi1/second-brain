// Contextual Battito selectors: keep search quiet and never send an absolute file path as a place.
import type { PulseCard, PulsePlace } from '@shared/pulse';

/** The live cards of a place, at most `max` (2 in a context, 3 on the board). */
export function contextCards(cards: PulseCard[], place: PulsePlace, max = 2): PulseCard[] {
  return cards.filter(c => c.places.includes(place) && (c.state === 'new' || c.state === 'seen') &&
    (place !== 'search' || c.type === 'collegamento' || c.type === 'curiosita')).slice(0, max);
}

export function filePulsePlace(path: string, root: string | null | undefined): PulsePlace | null {
  const normalized = path.replace(/\\/g, '/');
  const base = root?.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = /^(?:[a-z]:|\/)/i.test(normalized);
  const relative = absolute && base && normalized.toLowerCase().startsWith(base.toLowerCase() + '/')
    ? normalized.slice(base.length + 1) : absolute ? null : normalized;
  if (!relative || relative.split('/').some(s => !s || s === '.' || s === '..') || relative.includes(':')) return null;
  return `file:${relative}`;
}

/** "08:30, 13:00" (Settings → Notifiche, PulseSettings.tsx) → the sorted slots, or null when it is not one to three
 *  HH:MM times. */
export function parseSlots(text: string): string[] | null {
  const list = [...new Set(text.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).map(s => (/^\d:\d\d$/.test(s) ? `0${s}` : s)))];
  return list.length >= 1 && list.length <= 3 && list.every(s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)) ? list.sort() : null;
}
