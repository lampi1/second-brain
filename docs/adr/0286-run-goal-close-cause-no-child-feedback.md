# ADR 0286 · A run keeps its goal without the app's label and says why it was closed; `agent_child_feedback` is gone

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «comunicazione agentica
di livello impeccabile», and the report's proposals on agent communication, approved with «Approvo tutte le tue
modifiche del report») · Amends: ADR 0083 (the delegation tools), ADR 0247 (the task contract stays optional)

## Context

Measured on the owner's 683 runs of 13 days:

- 489 goals began with the app's label line («[Messaggio di un agente tramite second-brain…», «[Messaggio
  dell'utente scritto dall'Orchestrator…»). The label is for the model that reads the message; in the stored goal it
  took 100 to 270 of the 2000 characters and stood in front of what the recap, the estimates, the episodic examples
  and the maintenance read. Who wrote the request is already a field (`requestOrigin`, `startedBy`).
- 125 runs were closed before their work was marked completed, all with the one reason `closed`: nothing said whether
  the user closed the chat, a new task replaced the old one or the parent ended.
- `agent_child_feedback` was called 0 times for 103 delegated children; its schema went with every call of every
  role that may delegate.
- The report said that almost half of the jobs had no contract. Counted again by date: since the contract exists
  (ADR 0247, 2026-11-10) the Orchestrator used it in 301 of 345 jobs, and the 25 with a bare prompt reported «done» as
  often (60% against 59%). The old figure counted the runs from before the contract.

## Decision

1. `AgentRunStore.start` stores the goal without the app's label line (`shared/agent-label.ts goalText`: the four
   label wordings, first line only). Old runs keep theirs; `task-estimate.ts requestText` still reads past it.
2. A run closed before completion records `endCause` (`shared/agents.ts RUN_END_CAUSES`): `user` (he closed the
   chat), `agent` (its parent with `agent_close_child`, or the Orchestrator with `app_close_chat`), `auto` (the app
   archived it), `replaced` (a new task took its place), `parent` (it went with the chat or the run above it),
   `no-report` (its chat ended with no `agent_report`). `agent_children` (`delegation.ts children`) shows it to the
   parent. No page shows it yet: it is on the run for the diagnostics and for the parent.
   The task contract's goal of a reassigned task loses the label too (`manager-work.ts assignTask`).
3. `agent_child_feedback` is removed. The opinions already stored still count; a child is judged by what happens
   to its work (the parent's verified result, a rework, a review), as ADR 0125 and 0131 already do.
4. The task contract stays preferred, not mandatory: the data gives no reason to refuse a bare prompt.

## Consequences

- A stored goal starts with the request. The label is still the first line of the message the agent receives.
- Not done, by choice: one `<agent-message>` envelope for every engine (ADR 0261 is Claude only) and English for the
  app's own notes to agents. Neither has a measured problem behind it; both touch what every engine reads back from
  its transcript.
- Tests: `test/unit/agent-runs.test.ts`, `test/unit/chats/agent-runs-manager.test.ts`, `test/unit/agents/delegation.test.ts`, `test/unit/agents/close-child.test.ts`,
  `test/unit/chats/role-primed.test.ts`.
