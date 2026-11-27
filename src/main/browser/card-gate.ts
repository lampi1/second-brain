// The gate of the Orchestrator's credential card (ADR 0367): an entry the card shows is live for CREDENTIAL_CARD_MS from
// the moment app_show_credentials matched it; only while it is live does main answer the renderer its URL and user
// (credentials:card) and, on «Mostra», its password (credentials:reveal). An id that was never shown, has expired or no
// longer names one test entry gets null; the entry is read from the file again at each answer (logins.ts cardEntry
// re-checks production). Pure apart from the clock; logging stays with the caller (browser/service.ts), id only.
import type { CardMatch } from './logins';
import { CREDENTIAL_CARD_MS } from '../../shared/credential-card';

export interface CardSource {
  cardMatch(ref: string): CardMatch;
  cardFields(id: string): { user: string; url?: string } | null;
  cardPassword(id: string): string | null;
}

export function cardGate(src: CardSource, now: () => number = Date.now) {
  const live = new Map<string, number>();
  const isLive = (id: string): boolean => {
    const until = live.get(id);
    if (until === undefined) return false;
    if (until <= now()) { live.delete(id); return false; }
    return true;
  };
  return {
    /** app_show_credentials: the match (id and group, or a refusal); a hit goes live for CREDENTIAL_CARD_MS. */
    match(ref: string): CardMatch {
      const m = src.cardMatch(ref);
      if ('id' in m) live.set(m.id, now() + CREDENTIAL_CARD_MS);
      return m;
    },
    fields: (id: string) => (isLive(id) ? src.cardFields(id) : null),
    reveal: (id: string) => (isLive(id) ? src.cardPassword(id) : null),
    isLive,
  };
}
