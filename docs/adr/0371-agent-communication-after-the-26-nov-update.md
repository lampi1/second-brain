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

1. **His own message is the ask** (`appctl/user-words.ts`). The Orchestrator's items are told apart: his own (`ownItem`:
   text he typed on the PC, with no `from`, not the app's or an agent's `[…]` text; a phone message is never one, as
   its text is a clarification, never an ok) and the rest.
   - His typed proof matches his own last item up to `TYPED_DELIVERY_MS` (2 min) after Enter.
   - For an ordinary change (the theme, a role's engine, model or effort…), within the fresh window (10 min) mail or app
     news after it do not void it. Beyond 10 min the old rule applies. A later message of his is a new ask.
   - A **strict** change (review of #492: agent mail carrying an injected request must never count as his consent)
     keeps the old rule whatever the time: nothing but his own words since. Strict is what widens what agents may do:
     a protected setting (`codexAutonomyRoots`, budgets, the brain's folder, the rules sent to the chats…), a role's
     `tools`, `permissionCeiling`, `instructions`, `skills`, `launches`, `codeMode` (`STRICT_AGENT_KEYS`), connectors,
     an undo, the profile. Short of that it is held «da applicare» for his Sì, never applied. The refusal says which
     rule applies (`config.ts asked`).
2. **Tools right the first time.**
   - A chat's required tools carry `_meta["anthropic/alwaysLoad"]` in `tools/list` (`mcp/server.ts` mount
     `alwaysLoad(params)`): on the chat endpoint the role's required tools (`shared/role-tools.ts requiredTools`:
     `agent_report`, `plan_propose`, `agent_delegate`… the ones that failed), on the Orchestrator's endpoint
     `ORCHESTRATOR_APP_REQUIRED`. ToolSearch never defers them; every other tool stays deferred. No whole server is
     marked in `--mcp-config` (the first version did, and loaded every schema: the owner's minimal harness).
   - Upfront schemas, measured on the tools the test builds (`mcp/always-load.test.ts`; characters / 4, no browser
     tools or connectors, so the real full lists are larger: the review measured ~25-34k on the Orchestrator and
     10-18k per work chat): a worker 5.9k (every schema) → 2.5k (required only), a Strategist with a plan 10.5k → 5.2k,
     the Orchestrator 10.7k → 6.7k. Before ADR 0371 none was upfront, and these were the ones failing.
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
   `proposed`. The refusal says to end the turn and wait for his decision. In `revising` he already answered (a change,
   a doubt) and may have said «lascia perdere, dimmi cosa hai trovato»: the report goes.
4. **Told when done** (`agents/watched-asks.ts`). His own message to the Orchestrator watches open root chats for 6 h
   (a watch with no result ends then too):
   - the ones it names: a distinctive part of the title as a whole word, at least 5 characters and not only common
     words («Test», «Piano», «review» never match «lancia i test»);
   - or every root chat at work, when he asks about the work in so many words («come procede», «a che punto siamo»,
     «mi fai il punto», «novità sui lavori», «novità?» alone; never «aggiornamenti», «situazione», «come va»).
   - When one delivers a quiet result, the clean report's own wake carries the line «diglielo ora in UNA riga breve»
     (`orchestrator-wake.ts cleanReport asked`): one Orchestrator turn, never two. Only when that wake is off does
     watched-asks send its own app message. Once per ask.
   - A result the Orchestrator already synthesizes only ends the watch.
   - The hooks are `ChatManager.onOwnerAsked` (manager.ts, his message), `onCleanReport` and `onResultReleased`
     (manager-delegation.ts `releaseResult`). They are wired in wiring.ts.
5. Not here: ADR 0367.
6. **A fresh session after 3 compactions.** Each engine session counts its compactions (`Rec.compactions`, in
   memory). At `FRESH_AFTER_COMPACTIONS` (3) the chat is due for the fresh session with the protected hand-off of ADR
   0356 (`handoff.ts freshDue`), whatever the meter says, under the same guards: idle, nothing open, plan included.
7. **Short agent-to-agent messages.**
   - `agent_report` output is at most `REPORT_OUTPUT_MAX` (4000). Over it, it is refused, not cut, with where the detail
     goes: a file (in its folder, or the brain's `tmp/`), its path in the text. The same call is then sent again.
   - One delegation contract is at most `CONTRACT_TEXT_MAX` (5000) characters in all its fields together, with the
     same refusal (`checkContract`, every `agent_delegate` / `agent_assign_task`). No field alone may pass it:
     `CONTEXT_MAX` goes from 6000 to 3000; the others were already at most 2000.
   - `RESULT_OUTPUT_MAX` stays the stored ceiling of older results.
8. **«Aggiorna» waits for the chats at work** (`update/when-idle.ts`, `AppSourceService.updateNow`).
   - With chats running a turn, the update does not start. Its state is `waiting`, and the message names how many.
   - It goes by itself when none runs (looked at every 5 s).
   - After 20 min it asks: «Aggiorna ora» interrupts N chats; otherwise it still goes by itself when they end, so
     «Controlla» is never needed.
   - «Aggiorna ora» (`source:updateNow { now: true }`) goes at once.
   - The Orchestrator's code update (`app_update_code`, `pull()`) during the wait is no error: the wait holds until it
     ends, and a dev build then relaunches on the code it pulled even though its own pull finds nothing new.
   - The confirm text says so. The wait is before the pull, so a turn started during the build is not covered.
9. **Night mode parks only what his rules keep for him.**
   - The main process never runs the brain rules longer than their 250 ms budget (`BUDGET_MS`; a first version raised
     it to 2 s at night, which could block the main process for seconds).
   - At night a request they did not read in time (`slow`) is not parked: it stays unanswered while
     `policyReadOffThread` reads it in a worker thread (ended after 5 s). What his rules let through is then allowed
     as by day; what a rule holds, a read that still cannot finish, a role limit he set, the rules file, unreadable
     rules and a cut request under a rule are parked as before.
   - `AWAY_PARKED` no longer says «the app never grants a permission» (older than ADR 0294). It names why it is his.

## Consequences

- A role card change he asked for in his own words is applied even when the engine was slow to show his message, or
  mail came in between. A typed time older than 2 min, or mail after 10 min, still holds it, and so does any mail for
  a change that widens what agents may do.
- Only each chat's required tools are in its prompt from the first turn (a few thousand tokens); the rest costs
  nothing until ToolSearch loads it.
- A report over 4000 characters, or a contract over 5000, costs one more call (the shorter one), never a cut text. A
  lost detail was worse.
- An Orchestrator turn of one line for each result he asked about: a few cents, against his «come procede?» turn.
- A chat compacted 3 times goes on in a fresh session: one cold start against the cost of a fourth compaction. After a
  restart the count starts again.
- At night a slow request waits up to 5 s for the worker thread's read, with the main process free meanwhile.
- Tests (each red before, green after): `appctl-user-words.test.ts`, `appctl-config.test.ts` (point 1, with the
  review's injected mail asking for an autonomy root, a role's tools or ceiling);
  `mcp/always-load.test.ts`, `mcp/json-args.test.ts`, `yes-no.test.ts`, `chats/brief-options.test.ts`,
  `agents/delegation.test.ts` «first attempts» (point 2); `agents/strategy.test.ts` (point 3); `agents/delegation.test.ts`
  «point 4» and `agents/watched-asks.test.ts` (point 4); `chats/fresh-sessions.test.ts` (point 6);
  `agents/delegation.test.ts` «point 7» (point 7); `update-when-idle.test.ts` (point 8); `chats/away.test.ts`,
  `chats/permit-policy.test.ts` (point 9); `orchestrator-wake.test.ts` (point 4's single wake).
- Not tried on a real PC yet.
