// Claim audit of PR #29 (in-app «Guida», src/shared/concept-guide.ts), card 'dashboard', point 3: «Token e contesto»
// flags "contexts above the threshold (default 200,000)". On main (src/shared/context.ts longAt, used by Dashboard.tsx
// through isLongChat) 200,000 (contextWarnTokens, labelled 'Soglia del contesto lungo per Cursor') is the threshold only
// for chats that report no window (Cursor); a Claude chat with a reported window is flagged at 80% of its compaction
// window. Fails while the card presents 200,000 as the one threshold. Review-only test.
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';
import { longAt, NEAR_COMPACTION } from '@shared/context';

const card = CONCEPTS.find(c => c.id === 'dashboard')!;

describe("card 'dashboard': the long-context threshold", () => {
  it('200,000 is the threshold only for chats without a reported window', () => {
    expect(NEAR_COMPACTION).toBe(0.8);
    // a Claude chat compacting at 200k is flagged at 160k, not 200k
    expect(longAt({ harness: 'claude', contextMaxTokens: 200_000, contextEstimated: false }, 200_000)).toBe(160_000);
    expect(longAt({ harness: 'cursor', contextMaxTokens: undefined, contextEstimated: false }, 200_000)).toBe(200_000);
    const point = card.points.find(p => p.en.includes('200,000'))!;
    expect(point).toBeDefined();
    // the card must say the 200,000 default is Cursor's (no window), Claude's being near its compaction
    expect(point.en).toMatch(/Cursor|compaction|window/i);
  });
});
