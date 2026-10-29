# ADR 0175 · One routine runtime for the app and the terminal: `packages/routine-runtime`

Status: partly superseded by ADR 0179 (app-execution portions); accepted (2026-10-27, owner decisions relayed by the «App · motore routine unico (app + terminale)» thread:
"chill con i permessi", "standalone"; staging approved: the legacy FlowRuntime is removed by the Routine UI task).

## Context

Routines ran only inside the Electron app (`src/main/flows/runtime.ts`): each agent step was a role chat bound by the
app (Artisan, Scout...), completed by `agent_report`, gated by grants and approvals, and wrote DevOps through app MCP
tools. The owner wants the same routine to run from a terminal with no app and no brain, with less ceremony: an
automatic routine has no human in the loop, so app questions and approval panels only stall it.

## Decision

1. **A package, not a module of main.** `packages/routine-runtime/` holds the runtime. It never imports Electron or
   `src/main`, `src/renderer` or `src/preload`. This is enforced by an ESLint `no-restricted-imports` block and by
   `test/unit/routine-runtime/boundary.test.ts`. It may import types from `src/shared`.
2. **A step is a plain Claude Code session**: `claude -p --output-format stream-json --verbose --permission-mode auto`,
   in the app and in the terminal alike. There are no roles, no role catalog, no app MCP tools and no run-time
   approvals. A step declares a prompt, an optional model and effort, optional allowed tools and optional MCP servers
   (package-declared).
3. **Completion is a file.** The session writes `step-result.json` in its step folder. The runtime validates it
   (`validateStepResult`); a missing or invalid file is a failed attempt. The file may list DevOps writes (comment,
   state, fields, tags). The runtime executes them on the run's work item only, within the package's `devops` grant,
   idempotently (run ledger + a hidden marker in comments), with the run's TokenProvider.
4. **Ports**: EngineRunner, BrowserDriver (the login-form `LoginPageDriver`, driven by the routine browser, item 15), CredentialStore, TokenProvider (az CLI
   `Bearer` or package PAT `Basic`), Paths, Masker, RuntimeLog, Clock. The app adapts them in
   `src/main/flows/routine-host.ts`; the package ships terminal defaults (`claude.ts`, `token.ts`).
5. **Run folder** `<runsRoot>/<runId>/`: `run.json`, `steps/<n>-<stepId>/{prompt.md, transcript.jsonl, step-result.json,
   evidence/, screenshots/}`, `report.md`, `events.jsonl`. Every text the runtime writes passes through the run's
   Masker (`***`). `readRun`/`listRuns` are the documented reader; `progressFrom` folds `events.jsonl` (one JSON
   event per line, a partial last line ignored) into the live progress a UI or a terminal shows.
6. **Resume is in place.** `resume(runId)` reruns the same run from its first unfinished step. Each start or resume
   takes the next `attempt` number (the fence). A runtime whose attempt is no longer the run's current one stops
   writing (`StaleAttempt`).
7. **Single work item = trigger path.** `startItem(id)` and a trigger hit both call `start({ workItem })`. The id fills
   `{{workItem}}` (and the legacy `{{work-item-id}}`), and DevOps writes can only target it.
8. **Human needed = DevOps, never the app.** A step answering `needs-human` makes the runtime write one comment that
   mentions the package's escalation contact, then poll the item's comments. Only a later reply by that identity
   counts, and it reaches the next attempt as guidance. There is at most one reminder.
9. **The trigger is shared.** `createTriggerLoop` runs the pinned WIQL detector (moved here from `src/main/flows`). It
   starts one run per work item and keeps its dedup state in the run store (`trigger.json`), so a restart or a second
   loop never re-runs an item that is done or in progress.
