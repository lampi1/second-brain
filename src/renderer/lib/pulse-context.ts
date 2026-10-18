// Contextual Battito selectors: keep search quiet and never send an absolute file path as a place.
import type { PulseCard, PulsePlace } from '@shared/pulse';

export function contextCards(cards: PulseCard[], place: PulsePlace): PulseCard[] {
  return cards.filter(c => c.places.includes(place) && (c.state === 'new' || c.state === 'seen') &&
    (place !== 'search' || c.type === 'collegamento' || c.type === 'curiosita')).slice(0, 2);
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
