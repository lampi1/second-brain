// Exact-head review gate: incomplete, stale, failed and malformed local attestations never authorize publication.
import { expect, it } from 'vitest';
import { proposalReviews, REVIEW_DIMENSIONS } from '../../src/main/improve/reviews';

const head = 'a'.repeat(40), now = Date.parse('2026-10-17T12:00:00Z');
const ledger = () => ({ version: 1, reviews: { [head]: Object.fromEntries(REVIEW_DIMENSIONS.map(d => [d, { verdict: 'passed', reviewer: 'independent-reviewer', at: new Date(now).toISOString(), reportSha256: 'b'.repeat(64) }])) } });
it('requires all three fresh passed reviews for the full SHA', () => {
  expect(proposalReviews(ledger(), head, now)).toBe(true);
  expect(proposalReviews(ledger(), head.slice(0, 7), now)).toBe(false);
  expect(proposalReviews(ledger(), 'c'.repeat(40), now)).toBe(false);
  for (const dimension of REVIEW_DIMENSIONS) {
    const input = ledger(); delete input.reviews[head]![dimension];
    expect(proposalReviews(input, head, now)).toBe(false);
  }
  expect(proposalReviews(undefined, head, now)).toBe(false);
});
it('rejects expired, future, failed, missing-report and malformed attestations', () => {
  for (const patch of [
    { at: new Date(now - 8 * 86400000).toISOString() }, { at: new Date(now + 1).toISOString() },
    { at: 'bad' }, { verdict: 'failed' }, { reportSha256: '' }, { reviewer: '' },
  ]) {
    const input = ledger(); Object.assign(input.reviews[head]!.security!, patch);
    expect(proposalReviews(input, head, now)).toBe(false);
  }
});
