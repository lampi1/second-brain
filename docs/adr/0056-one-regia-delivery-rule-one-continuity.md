# ADR 0056 · One rule for what reaches a Regia, one "continuity" concept

Date: 2026-10-15 · Status: accepted · Amends: ADR 0031 (cold continuation: rules moved), ADR 0051 (Regie corte: rule
moved) · Source: audit 2026-10-15 #6 (the audit note, kept outside the repo since ADR 0061)

## Context
Two systems held things back from an idle Regia, each with its own constants and its own idea of "free":
- the app's news (`regia-wake.ts`): 20 s grouping, one chat at most every 2 min, nothing while the Regia worked or
  waited for the user, questions/permissions/commands never waking it alone (the owner, 13/10);
- the mail between chats (`mail.ts`): 60 s grouping, "urgente/subito/asap" at once, pure progress held up to 30 min,
  decided by three hard-coded regexes (~40 words); delivered into a running turn, and also to a Regia waiting for the
  user's answer.
The same "ha finito" could cost two turns (news at 20 s, mail at 60 s), and a newcomer had to learn two rules.
Hand-off, cold continuation and the daily `/compact` lived in three files with their own "quiet chat" checks.

## Decision
- **One rule** (`chats/regia-delivery.ts`), used by both sources. Classes: `now` (urgent mail, a work chat stopped
  on an error), `group` (a turn ended, a request: within `REGIA_GROUP_MS` = 30 s, all in one message), `quiet` (what
  waits for the user, progress: rides along; progress mail at the latest after `REGIA_HOLD_MS` = 30 min, quiet news
  never alone). The gate is the Regia's state: working → everything goes into its running turn (no new turn); waiting
  for the user, in a hand-off or failed → only `now`; idle or closed → by class; working on an engine without mid-turn
  input (Cursor, ACP) → nothing until the turn ends. The owner chose 30 s, errors at once and the classifier below
  (15/10).
- **Mail classes from the sender, then the brain.** `send_to_chat` takes an optional `kind` (`urgent`, `request`,
  `info`), stored in the message. Without it, the lists `regiaMail.urgent/progress/action` of
  `<brain>/brain-settings.json` decide (defaults in code until the brain template ships them). Entries are literals
  (whole word, or `stem*`), escaped before matching: an agent writing the brain never runs a pattern of its own.
- **One continuity concept** (`chats/continuity.ts`): compact (same session: every Claude chat at its window, a Regia
  on a new day), fresh session (cold note while the cache is warm, ADR 0031), new chat ("Riprendi"). One `quietChat`
  check for every automatic step; `continuityStep` tells the minute sweep which is due. The note itself stays in
  `handoff.ts`. Thresholds, times and prompts are unchanged.

## Consequences
- Behaviour the user sees: news of a finished chat 10 s later (20 → 30 s), a request by mail 30 s sooner (60 → 30 s),
  a failed chat at once (was 20 s); news while the Regia works joins its turn instead of waiting; mail no longer
  reaches a Regia that waits for the user's answer, unless urgent.
- The three continuity prompts (hand-off request, cold continuation, day compaction) keep their own texts: they feed
  formats the code parses (`## Stato` … `## Prossimo passo`) or Claude's `/compact`; merging them would change what
  the agents write.
- Not done here (audit #6, third point): a registry of the app's timers visible in `app_state`/`doctor`.
