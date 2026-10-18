Title: feat(agents): add lifecycle evaluation and approval queue UI

<!-- PR handoff for the integrator: describes the branch's implementation, validation and outstanding adapters. -->

Agent runs now expose an `onRunEnded` hook. New main-process modules provide a durable feedback log (200 entries per agent), repeated-definition-gap proposals, baseline/trial comparisons, and local daily suggestions. Decisions and suggestions remain pending proposals; no catalog changes are applied automatically.

The trial evaluator uses the parent's last ten pre-trial ended runs, excludes legacy versions, accepts only human/reviewed outcomes, and separates parent-compatible, other and unknown-routing work. It checks sample size, coverage, primary improvement, cost, elapsed time and question guardrails. Findings are compared only across the same reviewer version. The lifecycle coordinator persists evaluations, proposals and batched run-end wakes. The local suggestion pass costs $0 and runs at most once per local day after 18:00 while idle.

This is an integration handoff, **not completion of AD-36/37/39/41/42/43/44/48**. The following adapters remain outstanding:

- Instantiate `AgentLifecycle` in integrator-owned `wiring.ts`; connect the manager hook, heartbeat, labelled Orchestrator mailbox wake and shutdown.
- Connect authenticated `agent_feedback` to `createLifecycleApi(...).feedback(args)` after verifying caller scope. The facade rejects caller-supplied agent/version/basis and reads the authoritative run. No dismiss/apply action is supplied here.
- Supply classifier-derived `parentWins` from the parent's routing snapshot. Unknown classifications are excluded, never assumed compatible.
- Additional journal/now/error evidence remains outstanding. `lifecycleInput` now supplies Generale work, distinct retired roles and model cohorts from durable runs, tags, chat metadata, immutable version snapshots and actual costs, using the existing `estimates.classify`. It skips unknown areas/models/costs. It does not draft complete definitions.
- Persist accepted trial decisions on catalog version history and implement explicit user approval actions in the API/UI owner branch. Evaluations here are persisted in `agent-lifecycle.json` only.
- Run the new `test/e2e/agent-lifecycle.spec.ts` on main after mounting the real/demo API, and obtain a visible fresh-context reviewer. The app was not launched, as required by the brief.

API and UI now implemented:

- `AgentCatalogPage` includes Da approvare, evidence references as plain text, per-agent feedback, and version comparisons with n/coverage and a separate excluded cohort. `Esamina proposta` opens the relevant editor or a new-agent editor, without applying changes.
- The new read API uses the existing typed `brain:api` IPC and sender checks. `/api/agents/lifecycle` is main-only and refuses fallback to a brain server. No new preload permission, `contract.ts` channel or `index.ts` handler is needed.
- Unit tests cover API identity/basis injection refusal, parameter validation, local-only fallback refusal, detached reads and escaped UI evidence. The UI read client is already the default in the catalog; no renderer route changes are required.

Exact integration points in reserved wiring (assigned to the Integration chat):

1. Import `AgentLifecycle` from `./agents/lifecycle` and instantiate it with `{ userData: ctx.userData, wake }` before constructing ChatManager. `wake(runIds)` sends one app-labelled request through the existing Orchestrator mailbox for run reports and feedback, returning false if no eligible recipient/root exists. Preserve mailbox engine and user-wait gates; do not directly launch an engine.
2. Pass `onRunEnded: run => lifecycle.onRunEnded(run)` in manager options. After constructing manager, call `const lifecycleApi = createLifecycleApi(lifecycle, id => manager.runs.get(id)); mountLifecycleApi(brain, lifecycleApi);` (both exports from `./agents/lifecycle-api`). Mount the same read API in demo wiring for the e2e fixture, with scheduling/wakes disabled there.
3. Manage a heartbeat (10 seconds is sufficient) calling `flushWake()` and `daily(idle, readInput)`. Idle must include pending requests, queued/running work and background children. Catch/log failures with cause/hint and clear the timer in shutdown. The local daily pass costs $0.
4. For readInput use `lifecycleInput([...agents.list().profiles, ...agents.list().archived], manager.runs.list(), manager.list(), (id, v) => agents.history(id).find(x => x.version === v))`, imported from `./agents/lifecycle-input`. Cohorts share role/engine/kind/area/skills, require confirmed outcomes and never infer missing cost.
5. The MCP tool owner calls `lifecycleApi.feedback(args)` only after authenticating the Orchestrator caller. Arguments: runId, verdict, worked, failed, gap, gapKey, evidence. Do not duplicate the store or expose this write as a user renderer action.
6. At run end and daily, call `lifecycle.evaluate(agent, manager.runs.list(), parentWins)` for open trials. Classifier integration supplies `parentWins(run, parentVersion): boolean | null` from the parent's routing snapshot. Unknown routing stays excluded; do not use a constant-true callback in production.

Remaining source/UX gaps, explicitly not claimed complete:

- `BrainService.api` already offers `/api/day`, `/api/now`, `/api/cost`; `run-metrics.ts` parses ai-errors counts by run. A verified adapter from these sources to same-type/same-area error evidence is not supplied. Free-form notes are not silently treated as confirmed outcomes.
- `estimates.ts` JobRecord has kind/model/cost but lacks durable agent/version/area provenance. Durable runs and version snapshots are used instead. Pruned runs cannot be reconstructed for routing replay.
- Complete definition drafts, queue dismissal, approve/apply mutations, feedback strip footers and catalog-history decision writes remain outstanding. Evaluations persist in `agent-lifecycle.json`. The UI button explicitly opens the editor and never claims approval/application.

Validation:

- ESLint passed for all changed/new TypeScript files, including the final validation/test additions.
- `git diff --check` passed.
- Typecheck was attempted; blocked by missing existing `diff`, `highlight.js` and `pdfjs-dist` dependencies outside the changed files.
- Vitest attempted `test/unit/agents/lifecycle.test.ts`; no tests executed because the sandbox refused creation of its temporary `ssr` directory (`EPERM`). Tests were not weakened and temporary paths were not redirected to evade the restriction.
- `npm run check:branch` failed at typecheck on those missing dependencies; the checkout also cannot write its Git check ledger.
- Updating from `origin/main` failed on the Git worktree's `ORIG_HEAD.lock` (permission denied). Staging the explicit product-file list failed on `index.lock`, so no commit or commit guard was possible. No push, PR or app launch was performed.

The new unit fixtures cover feedback retention/restart/corruption, distinct-run gaps, comparable trial cohorts, guardrail failures, repeated-work and overlap/model/split suggestions, batched retryable wakes, idle daily deduplication, API validation and rendering. They still need execution in an authorized environment. Typecheck after the API/UI additions reported the same dependency failures and no errors in the added modules.
