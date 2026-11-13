Title: feat(agents): add lifecycle evaluation and approval queue UI

<!-- PR handoff for the integrator: describes the branch's implementation, validation and outstanding adapters. -->

Agent runs now expose an `onRunEnded` hook. New main-process modules provide a durable feedback log (200 entries per agent), repeated-definition-gap proposals, baseline/trial comparisons, and local daily suggestions. Decisions and suggestions remain pending proposals; no catalog changes are applied automatically.

The trial evaluator uses the parent's last ten pre-trial ended runs, excludes legacy versions, accepts only human/reviewed outcomes, and separates parent-compatible, other and unknown-routing work. It checks sample size, coverage, primary improvement, cost, elapsed time and question guardrails. Findings are compared only across the same reviewer version. The lifecycle coordinator persists evaluations, proposals and batched run-end wakes. The local suggestion pass costs $0 and runs at most once per local day after 18:00 while idle.

This is an integration handoff, **not completion of AD-36/37/39/41/42/43/44/48**.

Wired during integration (after #49):

- One `agent_feedback` shape: `AgentFeedbackArgs`, `AGENT_FEEDBACK_SCHEMA` and `parseAgentFeedbackArgs` in `src/shared/agent-lifecycle.ts`. #49's required args stay (`runId`, `verdict`, `notes`, `evidence`); `worked`, `failed`, `gap`, `gapKey` and `sendToRun` are optional. `notes` is the opinion text (the outcome note); there is no `reason` alias. Any other key (agentId, version, basis, outcome…) is refused.
- One record type (`AgentFeedback`, re-exported by `shared/agent-authoring.ts`) and one store: #49's `agent-authoring.json` feedback list. The branch's own `agent-feedback.json` store is gone (it never shipped). Records gain optional `version` and gap detail, and older records stay valid.
- The authenticated `agent_feedback` tool calls the lifecycle facade (`createLifecycleApi(...).feedback(args, callerId)`). The facade parses the shared shape and writes through `AgentAuthoring.recordFeedback`, which keeps #49's basis rules and the run outcome update. It then turns a gap named on two runs into a pending proposal. The lifecycle reads the same store via `FeedbackSource`.
- `AgentLifecycle` is instantiated in `wiring.ts` with the read API mounted, the 10 s heartbeat for the local daily pass (off under `SB_TEST`, cleared in shutdown) and the demo read API.

Still outstanding:

- The run-end Orchestrator wake (`onRunEnded` + `flushWake`): it would spend the user's tokens on every run end and needs the mailbox's engine and user-wait gates. `wake` stays `() => false` and `onRunEnded` is not passed to the manager.
- Trial evaluation: the classifier on main (#40) matches request text to agents but keeps no routing snapshot of the parent version per run, so `parentWins` cannot be supplied. `evaluate` is not called (unknown routing would turn every open trial into a "revert" proposal).
API and UI now implemented:

- `AgentCatalogPage` includes Da approvare, evidence references as plain text, per-agent feedback, and version comparisons with n/coverage and a separate excluded cohort. `Esamina proposta` opens the relevant editor or a new-agent editor, without applying changes.
- The new read API uses the existing typed `brain:api` IPC and sender checks. `/api/agents/lifecycle` is main-only and refuses fallback to a brain server. No new preload permission, `contract.ts` channel or `index.ts` handler is needed.
- Unit tests cover API identity/basis injection refusal, parameter validation, local-only fallback refusal, detached reads and escaped UI evidence. The UI read client is already the default in the catalog; no renderer route changes are required.

Exact integration points in reserved wiring (assigned to the Integration chat):

1. Import `AgentLifecycle` from `./agents/lifecycle` and instantiate it with `{ userData: ctx.userData, wake }` before constructing ChatManager. `wake(runIds)` sends one app-labelled request through the existing Orchestrator mailbox for run reports and feedback, returning false if no eligible recipient/root exists. Preserve mailbox engine and user-wait gates; do not directly launch an engine.
2. Pass `onRunEnded: run => lifecycle.onRunEnded(run)` in manager options. After constructing manager, call `const lifecycleApi = createLifecycleApi(lifecycle, id => manager.runs.get(id)); mountLifecycleApi(brain, lifecycleApi);` (both exports from `./agents/lifecycle-api`). Mount the same read API in demo wiring for the e2e fixture, with scheduling/wakes disabled there.
3. Manage a heartbeat (10 seconds is sufficient) calling `flushWake()` and `daily(idle, readInput)`. Idle must include pending requests, queued/running work and background children. Catch/log failures with cause/hint and clear the timer in shutdown. The local daily pass costs $0.
4. For readInput use `lifecycleInput([...agents.list().profiles, ...agents.list().archived], manager.runs.list(), manager.list(), (id, v) => agents.history(id).find(x => x.version === v))`, imported from `./agents/lifecycle-input`. Cohorts share role/engine/kind/area/skills, require confirmed outcomes and never infer missing cost.
5. Done: the authenticated `agent_feedback` tool → `lifecycleApi.feedback(args, callerId)` → `AgentAuthoring.recordFeedback` (one store). Arguments: the shared `AgentFeedbackArgs`.
6. At run end and daily, call `lifecycle.evaluate(agent, manager.runs.list(), parentWins)` for open trials. Classifier integration supplies `parentWins(run, parentVersion): boolean | null` from the parent's routing snapshot. Unknown routing stays excluded; do not use a constant-true callback in production.

Remaining source/UX gaps, explicitly not claimed complete:

- `BrainService.api` already offers `/api/day`, `/api/now`, `/api/cost`; `run-metrics.ts` parses ai-errors counts by run. A verified adapter from these sources to same-type/same-area error evidence is not supplied. Free-form notes are not silently treated as confirmed outcomes.
- `estimates.ts` JobRecord has kind/model/cost but lacks durable agent/version/area provenance. Durable runs and version snapshots are used instead. Pruned runs cannot be reconstructed for routing replay.
- Complete definition drafts, queue dismissal, approve/apply mutations, feedback strip footers and catalog-history decision writes remain outstanding. Evaluations persist in `agent-lifecycle.json`. The UI button explicitly opens the editor and never claims approval/application.

Validation (integration): `npx tsc --noEmit`, `npm run lint`, `npm run check:branch` and the guard on the branch commits. The new e2e spec `test/e2e/agent-lifecycle.spec.ts` first runs on main.
