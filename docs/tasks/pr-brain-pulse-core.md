Title: feat(jobs): add serial scheduler and bounded headless requests

<!-- Local review checkpoint for ADR 0070 implementers; not the complete Battito core PR. -->
Adds an agent-owned job scheduler with local slots, latest-missed-slot selection, durable claims supplied by its owner, visibility and test gates, and serial execution. Adds per-request timeouts, HTTP output caps and permission refusal to the shared headless runner. Startup now races the deadline, so an engine that never becomes ready is killed. Claude read-only sessions honor narrower tool policies.

This is an infrastructure checkpoint, not a merge-ready implementation of ADR 0070. No scheduler is wired to the app and no background model calls are enabled.

Blocking integration findings:

- The ADR asks for `userData/oneshot` and denies the whole home. On Windows userData is normally inside home; `HeadlessRunner` correctly refuses that working directory.
- `CodexSession.start` refuses read-only runs with denied folders because its sandbox permits reads without asking. Removing the check would weaken existing protection. The existing adapter has no verified digest-only route.
- Denying permission callbacks alone does not prove no reads: Claude needed an explicit empty tool list, while Codex and Cursor still require adapter-level isolation verification.

Remaining scope: verified CLI isolation, agent one-shot orchestration/fallback and run accounting, Battito preset, digest/cards/budget/actions/approvals, typed IPC, UI/settings/Costi/i18n, and the headline job. The later stacked branches have not been created.

Validation: scheduler unit tests (6) and headless one-shot tests (2) passed. Fresh-context review found the Claude tool-policy gap and missing test arguments; both were corrected. Final typecheck, existing runner regressions, lint and branch-check results are recorded in the local handoff. No e2e run on this branch; UI e2e belongs on main after merge.
