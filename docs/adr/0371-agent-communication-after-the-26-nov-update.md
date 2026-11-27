# ADR 0371 · Agent communication after the 26 Nov update: his words count, tools right the first time, short messages, told when done

Date: 2026-11-27 · Status: accepted (issue #492, from the owner's transcripts and logs of 20–27 Nov; owner rule: what
the Orchestrator says on his behalf counts as his, except production, database and cloud writes) · Amends: ADR 0191
(night mode), ADR 0275, ADR 0290 (the rules' time budget), ADR 0294 · Builds on: ADR 0135, ADR 0259, ADR 0365

## Context

Measured on the ~20 hours after the 26 Nov update (#492):

1. `app_config` refused his own «resettami le card di conseguenza…» 8 times: his item landed more than 5 s after his
   Enter (the engine was starting), and agent mail or app news after it voided the ask.
2. Agents learned the app tools by failing: 29 «input schema was not in your prompt» (ToolSearch had deferred
   `agent_report`, `plan_propose`, `agent_delegate`), `agent_report` refused 14 times out of 73 (19%), `app_create_chat`
   with invalid JSON 5 times, `plan_propose` 5, `AskUserQuestion` 3. The refusal causes in the validation code for a
   report that meant the right thing: a criterion copied with another space, list dash, quote, case or final stop (refused
   as «missing»), an evidence over 1000 characters, a question over 500. A question refusal listed every rule at once,
   never the one broken. A JSON text written by hand failed on a raw line break or a trailing comma.
3. An `agent_report` right after `plan_propose` closed the plan before he could approve it.
4. Nobody told him when the thing he waited for was done: a clean result is quiet news, so he kept asking «come
   procede?».
5. The app estimate appended to his messages: another branch (ADR 0367), not here.
6. 32 compactions in 20 hours, one chat 6 times. The fresh session of ADR 0356 comes due at 80% of the model's window,
   and the app's compact window sits below that: it never came due.
7. `agent_report` averaged about 3.7k characters, `agent_delegate` about 7.8k.
8. 5 «app restarted while you were working» and 3 «switch failed»: «Aggiorna» restarted over running turns.
9. 5 Bash calls refused in the evening with «the user is away (Modalità notte)», though his rules let everything through
   but what they hold (ADR 0294).

## Decision

1. **His own message is the ask** (`appctl/user-words.ts`). The Orchestrator's items are told apart: his own (typed or
   phone text with no `from`, not the app's or an agent's `[…]` text) and the rest. His typed proof matches his own last
   item up to `TYPED_DELIVERY_MS` (2 min) after Enter, and within the fresh window (10 min) mail or app news after it do
   not void it. Beyond 10 min the old strict rule applies. A later message of his is a new ask.
2. **Tools right the first time.**
   - The app's MCP mounts are `alwaysLoad` (`mcp/server.ts`): every tool in `tools/list` carries
     `_meta["anthropic/alwaysLoad"]`, for every engine that reads it. Claude's `--mcp-config` also marks the app's
     servers `alwaysLoad: true` (`manager-sessions.ts`). ToolSearch never defers them.
   - Descriptions start with the required fields and their limits: `agent_report`, `agent_delegate`, `plan_propose`,
     `app_create_chat`. The role preamble says the schema is in the prompt.
   - `checkResult` maps a criterion that differs from the contract's only in spaces, a list dash, quotes, case or a
     final stop to the contract's words. It cuts an over-long evidence (1000) or question (500) with the marker instead
     of refusing. An unknown field's error lists the fields it takes.
   - A nested JSON text is repaired once (raw line breaks inside strings, a trailing comma) before it is refused
     (`mcp/json-args.ts repairJson`). One that still does not parse is named (its argument and the parser's reason)
     with how to write it.
   - A refused question says first which rule it broke (`yes-no.ts notYesNoWhy`): how many questions, its options, a
     command run, vague, a code block, its length. The whole rule follows, as before.
   - Measured on a corpus of 12 first attempts (`delegation.test.ts`): before, 7 of the 8 well-meant reports were
     refused; after, 0. The 4 really wrong ones are still refused (a criterion missing, `met` as text, done with an
     unmet criterion, another criterion).
3. **No report while the plan waits.** `agent_report` is refused (`PLAN_WAITS_REFUSAL`) while the chat's plan is
   `proposed` or `revising`. The refusal says to end the turn and wait for his decision.
4. **Told when done** (`agents/watched-asks.ts`). His own message to the Orchestrator that names an open root chat (its
   title or a part of it, as a word), or asks in general («come procede», «a che punto», «mi fai il punto», «novità»)
   about the root chats at work, watches them for 6 h.
   - When one delivers a quiet result, the Orchestrator gets one app message: tell him in ONE short line, now,
     unasked. Once per ask.
   - A result the Orchestrator already synthesizes only ends the watch.
   - The hooks are `ChatManager.onOwnerAsked` (manager.ts, his message) and `onResultReleased` (manager-delegation.ts
     `releaseResult`). They are wired in wiring.ts.
5. Not here: ADR 0367.
6. **A fresh session after 3 compactions.** Each engine session counts its compactions (`Rec.compactions`, in
   memory). At `FRESH_AFTER_COMPACTIONS` (3) the chat is due for the fresh session with the protected hand-off of ADR
   0356 (`handoff.ts freshDue`), whatever the meter says, under the same guards: idle, nothing open, plan included.
7. **Short agent-to-agent messages.**
   - `agent_report` output is at most `REPORT_OUTPUT_MAX` (4000). Over it, it is refused, not cut, with where the detail
     goes: a file (in its folder, or the brain's `tmp/`), its path in the text. The same call is then sent again.
   - One delegation contract is at most `CONTRACT_TEXT_MAX` (5000) characters in all its fields together, with the
     same refusal (`checkContract`, every `agent_delegate` / `agent_assign_task`).
   - `RESULT_OUTPUT_MAX` stays the stored ceiling of older results.
8. **«Aggiorna» waits for the chats at work** (`update/when-idle.ts`, `AppSourceService.updateNow`).
   - With chats running a turn, the update does not start. Its state is `waiting`, and the message names how many.
   - It goes by itself when none runs (looked at every 5 s).
   - After 20 min it stops waiting and asks: «Aggiorna ora» interrupts N chats, or press «Aggiorna» later.
   - «Aggiorna ora» (`source:updateNow { now: true }`) goes at once.
   - The confirm text says so. The wait is before the pull, so a turn started during the build is not covered.
9. **Night mode parks only what his rules keep for him.**
   - While he is away, the brain rules read a request with `NIGHT_BUDGET_MS` (2 s) instead of 250 ms: a request they did
     not read in time under the evening's load is parked at night, not asked.
   - A request no rule holds then passes as by day; what a rule holds, a role limit he set, the rules file, unreadable
     rules and a cut request under a rule are parked as before.
   - `AWAY_PARKED` no longer says «the app never grants a permission» (older than ADR 0294). It names why it is his.

## Consequences

- A role card change he asked for in his own words is applied even when the engine was slow to show his message, or
  mail came in between. A typed time older than 2 min, or mail after 10 min, still holds it.
- Every tool of the app is in every chat's prompt from its first turn: more prompt tokens per chat (the app's tools are a
  few thousand tokens), no ToolSearch round trip and no failed call.
- A report over 4000 characters, or a contract over 5000, costs one more call (the shorter one), never a cut text. A
  lost detail was worse.
- An Orchestrator turn of one line for each result he asked about: a few cents, against his «come procede?» turn.
- A chat compacted 3 times goes on in a fresh session: one cold start against the cost of a fourth compaction. After a
  restart the count starts again.
- At night a request can hold the main process up to 2 s on a pathological pattern: bounded, and only when nobody is
  waiting on the window anyway.
- Tests (each red before, green after): `appctl-user-words.test.ts`, `appctl-config.test.ts` (point 1);
  `mcp/always-load.test.ts`, `mcp/json-args.test.ts`, `yes-no.test.ts`, `chats/brief-options.test.ts`,
  `agents/delegation.test.ts` «first attempts» (point 2); `agents/strategy.test.ts` (point 3); `agents/delegation.test.ts`
  «point 4» and `agents/watched-asks.test.ts` (point 4); `chats/fresh-sessions.test.ts` (point 6);
  `agents/delegation.test.ts` «point 7» (point 7); `update-when-idle.test.ts` (point 8); `chats/away.test.ts` (point 9).
- Not tried on a real PC yet.
