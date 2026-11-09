# ADR 0247 · One standard delegation contract, in English

Date: 2026-11-09 · Status: accepted (owner, issue #355, decided 2026-11-08 and confirmed 2026-11-09) · Builds on:
ADR 0083 (delegation), ADR 0120 (prompts in English) · Extends ADR 0120 to contracts agents write to each other

## Context
Contracts between agents had no standard format: `agent_delegate` and `agent_assign_task` rendered only Goal / Context
/ Output / Done when, and the Orchestrator's `app_create_chat` / `app_assign_task` took a free prompt in mixed
languages. On 339 of the app's own runs a bare goal met all its criteria in about 49% of runs, the hybrid format
(goal + why + checkable criteria + constraints, steps only where order matters) in about 77% (observational, low
confidence, consistent with MAST 2025 and Cognition's "Don't Build Multi-Agents": the why and the decisions already
taken must travel with the task).

## Decision
- **Fields, one renderer.** A contract has `goal` and `doneWhen` (required) and the optional `why`, `alreadyDecided`,
  `context`, `inScope`, `outOfScope`, `constraints`, `steps` (at most 5, only when order matters), `output`, `askIf`
  (`shared/delegation.ts`). `contractText` is the single renderer, in that order, skipping empty fields:
  Goal, Why, Already decided, Context, In scope, Out of scope, Constraints, Steps, Done when, Output, Ask the parent if.
- **Every delegation path takes it.** `agent_delegate`, `agent_assign_task` and the Orchestrator's `app_create_chat` /
  `app_assign_task` (`contract` field, `appctl/task-contract.ts`) accept the same fields; the free `prompt` stays as the
  fallback of the two app tools, never together with a contract.
- **Warnings, not refusals.** A contract without `why`, or whose goal is more than 5 numbered steps, gets a warning in
  the tool's answer.
- **English between agents.** Contracts between agents are written in English; replies to the user stay in the user's
  language. The Orchestrator's contract line says so (`orchestrator-role.ts` RETIRED_LINES maps the old line).
- **Hard rules are not contract text.** Safety, production, push, secrets and permissions stay in the role frame
  (`ROLE_PREAMBLE`, `AGENT_LABEL`, role gate): a parent can neither omit nor weaken them.
- **Measured later.** Each run keeps which fields its contract had (`taskContract.fields`), so goal-only, hybrid and
  steps-only contracts can be counted; old runs without it still load.

## Consequences
- A child knows what the work is for and what not to reopen; the parent writes less free text.
- The effect of the format can be measured on the app's own runs.
