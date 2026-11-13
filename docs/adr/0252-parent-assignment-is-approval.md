# ADR 0252 · A parent's assignment is approval inside its scope

Date: 2026-11-09 · Status: accepted (owner, issue #349, «risolvi tutte le issue aperte») · Builds on: ADR 0083 (roles and
delegation), the owner's autonomy goal of 2026-11-09 (his click only for DB writes, production releases, cloud writes)

## Context
Six delegated runs in one day ended blocked with no change: code and docs in a local repo, nothing touching a database,
production or the cloud. They stopped because the decision they looked for was «only in history»
(`currentAuthorization: false`), was not linked to the current assignment version, or because `agent_work_decisions`
failed with «An active work assignment is required.»

## Decision
- **The role frame** (`shared/roles.ts ROLE_PREAMBLE`): an explicit assignment from the parent (its contract) lets a role
  do the work inside its stated scope without asking again; it never stands for a user decision it claims. A role stops
  for the user only for irreversible or external actions, production, databases, the cloud or shared systems (never its
  own to run: it gives the exact command) and a change of goal. The rules «never write to production or shared systems»
  and «a recorded decision does not expand permissions» stay word for word.
- **Same task, later version** (`agents/work-decisions.ts`): an approval on a thread stays current for a continuation or
  rework of the run the user decided on (the run's `taskId` names the task's first run, read from the runs ledger), and the
  worker is told it holds only while the goal is unchanged. A new task in a reused chat still starts without it, and so
  does a task whose first run is unknown or was pruned from the ledger (it fails safe).
- **No assignment, no error**: a chat without a run gets an empty answer with a note, not «An active work assignment is
  required.» A missing or Orchestrator chat still gets the error.
- Nothing grants tools or permissions: the execution and production gates stay as they are.

## Consequences
- The issue's «after one week» check (no run blocked with «approval only in history») can only be read from real runs.
