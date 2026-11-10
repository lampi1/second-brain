# ADR 0266 · The app writes the journal's «fatto» line of every result

Date: 2026-11-10 · Status: accepted (owner, issue #375: «the app should write a 'fatto' line on agent_report
done/partial, and roles need a journal command») · Builds on: ADR 0062 (the app's rendered tools), ADR 0083
(agent_report)

## Context
- The brain journal (`journal/`) had 10-26 lines a day until mid-October and 0-2 since 2026-10-14, against 50-100
  role results a day (106 on 2026-11-09, one journal line): the duty and the command moved to an on-demand file the
  roles never read, and `memoryInstructions` named no `journal` command.

## Decision
- **The app writes it, not the model**: a role's first `agent_report` done or partial of an assignment (a delegated
  chat's or a root role chat's, the same path for every engine) appends one line through the brain's own
  `ops/tools/mem.mjs journal` (the app's rendered copy for a product brain), so format and file are a manual call's:
  `fatto · <role> · <chat>: <summary>`, `fatto (in parte)` for partial, at most ~400 characters, credentials masked
  (`brain/journal-line.ts`). Blocked writes nothing; a correction of the same result writes no second line (a
  blocked result corrected to done writes it then; done → blocked → done is still one line), a mark saved with the
  result (`journaled`) so a restart in between changes nothing; a refused report and an app review run (Sentinel, Judge) write nothing.
- **Never in the way**: the line is written after the report is saved; a missing tool or a refusal is a warning in
  the Log page, the report stands.
- **Roles add what only they saw**: `memoryInstructions` carry
  `mem.mjs journal --text "attrito|decisione|lezione · …"`, noting that the app already writes «fatto».

## Consequences
- One line per result: on a busy day ~50-100 lines; the journal is read by day, not loaded in chats.
- Results of the Orchestrator itself and of plain chats (no report contract) are not journaled.
