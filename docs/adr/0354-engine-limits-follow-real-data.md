# ADR 0354 · Engine limits follow the real data: one rule, short pauses, and a stopped chat moves within its level

Date: 2026-11-25 · Status: accepted (owner, project thread «Far seguire ai limiti dei motori i dati veri», 2026-11-25:
«quando parte una chat l'app sceglie il primo motore della scheda che ha davvero credito. Se ne salta uno, l'utente vede
quale, perché e fino a quando. Un motore con credito non resta mai fermo per una pausa inventata. Una chat fermata dal
limite cambia motore da sola e tiene il suo livello») · Supersedes: the credit-pause parts of ADR 0218 (doubling up to a
day), the «room» of ADR 0347 point 3, the «wait until the card changes» part of ADR 0346, the «next model of the card»
part of ADR 0348 · Amends: ADR 0334 (the limits panel shows the app's verdict per engine)

## Context

On the owner's PC six «The usage limit has been reached» errors on OpenCode/OpenAI in about three minutes left the pool
`opencode:openai` «exhausted» with no reset and a 24-hour pause. The next morning the panel read 5h 0% and 7d 31%, yet
the first model of the card (Sol) was still skipped. The code had seven causes, all confirmed:

1. `CreditBook.signal` doubled the pause at every error, up to 24 hours, also for turns started before the pause.
2. `signal` never knew the plan's resets: the usage monitor was not connected to it.
3. In `room` a pause won over a newer reading.
4. `worked()` ignored a clean turn while a pause ran.
5. `CreditBook.refresh` was never called.
6. Pauses were kept per provider, readings per engine; a delegator's price ceiling lowered a moved chat's level.
7. `app_create_chat` answered `brain.route` (the card's first model) instead of the model really picked.

## Decision

1. **One pure rule**, `src/shared/credit-rule.ts` `creditVerdict`: from the pool's last reading, its last limit error
   and pause, the start of the last clean turn and a probe in flight it says free · pace · out · probation · unknown,
   with reason, source and expected end. Every user of credits reads it: the pick of a level (`roomOf` is a mapping),
   the credit wait, the limits panel, `app_create_chat`, `app_assign_task`, the recap and the digest.
2. **Precedence.** A window at 98% or more is out until its reset (the farthest of several); with no reset, until a new
   reading drops below 98%. A valid reading newer than the error, all under 98%, with the short pause over: free. An
   error newer than the reading: read again now, meanwhile the short pause. An error, then a reading under 98%: the short
   pause, then probation. No reading possible: the short pause, then probation. A valid reading succeeded, is at most 5
   minutes old, of the same pool and account. The short pause is 5 minutes.
3. **Pauses.** Errors of turns that started before the pause ended count as one. Only a probe that started after the
   pause and failed doubles it: cap 1 hour on a pool the app can read, a day on one it cannot. A clean turn that started
   after the last error frees the pool, also during the pause. One chat at a time starts on probation (15-minute claim).
   After a reset the pool is read again; with no reading, probation. No restart needed: `credit-live.ts` keeps a timer
   at the nearest end.
4. **When to read** (`UsageMonitor.readNow`): at a limit error, at a reset, and before a pick when a pool looks stopped
   and its reading is not valid. One shared read per vendor, at most every 2 minutes for Claude and 1 for the others (an
   assumption, not a documented limit); a launch waits at most 2.5 seconds for it.
5. **Key = engine + provider + account.** OpenCode has one reading per provider. Accounts are a 16-hex hash, never the
   address. Another account, or a good reading right after a signed-out one, drops the old pause. A window of one model
   stops only that model; spend windows never stop the plan.
6. **The reason is saved and shown.** A launch that skipped a model records `pick` on the chat and says it in the chat
   («gpt-5.5 (opencode) saltato: credito finito, 5h al 100%, torna alle 22:40 · parte su …»); `app_create_chat` and
   `agent_children` answer it, `app_assign_task` says when its engine is not free, the digest and the recap show it. An
   engine turned off says «motore spento», never «credito finito».
7. **Limits panel.** Each engine shows the worst verdict of its pools: cause, end and «Riprova ora» (reads again; a pause
   from an error ends now and one chat tries). A bar the app skips is never green.
8. **userModel** recorded on the chat the Orchestrator opened holds for the chats opened under it, when their role has
   that model. An agent cannot pass one (agent_delegate has no such field).
9. **A chat stopped by the limit** moves to the first model with room of the same level, in the card's order, on any
   engine, with the card's effort. The level is held (no delegator ceiling). The 8 s announcement and «Annulla» stay; no
   question to the user. A whole level out waits and goes on with the first model that frees, also the same one. On
   another engine the work continues in a linked chat with the same parent, contract and worktree (`sameWorktree`), the
   result delivered once. One move per chat at a time, starts 5 s apart, at most two at once; a refused model is skipped,
   a temporary failure retried after 30, 60, 120 s. «Annulla» holds until the role's levels change.
10. **Migration.** credits.json version 1 is read: an «exhausted» pool becomes a short pause from its time. Old waits
    without a card follow the new rule.

Unchanged: the card's order, the 98% threshold, the pace rule, engines the user turned off, permissions.

## Consequences

- `CreditBook.refresh`, `creditCard`, `creditOtherEngine`, `creditResumed` and the doubling cooldown are gone.
- The real windows that ended on the owner's PC were not seen (probably 5h). The minimum read intervals are an
  assumption. Untried on a real PC.
- Tests: `test/unit/shared/credit-rule.test.ts`, `test/unit/agents/credit-truth.test.ts`,
  `test/unit/agents/credit-wait.test.ts`.
