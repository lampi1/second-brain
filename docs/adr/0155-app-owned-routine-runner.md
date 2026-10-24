<!-- Routines run by the app, not by the Orchestrator chat: runner, triggers, single-item starts, scripts/queries, prod safety, Routine page. For maintainers and reviewers. -->
# 0155 — The app runs routines; the Orchestrator observes

Date: 2026-10-24

## Context

Routines (flows, ADR 0145-0148) advanced only while an Orchestrator chat stayed open and took a model turn for each
trigger event. A closed or busy Orchestrator stalled them, a manual start had no rule grant ("Execution adapter
unavailable"), script and query steps always blocked, and the page showed a self-healing bugfix as "needs you".

## Decision

**Runner.** `createFlowRuntime` (main process) owns every run: it starts trigger events itself (`startEvent` with the
rule's owner), launches agent steps as fresh role chats, runs test scripts/queries, heals failures and finishes runs.
State lives in the existing revision-guarded `FlowService` store; a restart resumes from the last completed step (a
step interrupted mid-way is blocked and heals like any failure, an open command receipt is closed as interrupted).
Runs started without an Orchestrator belong to `app`. Owner checks no longer gate advancing, binding or restarting.

**Self-heal.** A failed step is retried with the failure in its prompt while attempts remain (`hostRetry`); a step with
`onFail.goto` sends the work back to that step instead (`sendBack`). Reasons prefixed `Da sistemare: ` (changed
content, missing input or workspace, no adapter) never heal. Only blocks that need a person, and prod commands waiting
for «Esegui», notify the Orchestrator (`healable()` in `shared/routine.ts`, read by runner and page alike).

**Lock.** `userData/flows/runner.lock` (pid, heartbeat, token; stale after 60 s, taken with an exclusive create):
never two runners on one store. Each tick pumps active, blocked (to heal) and waiting runs; a prod command that
was running when the app closed is closed as interrupted and stops for the user; a waiting prod command is
recomputed and re-shown (or stopped) when its inputs or file change. Healing a timed-out step stops its old chat first.

**Triggers.** DevOps rules take include/exclude tags, work item ids, an iteration path and a maximum of starts per hour.
One active run per work item per flow: a newer revision of a running item updates that run's input, a newer revision
of a waiting item replaces its event. Pausing a rule (or the global pause) stops new events and revokes its grants at
once. «Svuota coda» discards exactly the count the user saw.

**One item by hand.** «Avvia su un work item» (page) and `app_flow_start_item` (Orchestrator, on the user's request):
pick a routine, paste an id or link, see the preview (filter misses as warnings, another project or an active run as
blockers), add typed params and attachments, start. A routine with an approved rule starts through `startManual`, so
manual and automatic starts use the same grants and steps. A dry run resolves every step and executes nothing.

**Scripts and queries.** A `check` step may run a saved brain script or query, pinned by sha256 at propose time and
rechecked before every launch. Arguments come from typed params (validated before a run exists), run inputs and
attachments (content-addressed, hash-checked, readable as `{{attachment:name}}`). Scripts run without a shell by
extension (ps1, py, js, sh; cmd/bat on Windows only, refusing cmd metacharacters); queries run through
`sqlcmd -E -b` (integrated auth, `-K ReadOnly` for read-only steps). Output is bounded; every run is a receipt. What a
run input puts into an argument may not turn a test step to prod, start with `-`, or (for a query) carry quotes,
`;`, comments or line breaks; a query's `server` and `database` are literal in the definition. A script/query step
with effect `production` must declare `env: prod`.

**Production.** A step with `env: prod` (or effect `production`) never runs by itself, from an agent or from a tool.
The page shows the exact command with «Esegui»; only that click (renderer IPC `flows:runCommand`) runs it, after the
app recomputes the command and checks it equals both the stored and the shown text. Owner's decision, 2026-10-24.
AGENTS.md rule 5 now says this.

**Models per step.** Every agent step takes an engine, model and effort pick on the open routine; a pick applies at
once as a new active version (a role-less step pins the role it ran as). A restart from a step moves the run to the
active version when the steps before it are unchanged, otherwise it keeps its own version.

**Orchestrator.** `app_flow_overview` (one plain row per run), `app_flow_message` (a note into the chat working on the
current step), `app_flow_start_item` (dry run first when asked). It never runs a prod command: it has no tool for it.

**App closed.** The tray keeps the app (and the runner) alive while a run is open or background mode is on, and shows
the active routine count. A headless runner without the app is not built: engines, chats, logins and the MCP host
live in the app's main process, so a second process would duplicate them or run without them. The lock keeps the
door open for one later.

**Export.** JSON/Markdown export carries engine, model, effort, params, arguments, `onFail` and the pinned script/query
text with its hash (credentials masked, flagged), so a cloud agent gets the same steps with the same models. Import
never writes those files into a brain.

**Page.** Routine has three tabs: Adesso (only what needs the user, then runs working by themselves with their heal
banner), Routine (each routine in plain words, its trigger switch and queue; open one for steps, per-step models,
filters, export and dry run), Storico (finished runs with receipts). Mockups: `docs/mockups/routines/`.

## Consequences

Routines keep running with no Orchestrator open. The Orchestrator rules (`orchestrator-role.ts`) say the app runs
routines and that a duplicate run must never bypass a blocker. ADR 0148's "the Orchestrator owns initial starts and
trigger handling" no longer holds. Tests: `test/unit/routine-runner.test.ts` (manual start to step 2, dedup, queue,
prod only on «Esegui», dry run, restart after a version bump), `test/unit/flows/executor.test.ts`,
`test/unit/flows/lock.test.ts`, `test/unit/routine-view.test.ts`, `test/e2e/routine.spec.ts` with screenshots.
