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

Integrator review fix: a Codex turn runs dozens of commands, and each became a child row. With the reducer capped at
500 rows and no eviction, a long session filled it with finished commands and then refused every new sub-agent. Now
at most the newest 20 finished commands are kept. When the reducer is full, the oldest finished row goes first: a
command first, an agent only if no command is left. Dropping an agent makes the census unknown, never wrong. A new row
is refused only when all 500 are unfinished. Shell rows are labelled "command" / "comando": the protocol does not say
whether a command runs in the background.

Validation (integrator, rebased on main 01a0bca):
- Provider/reducer tests for background acknowledgment, launch failure, command lifecycle, persisted start time,
  pruning to 20 finished commands (a sub-agent after 600 commands is still recorded) and eviction when full.
- Child selection and actual React component render tests, including Italian/English labels and escaped descriptions.
- `npx tsc --noEmit` and lint of the changed files pass; touched suites (agent-children, codex-children,
  agent-children-rows, child-strips-render) 24/24.
- `npm run check:branch`: unit 1205 passed, 2 failed, both timeouts in files this branch does not touch, both passing
  alone: correction-catch-hook "gives no warning when not ready, slow…" (hook runtime over 1400 ms under load) and
  compare/headless "a run past its time is killed". To check in the final gate on main.
- test/e2e/child-strips.spec.ts (collapsed/expanded screenshots, maximized visibility) has NOT run: e2e runs on main.

Limits: observations remain partial; no claim of a complete provider census is made. Start time means first seen,
not an invented engine start timestamp. Historical activity absent from saved telemetry cannot be reconstructed
from the aggregate background count. Main-only e2e and dev visual verification are still to do before release.
