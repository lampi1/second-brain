# Open issue sweep — 2026-10-28

## Changes

| Issues | Cause and resolution |
| --- | --- |
| #254, #255, #256 | Old periodic main stalls: removed routine cloning/executor in #260/#261. The owner's field log shows 14.4 stalls/min becoming approximately 1/min; #261 proved no routine IO while its view is closed. |
| #262 | New assignments still synchronously saved the complete ledger. They now use deferred writes; the chat checkpoint preserves their run mirror. Sorting ended runs is deferred until pruning is actually needed. |
| #265 | Each estimate IPC recalculated the full historical backtest on main. Identical calculation moves to a lazy read worker. |
| #267 | Memoria scanned files and calculated statistics on main. Read-only projection moves to the same worker. Optional corrupt reports remain fail-soft; evidence seeds stay frozen. |
| #263 | A recovered network retry warned and became a bug card. Progress is info; final exhausted/auth/permanent failures warn once and retain the last successful data. |
| #264 | Removed declarations remained attached to roles; embedded skills could also be falsely reported missing. Requested maintenance repairs only absent references against the actual launch inventory and preserves active know-how. |
| #266 | Forgotten generated skills had no persistent source exclusion; the change loader also dropped research records. Source markers and compatible history loading preserve the user's decision and Undo. |

## Verification and risks

Targeted regression tests cover coalesced persistence, recovered/exhausted/cancelled retries, migration repetition/history rollover/Undo, prior decisions, preserved editable role files, malformed reports, shared skill inventory and actual worker results/liveness. Native PR capture exercises the live terminal run, old screenshots, an idle routine trace, a ten-minute idle performance trace and a same-history synchronous/worker estimate comparison. Exact timestamps and results are attached to the PR after that run.

The synthetic dev profile is not the owner's Windows profile: it cannot prove their busy cursor or four-chat workload. Existing forgotten records already discarded by older builds cannot be inferred. Work does not publish a release or update the installed stable app.

## Test cleanup

Deleted `no-leftovers.test.ts` (two wording bans), `questions-modal.test.ts` (two source/config-absence assertions), `chat-no-delivery-banner.test.ts` (one CSS-name absence assertion), and the two stale full-window Windows PNG baselines/comparisons. These did not exercise the relevant user behavior; retained UI tests exercise actual modal operation, chat layout, palette and maximize/restore, with native screenshots for review. Historic `.guardallow` pins remain because history is still scanned.

Repaired accumulated main-only E2E fixtures: current manual maintenance and role-editor behavior, voice settings, scoped credential headings, read-only delegation tasks, fake-CLI word matching, canonical temporary paths, frameless window sizing, explicit proposal-release state and deterministic cancellation/queue timing. No test is newly skipped and security checks are not weakened.

Follow-up cleanup removes seven tests for the retired corner/top Orchestrator widgets and their seven helpers, which had no production callers. Preference-loading compatibility cases remain in `orchestrator-preferences.test.ts`; the current column keeps its geometry and UI tests. Native UI checks now use actual viewport bounds, respect inactive-window focus, and expand a narrow browser card before asserting its live caption.
