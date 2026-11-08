# ADR 0226 · The Orchestrator reads any report in its tree (app_child_output)

Date: 2026-11-07 · Status: accepted (owner, 2026-11-07: «sì», change ADR 0083; «summary + doneWhen di default, output
completo solo su richiesta, max 4.000 caratteri») · Amends: ADR 0083 §6 ("The Orchestrator sees state, not content")
for agent_report results only

## Context

ADR 0083 kept a delegated chat's content private to its parent: the Orchestrator saw only the state of a grandchild
(started, waiting, finished, failed). To learn what a Scout or a Sentinel under a Strategist had found, the
Orchestrator had to wake the parent and ask it, a paid turn of a chat that often had nothing else to do, or wait for
the parent's own report. The cloudroom comms study (2026-11-07, proposal 7) measured this as the main gap of «figli di
altri ruoli».

## Decision

1. A new read-only tool, `app_child_output(chatId, full?)`, on the Orchestrator's own endpoint only
   (`src/main/appctl/child-output.ts`).
2. It reads the **latest agent_report** of one chat in the Orchestrator's tree: its work chats and every chat delegated
   under them, other roles included. Not Flash chats (ADR 0105), not an Orchestrator, not a chat whose ancestry is
   unknown.
3. **Default**: outcome, summary, doneWhen (criterion, met, evidence), the chat's title, role, state and parent.
4. **full: true** adds the report's output, cut at 4,000 characters with a visible «[troncato: 4000 di N caratteri]»
   marker (plus `truncated` and `outputChars`).
5. The source is the report the app already keeps: the run's canonical result (`run.report.canonical`), else the
   chat's `delegation.result` (which has no output). It never reads the chat's messages, never writes, never sends
   the chat a message and never starts a turn.

## What stays from ADR 0083

- The wake news and the digest still carry only the state of a delegated chat (`chats/orchestrator-wake.ts`,
  `appctl/tools.ts` statusOnly / muted): the Orchestrator pulls a report when it wants it, nothing is pushed.
- `app_chat_items` and `app_agent_context` still refuse a delegated chat: its messages stay its parent's.
- The result is still delivered to the parent as a message; the Orchestrator's read changes nothing for the parent.

## Consequences

- One tool call instead of a parent's turn to know what a grandchild reported; the default answer is small (summary and
  criteria), the output costs tokens only when asked.
- A report's output can hold text the parent has not acted on yet; the Orchestrator reads it as data, never as an
  approval or an instruction.