10. **Optional read-only test DB** (bonus, never a blocker): the package may declare SQL Server test targets. They are
    refused at load and again at run time if they look like production or are not on the host's recognised list. A
    step reaches them through the package's own stdio MCP server (`testdb-mcp.ts`). It reuses the app's SELECT-only
    guard and the rollback-only tedious driver. Reachability is probed once per step with a 10 s timeout; an
    unreachable DB is recorded as "DB unavailable" and the step goes on.
    **Which targets count as test** (`checkTestDbTarget`, exported; the same rule at load, in `preflightRoutinePackage`
    and before each step): system databases and any server or database name that looks like production (`prod`, `prd`,
    `production`, `live` as a word) are always refused. A host with a list of recognised test targets (the app's test DB
    configuration; the CLI's `--test-dbs <file.json>`, a JSON list of `{ server, port, database }`) accepts only those,
    by exact server, port and database. Without a list, the server or the database name must say test (`test`, `tst`,
    `dev`, `qa`, `uat`, `stag[ing]`, `demo`, `sandbox`, `local[host]`).
11. **DevOps access: the runtime's own adapter, not an external MCP.** Writes go only through the runtime's REST
    adapter (`devops.ts`), after the step ends, from `step-result.json`, recorded in the run's write ledger. A session
    reads DevOps through the package's read-only stdio MCP server (`devops-mcp.ts`: work item, comments, attachments of
    the run's projects). Neither the oris-devops server nor Microsoft's Azure DevOps MCP is used: both expose writes
    to any item, so the grant (run's item, declared ops and fields) could not be enforced, and the terminal would need
    them installed.
12. **Verify, then decide; the ledger never blocks a run.** A write whose outcome is lost (crash, network) is checked
    on DevOps: present → done; absent → retried once; unclear (the read failed) → "not verified", noted in the report,
    and the run continues. No "unknown outcome" state stops a run or asks a human.
13. **Migration**: `convertFlowToPackage` turns the app's existing JSON export (`second-brain-flow`) into a package.
    Roles, tiers, engines and app-only fields are dropped; approval steps are removed and listed. Legacy runs stuck in
    cleanup, or holding a pending write in the old `devops-writer` journal, are migrated once per brain context with
    the same verify-then-decide rule (`migrateLegacyWrites`): each pending write becomes done or not done, an unclear
    one stays as it is, and the runs end with no human step. The cause of the stuck runs, code-confirmed only: the old
    reconcile proposal needs a `blocked` run, while cleanup runs are already `cancelled` or `completed`, so every
    reconcile got the generic "Pending write or run changed" refusal. The legacy path is not fixed: it is no longer
    reached. A legacy run still active (some step progressed, no package run linked, no pending write) is never
    restarted from step 0: it is recorded as a cancelled package run "interrupted by migration" (`recordInterruptedRun`:
    run folder, report, events), and its work item is marked in the trigger state so the trigger does not start it
    again; a person reruns it with `routine run <package> --input workItem=<id>` (owner decision M2, 2026-10-27).
14. **The app hands every run to the package.** `createFlowRuntime({ routineHost })` (wired in `wiring.ts`) sends each
    app run (Routine page start, single work item, trigger) to `routine-host.ts`: the active version is converted, run
    or resumed in place (app run ↔ package run links in `routine-runs/links.json`), and its run folder is mirrored into
    the app's run view (`FlowService.mirrorPackageRun`; approval steps follow their next step). The app trigger goes
    through `createTriggerLoop` on the routine's run store; the app's queue starts only what the loop started.
15. **The browser belongs to the runtime, in the app and in the terminal alike** (owner decision 2026-10-27). A package
    declares `routine.browser.origins` (http(s) origins) and a step opts in with `browser: true`. That step's session
    gets the runtime's stdio MCP server `routine-browser` (`browser-mcp.ts`; tools `navigate`, `snapshot`, `click`,
    `type`, `select_option`, `screenshot`). It drives one Playwright Chromium page (Edge on Windows when Playwright's
    Chromium is not installed), headless unless the host asks otherwise. Main-frame navigations outside the declared
    origins are aborted. `type` refuses password fields. The runtime logs in itself: when a page lands on a package
    credential's login path, the server goes to the stored loginUrl (query included, Air's `?mode=local`), fills it
    with `driveLogin`, then returns to the page the agent wanted; this also covers an expired session. Credential
    values are masked in every reply. Screenshots go to the step's `evidence/` folder and to `events.jsonl` at once.
    The cookies live in one temp profile folder per run, removed when the run ends; the Chromium process lives with
    the step's server process. No shared CDP port is opened, so no other local process can drive a logged-in browser.
    The app's Electron tabs and its `site-login.ts` stay for non-routine browsing only.
16. **Dependency**: `playwright-core` 1.63.0 (exact; published 2026-09-04, more than 14 days before it was added on
    2026-10-27; Apache-2.0, no dependencies) becomes a runtime dependency of the app and of the terminal package, for
    item 15. It was already in the lockfile through `@playwright/test`. The app's build keeps it out of the MCP bundle
    and copies it into `out/node_modules`.
