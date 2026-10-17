// Exact-head local review attestations consumed by ProposalBridge. Written by record-proposal-review.mjs.
// Like sb-checks.json this is a local workflow ledger, not a cryptographic identity or an agent permission.
export const REVIEW_DIMENSIONS = ['correctness', 'security', 'usability'] as const;
export function proposalReviews(input: unknown, head: string, now = Date.now()): boolean {
  if (!input || typeof input !== 'object' || !/^[0-9a-f]{40,64}$/.test(head)) return false;
  const ledger = input as { version?: unknown; reviews?: Record<string, unknown> };
  if (ledger.version !== 1 || !ledger.reviews || typeof ledger.reviews !== 'object') return false;
  const row = ledger.reviews[head] as Record<string, unknown> | undefined;
  return !!row && REVIEW_DIMENSIONS.every(dimension => {
    const review = row[dimension] as { verdict?: unknown; at?: unknown; reviewer?: unknown; reportSha256?: unknown } | undefined;
    if (!review || review.verdict !== 'passed' || typeof review.reviewer !== 'string' || !review.reviewer.trim() || typeof review.at !== 'string' || typeof review.reportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(review.reportSha256)) return false;
    const at = Date.parse(review.at);
    return Number.isFinite(at) && at <= now && now - at <= 7 * 24 * 60 * 60 * 1000;
  });
}
