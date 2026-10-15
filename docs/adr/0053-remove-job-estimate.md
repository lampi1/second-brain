# ADR 0053 · Remove the per-job cost/time estimate ("Quanto costerà?")

Date: 2026-10-15 · Status: accepted · Supersedes: ADR 0030's "one estimator in the app"

## Context

Since ADR 0030 the app showed a cost/time range for every job (chat tile chip, the Costi page's "Stime e costi reali"
and its "Quanto costerà?" calculator), backed by the brain's own table when it had one, else the app ledger's keyword
estimate. The brain's own backtest on 178 past chats found the real cost fell inside the shown range only 47% of the
time (an 80% range held 47%, not 80%), and the median absolute error ($11) was bigger than the median cost itself
($5): on these numbers the per-kind/per-area estimate is no better than just answering "the median of all chats", so
it is not worth the UI, the per-job prediction recorded before the run, or the upkeep.

## Decision

- **Remove the estimate end to end**: the `Estimates`/`Calculator` UI in `Costi.tsx`, the chat tile's estimate chip,
  `estimateText`/`estimateTip` (`lib/format.ts`), the `estimate:get` IPC channel, `ChatSummary.estimate`,
  `ChatManager`'s `estimateFor` hook and the `kind`/`jobAt`/`jobTitle` fields that only fed it, `BrainService.estimate`
  /`recordPrediction`, the brain's `withBrain`/`lookup`/`kindOf`/`BrainEstimate`/`PredictionInput`/`predictionLine`
  (brain-estimates.ts) and the ledger's `estimate()`/`estimateFrom`/`percentile`/`MIN_SAMPLES` (estimates.ts).
- **What stays, and why**:
  - **The job ledger** (`estimates.ts`'s `Ledger`, `jobs.jsonl`, IPC `estimate:record`): every job's real cost and
    time are still recorded (`recordJob`, wired from `wiring.ts`'s `onTurnEnd`) — actuals are honest data, not a
    prediction, and the brain's own `estimates.mjs` reads them.
  - **The brain's table and `areaOf`** (`brain-estimates.ts`'s `BrainEstimates.table()`/`schedule()`, `areaOf`): model
    routing (`brain/routing.ts`'s `routeChat`, `isAppChat`) still groups chats by area/kind from this table; removing
    the user-facing estimate does not touch routing.
  - **The keyword classifier** (`estimates.ts`'s `classify()`/`RULES`): `Ledger.record()` still falls back to it when
    a job is recorded without an explicit kind.
- Unit and e2e tests that only covered the removed UI/plumbing were deleted or trimmed (`test/unit/brain/estimates.test.ts`,
  `test/unit/brain/brain-estimates.test.ts`, `test/unit/chats/manager.test.ts`, `test/unit/ui-lib.test.ts`,
  `test/e2e/brain-ui.spec.ts`, `test/e2e/chat-duration.spec.ts`, `test/e2e/brain.spec.ts`); coverage of the kept parts
  (classify, the ledger's record/backfill, `areaOf`, the brain table's read/refresh/schedule) was kept or adapted, not
  weakened.

## Consequences

- A chat tile and the Costi page no longer promise a number the data does not support; the "stima senza dati" copy and
  its calculator are gone.
- Routing is unaffected: it never used the per-job estimate, only the brain's area/kind table, which this ADR keeps.
- The brain's self-improvement loop's `'estimates'` domain and Miglioramento page card (ADR 0030, outside this task's
  scope) may now receive no new app-sourced predictions; the Miglioramento page itself is not part of this change.
