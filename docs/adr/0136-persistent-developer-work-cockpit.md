# 0136 — Persistent developer work cockpit

Status: partly superseded by ADR 0141 (the Home board); accepted for this implementation, 2026-10-23.

## Problem and decision

The owner loses work across many short-lived chats and wants to decide on proposals, not coordinate execution. AI-DLC supplies useful ideas (persistent workflow state, task-sized routes, explicit gates and review repair loops); we do not install its engine or reproduce its stage-by-stage ceremony.

The Grindhouse now starts with Regia. A work thread has a stable ID independent of its chats, a profile (feature, bugfix, investigation), urgency, ordered stages, linked root chats across repositories, a next action, waiting party, evidence and a bounded event history. Chat strips remain available below. The Orchestrator creates and maintains threads through authenticated MCP tools; the board reads them without model calls. Only the explicit Fai il punto action requests an Orchestrator turn. If busy it queues normally; if waiting it also exposes the existing unanswered questions.

A renderer-only versioned decision consumes one exact proposal ID. Rejecting blocks further completion until an alternative is accepted. Normal status updates preserve approval; a new proposal invalidates it. Existing linked Strategist plan approvals are reused instead of asking twice. Mockup, plan and deployment stages require an approved proposal. A thread receipt records user intent, not execution permissions: production access remains governed by existing tool/engine gates; this feature adds no production executor, DB connector, merge or deployment command.

Review/test/QA failure returns to development in the same thread. Three failed cycles require a new human-approved approach, resetting that retry budget. Each completion requires fresh evidence. Review completion through MCP additionally requires a linked Sentinel's verified report newer than implementation completion. Successful linked root reports wake the Orchestrator through the existing persisted delivery outbox, enabling it to route review/rework without waiting for another user prompt. This remains an agent-driven orchestration loop, not an independent deployment engine.

CPU admission reads linked workflow urgency dynamically, including ancestors: production then support then normal, preserving existing app-work/FIFO ordering within a priority. It never kills or interrupts a running command. The board flags known failed agents, urgent DevOps bugs and auto-complete PRs with open discussions/negative checks. It shows the DevOps snapshot date; it does not claim to detect uncommitted local fixes or associate them with a PR.

All learned-rule proposals, including Orchestrator proposals and legacy unapplied lessons, wait for the user's decision in Regia. Agent lesson-review tools are now read-only. Only approved lessons reach the existing corrections job; manual user edits remain unchanged.

## Boundaries and follow-up

The new thread covers tracking and orchestration; existing tools still perform actual work. External QA comments, spoken requests and Git working-tree changes do not automatically become threads. The UI's phase evidence is reported evidence, not an independent proof that a deployment happened. This increment does not relax production safeguards, rewrite cross-repository filesystem permissions or bypass the Strategist's existing execution checks. A generic thread proposal and a distinct tool permission remain distinct decisions.

Storage is atomic in userData/work-threads.json; corruption is refused without overwriting the file. Each thread keeps at most 200 events and 40 chat links; no sensitive content should be put in titles or summaries. No new dependencies.

## Verification

Unit coverage includes persistence, stale/repeated decisions, rejection, failed review recovery, fresh evidence, queue urgency, linked-result waking, lesson approval and renderer output. E2E screenshot coverage is authored but deliberately not run per owner instruction. Manual Electron visual validation may require a desktop environment; report any launch restriction explicitly.
