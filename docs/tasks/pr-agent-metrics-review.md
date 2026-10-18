Title: fix(agents): review fixes for agent metrics (A6)

<!-- PR handoff for the agent metrics review fixes; maintained by the fixing agent for the human opening the PR. -->

## Summary

Fixes the three findings of the correctness review of PR 22 (agent metrics A6, already merged), written in
`docs/reviews/pr-22.md` on the `review/pr-22` branch. The review's failing tests now live in
`test/unit/chats/agent-metrics-review.test.ts`, with their assertions unchanged, and pass.

## What changed

- **High: a pruned run was counted again after every restart.** When a run was rolled up and pruned, its chat was
  left with no run, so `backfillRuns` gave it a new v0 run on the next start. That v0 run was counted again (once per
  restart). The chat now keeps the pruned run's id (`runPruned` in the chat record and in `chats.json`, saved only
  when the chat has no run). It is set when the store prunes the run (`onPrune`) and when the chat's saved copy of the
  run is dropped at load (`adopt` returns undefined). `backfillRuns` skips these chats. `store.ts` keeps the field
  only when it is a well-formed run id. `RUN_ID` is now exported from `agents/runs.ts`.
- **Medium: a run report could go to the wrong turn.** `turnAt` is now cleared when the chat goes `idle`, `error` or
  `closed`, and when its session exits. So a turn that ends without a result no longer lends its start to a later
  turn. In `turnEnded`, if the chat is still `running` after the result, a queued turn follows: it starts at that
  result's time. Otherwise `turnAt` is cleared.
  A fresh `effortSubmitted` event resets the timestamp too: Claude may start a new turn while still reporting
  running during its delayed idle interval. That later turn must not replace an already completed run's report.
- **Low: `agents:metrics` failed when `agent-runs.json` could not be written.** `runMetrics` now logs a failed flush
  and still answers from memory.

## Tests

Ran (Windows 11, Node, vitest 5):

- `npx tsc --noEmit -p tsconfig.json`: pass.
- `npx eslint src/main/chats/manager.ts src/main/chats/store.ts src/main/agents/runs.ts test/unit/chats/agent-metrics-review.test.ts`:
  clean.
- `npx vitest run test/unit/chats/agent-metrics-review.test.ts`: 11 passed. These are the 4 review tests plus 7 new
  ones:
  - the `runPruned` id in `chats.json`;
  - a saved run copy dropped at load, then two restarts;
  - `store.ts` parsing of `runPruned`;
  - a session exit mid-turn;
  - a result followed by idle;
  - metrics from memory still show the open run.
  - a fresh turn during Claude's delayed idle cannot overwrite a completed run's report.
  
  The previous agent verified that against the old source, 9 of its original 10 tests fail; the result-then-idle one is a guard against regressions. The session-exit
  test also fails when only the new line in the `exit` handler is removed.
- Related suites: 18 files, 231 tests, all passed:
  - `agent-collector`, `agent-runs`, `chats/agent-runs-manager`, `mem-run`, `run-metrics`, `run-report`;
  - `chats/manager`, `correction`, `contract`;
  - `chats/archive`, `chats/resume`, `chats/handoff`, `chats/cold`;
  - `chats/orchestrator`, `chats/claude`, `chats/regia-delivery`, `chats/auto-close-manager`.

Not run:

- The full unit suite and the e2e. Per AGENTS.md, the e2e runs only on main.
- No platform-specific tests were skipped: none of the files above uses `skipIf`/`runIf`. These ran on Windows.

## Handoff verification

- Rebased the three existing fixes onto origin/main at f875516 (no conflicts).
- Fresh correctness review found the delayed-idle case above; after the fix, no further findings.
- Re-ran the 11 regression tests and all 31 Claude harness tests successfully.
- No e2e or manual dev-app verification performed in this continuation.
