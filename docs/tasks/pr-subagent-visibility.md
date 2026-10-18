Title: feat(chats): show internal agents and command activity beneath parent strips

<!-- PR handoff for the release integrator: behavior, evidence and outstanding gates for child visibility. -->

The engine adapters already collected internal child observations, but the Grindhouse only exposed them through
the identity details popover. A parent could report background work without any corresponding child strips.
Commit 6eda5ef introduced the existing telemetry and details UI; this change connects that telemetry to the grid
and the separate Orchestrator tile.

Each observed child now has an indented strip with its description, explicit state and first-observed start time.
Running, waiting and unknown children remain listed; the latest three terminal children stay visible and older
terminal rows are expandable. Collapsing, expanding or maximizing the parent does not remove its child rows.
Labels are available in Italian and English. Existing saved rows fall back to their observation timestamp.

Claude Agent/Task and native background agent/Bash events and Cursor ACP task events reuse the existing adapters.
Rejected Claude background Agent launches now settle as failed. Codex commandExecution items now produce shell
rows alongside existing collabAgentToolCall/subAgentActivity observations. The protocol does not distinguish
foreground from background commands, so both are shown and only command item completion settles them.
Counts of agents continue to exclude shell commands. No new IPC, hooks, dependencies or permissions are added.
Claude nested Agent/Task messages are now observed even when their transcript is intentionally hidden from the
parent conversation; a regression test covers the nested synchronous lifecycle without transcript leakage.

Validation:
- Added provider/reducer tests for background acknowledgment, launch failure, command lifecycle and persisted start time.
- Added child selection and actual React component render tests, including Italian/English labels and escaped descriptions.
- Added test/e2e/child-strips.spec.ts with collapsed/expanded screenshots and maximized visibility assertions.
  This spec has NOT run: e2e runs only on main after merge, and this brief forbids starting the app.
- npm.cmd run check:branch FAILED at typecheck: missing highlight.js and pdfjs-dist dependencies in this checkout.
  A new test cast reported in that run was corrected. Check metadata also cannot be written (EPERM).
- Targeted Vitest run BLOCKED before executing tests: EPERM creating its temporary ssr directory. No tests passed.
- npm.cmd run build BLOCKED by esbuild Access is denied resolving the entry from this sandbox. No app was started.
- Targeted lint passed on all changed code files, including the final nested-Claude addition. Repeated typecheck
  after the mock fix reports only missing highlight.js/pdfjs-dist dependencies; the branch gate is still not green.
- git diff --check passed. Staging was attempted once and denied creating index.lock: work remains uncommitted.

Limits: observations remain partial; no claim of a complete provider census is made. Start time means first seen,
not an invented engine start timestamp. Historical activity absent from saved telemetry cannot be reconstructed
from the aggregate background count. The Regia must run the fresh visible review, dependency setup if needed,
branch checks, main-only e2e and dev visual verification before release. This work is not yet release-validated.
