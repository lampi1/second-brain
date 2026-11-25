# ADR 0356 · Every chat has its role's app tools on every engine, from the first turn to the last

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25) ·
Amends: ADR 0332 and 0351 (the compact list of a tight-budget engine), ADR 0346 and 0352 (what an engine move carries),
ADR 0256 (the registry is never an allow-list, now also at launch), ADR 0355 (the three writes wait in every chat) ·
Keeps: ADR 0254, ADR 0290

## Context

The owner's goal: «ogni chat, su ogni harness (Claude, Codex, OpenCode, Cursor, Antigravity e gli altri ACP), ha tutti
gli strumenti dell'app previsti dal suo ruolo, dal primo all'ultimo turno, e anche dopo un cambio di motore o una
ripresa». Four failures were seen on 2026-11-25 (release fc55c02d), each traced in its log:

1. **Antigravity dropped agent_report.** agy keeps a schema budget of its own and drops the largest tools first. The
   app served 47 tools (34 069 bytes) to a child in the brain folder. agy's own database names the two it dropped:
   project_map_save (5 624 bytes) and agent_report (2 182 bytes), the two largest. The child then pasted its report as
   JSON in its answer and was closed «senza agent_report».
2. **A Strategist moved from OpenCode to Cursor lost its plan.** `doContinue` created the new chat as the user's, so it
   had no plan, and so no plan_propose (the filter shows the plan tools only with a plan). The plan's approval stayed
   keyed to the old, closed chat. The auto-close keeps a chat only while its plan is `proposed`, so it closed the new
   one, and the stall driver flagged «lavoro approvato fermo».
3. **claude-opus-5-5 on Cursor was saved, then refused.** The role card's save checks the engine's live list (Cursor
   lists it). The route checked the registry row's harness (`claude`) and a «looks Claude» name rule. The app's own
   engine move, which does not route, ran it on Cursor fine.
4. **A reuse failed after an engine change.** agent_assign_task and app_assign_task looked up the old chat, which went
   on in another one.

## Decision

- **One table, role → required tools** (`src/shared/role-tools.ts`): every role has `show_ui`; the Orchestrator also
  has `relay_question`; a Strategist has `agent_delegate`, `agent_assign_task` and `agent_children`, and `plan_propose`
  and `plan_update` with a plan; every child has `agent_report` and `agent_ask_parent`; an app job that must report has
  `agent_report`; an engine with no question tool of its own (every ACP engine) has `ask_user`. A role that launches
  nobody needs no delegation tools; the maintenance research needs none. Every place that decides what a chat sees
  reads it. The chat filter never hides a required tool (`toolShownToChat`). The compact list keeps them (`fitCompact`).
  The check below compares against it. Pinned by `test/unit/chats/role-tools-matrix.test.ts`: every engine of the
  registry × every role × root, child and plan. It holds the table literally, so it is red if a tool is removed.
- **The compact list of a tight-budget engine** (Antigravity, `mcpCompact`): first the four largest optional tools are
  left out (`project_map_save`, `project_map_update`, `brain_script_add`, `brain_query_add`). Then the largest optional
  tools go until the list fits `COMPACT_BUDGET` (24 000 bytes, well under the 33.6 KB agy dropped from). Required tools
  are never removed and keep 40-character property descriptions (ADR 0351). Left-out tools stay callable on the
  endpoint (`callTools`), through the fallback command and through run_code. The required tools are among the largest
  by nature (their schemas are their contracts), so staying under agy's budget is what protects them. agy's own budget
  is not documented: 24 000 is a guess under the one measured failure, to be confirmed on a real PC.
- **A check at every start, resume and engine change** (`chats/tool-check.ts`, ChatManager `toolCheck`). What the
  engine was really given is either the list the endpoint served in this session, or what the engine says it loaded
  (Claude's init `tools`). If the served list lacks a required tool, that is an app fault no reload fixes: the
  fallback. If the engine loaded fewer, one reload of the session (same session, new process), then the fallback. If a
  turn ended and the engine never read the endpoint, the same. That last case counts only on an engine known to be
  handed the endpoint (Claude, Codex, an ACP engine with `mcpHttp`); an API engine has no tools and no shell. Each step
  is a warn log line and a line in the chat. The problem is never left to the agent.
- **One fallback channel for every engine** (`chats/tool-cli.ts`): `sb-tool <tool> '<json>'` (`--file`, `-` for stdin,
  `list`). The app writes it at start into `<userData>/bin`, run by the app's executable as Node. Every chat's engine
  starts with that folder first on its own PATH (the app's, kept whole) and the chat's own endpoint URL in
  `SB_CHAT_TOOLS`. On Windows the hint says to pass the arguments with `--file` or stdin (cmd.exe changes quotes). It calls the same tool on
  the same per-chat endpoint, so the same filter and guards run. The fallback message and the report reminder name it.
- **A report pasted as JSON** (`chats/text-report.ts`): when a child owes its report, the app reads its last answer. It
  takes a ```json block, the whole text or the last balanced object, with an `outcome` of done, partial or blocked and a
  `summary`, also wrapped as `{agent_report}` or as a tool call. It calls the real agent_report with it (`callChatTool`).
  A refusal by the tool's checks (a criterion missing) falls back to the reminder and then the close without a report.
- **An engine change carries the work** (`doContinue` → `carryOver`). These pass to the new chat:
  - the role, its tools and the roles it may launch;
  - the root task's goal and criteria, who started the run, its work state and its work map;
  - the plan with its phase. A proposed plan's request is cancelled on the old chat and registered on the new one in
    the same job (`movePlan`), so «Approva» answers the chat that works. A plan whose children still work stays on the
    old chat, which they report to and whose plan their reports move (they are not re-parented);
  - an app job's contract: its owed report, how its result is delivered, its fields and the review it writes;
  - the user's recorded instructions, the app's open questions to the user, and work threads (`followChat`).
  What an agent, the app or a command result still sends to the old chat reaches the new one (`send`). A reuse by the
  old chatId lands on the chat that works now (`successorIn`). The stall driver does not count a thread whose linked
  chat has a plan waiting for the user.
- **One rule for a model on an engine** (`src/shared/model-fit.ts`, used by `brain/routing.ts`). A model on the engine's
  live list runs there, whatever the registry says (aliases count). Off the list, it is still taken unless the
  registry's row or its Claude name says it belongs to another engine. The card's save already checks the live list,
  so a preset the card saves is one the route accepts.
- **The same permissions on every engine.** The three writes of ADR 0355 (database writes, production releases, cloud
  writes, Azure included) wait for the user in every chat, delegated or not, on every engine; only the maintenance
  research, which runs no commands, is left out. Everything else passes as before (the brain's rules decide first).
  As in ADR 0355, the hold applies where an engine asks the app's gate: a chat the user put in bypassPermissions, or an
  engine's own allow rule, is not held.

## Consequences

- A chat can no longer lose its role's tools without the app logging it and acting on it.
- An ACP chat on a slow machine may be reloaded once when its first turn ends before its engine read the endpoint.
- A user's own chat now also gets a panel for a database write, a production release or a cloud write, which before
  only the brain's rules could hold.
- Known gaps: Claude's init `tools` is trusted as what it loaded; if it ever lists only part of the app's tools (deferred
  ones), every Claude chat would be reloaded once: to confirm on a real PC. agy drops tools inside its own process, so the app cannot see that drop; it relies on the budget, the
  fallback command and the JSON report. Real-PC checks on every installed engine are still to do: after start, after
  resume, after an engine change, and in a session over 250k tokens.
