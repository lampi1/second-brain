# ADR 0252 · A parent's assignment is approval inside its scope

Date: 2026-11-09 · Status: accepted (owner, issue #349, «risolvi tutte le issue aperte») · Builds on: ADR 0083 (roles and
delegation), the owner's autonomy goal of 2026-11-09 (his click only for DB writes, production releases, cloud writes)

## Context
Six delegated runs in one day ended blocked with no change: code and docs in a local repo, nothing touching a database,
production or the cloud. They stopped because the decision they looked for was «only in history»
(`currentAuthorization: false`), was not linked to the current assignment version, or because `agent_work_decisions`
failed with «An active work assignment is required.»

## Decision
- **The role frame** (`shared/roles.ts ROLE_PREAMBLE`): an explicit assignment from the parent (its contract) is approval
  for the work inside its stated scope. A current user decision is needed only for what the user keeps for their own
  click (production, database or cloud writes, irreversible or external actions) and for a change of goal.
- **Same task, later version** (`agents/work-decisions.ts`): an approval on a thread stays current for a continuation or
  rework of the run the user decided on (the run's `taskId` names the task's first run, read from the runs ledger). A new
  task in a reused chat still starts without it, and so does a task whose first run is unknown.
- **No assignment, no error**: a chat without a run gets an empty answer with a note, not «An active work assignment is
  required.» A missing or Orchestrator chat still gets the error.
- Nothing grants tools or permissions: the execution and production gates stay as they are.

## Consequences
- The issue's «after one week» check (no run blocked with «approval only in history») can only be read from real runs.
