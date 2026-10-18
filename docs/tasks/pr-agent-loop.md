Title: feat(agents): the improvement loop runs end to end, always under the user's approval

<!-- PR description for the agent improvement loop branch (feat/agent-loop); used by the integrating Orchestrator. -->

## What

The agents' improvement loop now runs from run start to the user's decision (ADR 0072):

- **Run start**: `AgentRun.routing`, a routing snapshot taken by the local classifier (#40) just after start: score, rank,
  mode and, during a trial, whether the parent (baseline) version would also have ranked first (`parentWins`).
  `AgentRunStore.setRouting` validates it; `readRouting` keeps the store strict. `parentWins(run, parent)` is the trial
  evaluator's callback; unknown stays null and excluded.
- **Run end**: `ChatManager` `onRunEnded` is wired (and new `onRunStarted`, `onRunOutcome` for a verdict on an ended run).
  Runs without the user's verdict wait for the Orchestrator's opinion; the trial of that agent is evaluated at every run
  end, verdict, stored feedback and in the daily pass.
- **Feedback wake** (`agents/feedback-wake.ts`, `lifecycle.ts` `WAKE_POLICY`): one batched message, at most 3 a day, 2 h
  apart, once 5 runs wait or the oldest waited 3 h; only to an open, idle Orchestrator on an enabled engine, quiet for
  5 min, with nothing waiting for the user, never resuming it (`liveOnly`); off with `regiaEvents` and in test suites.
  Runs the user (or a verified review, or a feedback) already judged leave the queue without a wake. The message also
  asks for `agent_learn_propose`: learned-rule proposals (#47) are produced there, with no Battito job.
- **Always under approval**: `agent_update` / `agent_rollback` / `agent_archive` / `agent_restore` now queue an
  `AgentProposal` (`op`, `toVersion`) instead of writing; accepting an update opens a trial (`approveTrial`). Probation
  verdicts become `probation:<id>` proposals. A new sender-checked IPC `agents:lifecycleDecide` approves or dismisses a
  "Da approvare" entry (trial keep/rollback, probation keep/retire, model trial, drafting request to the Orchestrator);
  `agents:lifecycleChanged` tells the page to read again. `/api/agents/lifecycle` now also returns `learned` and `drafts`.
- **Sub-agents**: `agent_children` and `agent_child_feedback` on every chat's own endpoint: a parent agent lists and judges
  only the runs whose `parentRunId` is one of its own runs; same store, metrics and proposals as the Orchestrator's.
- **Bug fixed (red first)**: a trial proposed a revert as soon as five runs had ended, before the user could rate them
  (coverage < 60 %, too few comparable runs). Inside the 21-day window missing evidence now waits.
- `agents/loop.ts` assembles all of it once for `wiring.ts` and the tests; the demo wiring decides on its demo catalog.

## Why

The owner (2026-10-18): the agents' self-improvement and correction by cost, time and outcome is the core of the app,
"sempre sotto approvazione". Before: `wake: () => false`, `onRunEnded` not passed, trial evaluation never called,
learned rules never produced, and the Orchestrator's update/rollback/archive and the probation evaluator applied by
themselves.

## Checks

See the hand-off report (tsc, lint, unit suite, `npm run check:branch`). New tests: `test/unit/agents/agent-loop.test.ts`
(the whole chain with fakes around the real stores, gates, caps, dismissals, sub-agent authentication), plus updates in
`agent-authoring.test.ts`, `agents/lifecycle.test.ts`, `chats/agent-probation-manager.test.ts`.

## e2e specs

None changed. The renderer is untouched except one i18n key (`lifecycle.kind.retire`).
