<!-- Decision record for the agents' improvement loop: what runs by itself, what only proposes, and what costs tokens. -->
# ADR 0073: The agents' improvement loop runs under the user's approval

Date: 2026-10-18 · Status: partly superseded by ADR 0077 (the approval parts for skills, agents and lessons); accepted

The owner (2026-10-18): "l'automiglioramento e correzione degli agenti in base al costo, tempo, come sono andati,
sempre sotto approvazione". No definition, version, trial or probation decision applies without an explicit user action.

## What runs by itself (no catalog write)

- Run start: a routing snapshot on the run (`AgentRun.routing`, `agents/routing-snapshot.ts`): the local classifier's
  score, rank and mode for the goal and, during a trial, whether the parent version would also have ranked first
  (`parentWins`). Local, no tokens. A failure records unknown (null), and unknown runs are excluded from the comparison.
- Run end / the user's verdict / stored feedback: the trial of that agent is evaluated (`trials.ts`). Inside the 21-day
  window missing evidence (no confirmed verdicts yet, too few comparable runs) waits; it used to propose a revert as soon
  as five runs had ended, before the user could rate them.
- Probation verdicts (AGENTS-DESIGN §4.7) become `probation:<id>` keep/retire proposals; the evaluator no longer keeps or
  retires by itself in the app (`ChatManager` `probation.propose`).
- The daily local pass ($0): suggestions plus one evaluation of every open trial.

## What only proposes

- The Orchestrator's `agent_update`, `agent_rollback`, `agent_archive`, `agent_restore` queue an `AgentProposal` (with
  `op`), like `agent_propose`. Accepting an update of an existing agent opens a trial against its active version
  (`AgentCatalogService.approveTrial`). `agent_create` is unchanged: it already needs a fresh message the user typed.
- Lifecycle entries are decided only through `agents:lifecycleDecide` (sender-checked IPC): trial keep/revert, probation
  keep/retire, model trials (a trial version on the cheaper model), and update/create/merge/split, whose approval asks
  the Orchestrator for a concrete draft that comes back for a second, final approval. Dismissed keys stay out 7 days
  (decisions) or 14 (suggestions).

## What costs tokens, and its limits

The feedback request to the Orchestrator on ended runs without the user's verdict: one batched message, at most 3 a
local day, 2 h apart, once 5 runs wait or the oldest waited 3 h; delivered only to an open, idle Orchestrator on an engine
the user left on, quiet for 5 minutes, with nothing waiting for the user, never resuming it (`liveOnly`). Off with the
setting `regiaEvents` and in the test suites. Runs already judged by the user, by a verified review or by a feedback leave
the queue without a wake. The same message asks for `agent_learn_propose` when a reusable rule emerges: this is how
learned-rule proposals (#47) are produced without a Battito job (pulse's scheduler is private and tool-less).

## Sub-agents

A run whose `parentRunId` is a run of another agent's chat (the Orchestrator started it with `app_create_chat
parentRunId` at that agent's request) is judged by that parent with `agent_child_feedback` on its own chat endpoint;
`agent_children` lists its run ids and its sub-agents' runs. The caller is the chat the endpoint token names: never its
own run, a sibling's or any other run. The record goes to the same store and chain as the Orchestrator's feedback.
Engine-native sub-agents (Claude's Task tool) are not catalog runs and stay observations only.
