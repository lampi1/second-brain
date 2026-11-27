// The Orchestrator's credentials card (ADR 0367, owner 2026-11-27: «dammi le credenziali di test 3»): how long a card
// lives and what is left of it. The card's item carries only an entry id and its group label; the values are read by
// main from the user's credentials file and reach only the renderer (credentials:card / credentials:reveal), never a
// model, a transcript or a log. Used by main/browser/card-gate.ts (the live window), main/appctl/credential-card-tool.ts (the
// tool) and renderer/components/CredentialCard.tsx (the countdown, the auto-hide). Tests: test/unit/appctl-credential-card.test.ts.

/** A card hides itself, and main stops answering for its entry, 10 minutes after it was shown. */
export const CREDENTIAL_CARD_MS = 10 * 60_000;

/** Whole minutes left before a card shown at `at` hides (0 = hidden now). */
export function cardMinutesLeft(at: number, now: number): number {
  const left = at + CREDENTIAL_CARD_MS - now;
  return left <= 0 ? 0 : Math.ceil(left / 60_000);
}