17. **The `routine` command** (`packages/routine-runtime`, bin `routine`, `src/cli.ts`). It has three commands:
    `run <package> [--input k=v]... [--from-step id]`, `resume <run folder>` and `watch <package>`.
    - A package is a folder, its routine.json or the app's `.zip` export. A small reader (`zip.ts`, stored and
      deflated entries, every path checked) extracts the zip into a private temp folder.
    - Every start runs `preflightRoutinePackage` first. Any error stops the start with exit 1 and prints the fix.
    - Only `--engine claude` exists; any other engine is refused with exit 2.
    - `run` writes `package-source.json` into the run folder, so `resume` finds the package (`--package` overrides it).
    - Ctrl+C on `run` cancels the run, prints the resume command and exits with 130.
    - `watch` drives the shared trigger loop, one poll per `everyMinutes`. Ctrl+C stops the polling, cancels its
      running runs (they stay resumable) and exits with 0.
    - Progress comes from `events.jsonl` through the shared reducer (`terminal.ts`). The report path is printed at
      the end.
    - `npm run build` bundles `dist/routine.mjs` and `dist/routine-mcp.mjs` with esbuild. Only `playwright-core` stays
      outside the bundle. No new dependency is added: esbuild is already in the repo.
18. **Every DevOps write of the old host writer is a step-result write** (owner decision 2026-10-27). Besides comment,
    state, fields and tags, `step-result.json` may list: `create-test-plan`, `rename-test-plan`, `create-test-suite`,
    `create-test-case`, `set-test-outcome`; `create-pr`, `link-pr`, `relate-pr`, `relate-work-item`, `pr-comment`,
    `publish-pr`, `abandon-pr`; `push-branch`, `queue-pr-validation`, `deploy-test`, `cancel-test-deploy`; and
    `downgrade` (the last write of its step). `devops-ops.ts` runs them after the step, with the behaviour of
    `devops-writer.ts` and the legacy downgrade cleanup, through the host modules moved to `devops-host/`.
    - Each op needs its category in `devops.ops` (`test-plans`, `test-results`, `pr-create`, `pr-links`,
      `related-links`, `pr-comment`, `pr-publish`, `pr-abandon`, `git-push`, `test-deploy`, `pr-validation`,
      `test-environment`, `downgrade`) and, where it applies, `devops.mentions`, `devops.pushTargets`,
      `devops.deployTargets` or `devops.downgrade`. Anything else is refused before a call is sent; the preflight
      checks the same.
    - Created resources stay in the ledger entry's `resource` (plan, suite, case and outcome by the session's `ref`,
      run-wide; the run's one PR; the pushed branch and commit; the deployment's build and release). The next prompts
      list them, so a later step names them by ref.
    - The suite gets a Related link to the run's work item and its name is read back for the next step; a test case
      gets no link to the work item (it reaches it through the suite), and may carry description, priority and tags.
    - Same rule as item 12: a lost outcome is re-read on DevOps (test cases by exact title in the project, the PR by
      source, target and title, comments by a run marker, the branch by its ref); present → done, absent → one retry,
      unclear → "not verified". A refusal (HTTP 4xx, a broken precondition) → "failed". Nothing blocks the run; texts
      and reasons are masked.
    - `deploy-test` waits for the PR merge build (one read a minute, up to `waitMinutes`), deploys through the shared
      `TestDeploymentCoordinator` (state in `<runsRoot>/test-deployments.json`), then reads the deployment every 30 s.
    - A `downgrade` abandons the run's draft PR, cancels its test deployments, writes `downgrade.md`, swaps the
      package's tags, sets its state, comments with `devops.mentions` and the escalation contact, cleans up again, and
      stops the run as needs-human with no later step.
    - Status reads stay read-only in the session: with deploy targets the `routine-devops` server adds
      `pr_build_status`, `test_environment_status`, `test_deploy_status` (GET calls and the run's own records only).
    - Not ported: `upload-image`, the per-step evidence lease of the old host. Two processes sharing one runs root
      share the coordinator's state file without a lock across processes.
19. **Secrets in the MCP configs, and the honest limit.** The `routine-browser` and `routine-devops` servers get their
    config (site passwords, the PAT) from a 0600 temp file named in an environment variable, never in `--mcp-config`
    arguments or JSON, the step folder or the prompt; each server deletes the file once read. This is not a security
    boundary: in auto mode the session runs as the same OS user and could read `routine.json` or the browser profile's
    cookies. "The agent never receives the password" means it is never given or shown to it, not that it cannot reach
    it.

## Consequences

- With `routineHost` wired, the legacy step engine is no longer reached: `advanceRun`'s role-chat path and binding
  (`worker.ts`, `worker-policy.ts`), the step-bound flow MCP tools (`output-tools.ts`, `devops-write-tool.ts`,
  `test-db-tool.ts`) and `devops-writer.ts` for new runs (it only serves the legacy migration). They are still
  imported by `wiring.ts` but no routine run reaches them: dead code, removed with the Routine UI task; unit tests
  still cover them through hosts created without `routineHost`.
- The app and the terminal produce identical run folders, so one reader serves both.
- `--permission-mode auto` trusts Claude Code's own classifier; the package's `allowedTools` narrow it when needed.
