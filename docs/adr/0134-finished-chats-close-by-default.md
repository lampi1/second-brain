# ADR 0134 · Finished chats close by default, reliably

Date: 2026-10-23 · Status: accepted (owner: «vorrei che di default le chat finite si chiudessero perchè ne ho sempre
mille aperte che hanno finito») · Amends: ADR 0084 (finished workers close by themselves), ADR 0111 (trees close as one)

## Context
Auto-close was on by default (2 minutes), yet finished chats piled up. Three causes:
1. **CLI engines never qualified.** Eligibility required a complete sub-agent census (`agentChildren.coverage ===
   'complete'`), which only the API engine reports. Claude, Codex and Cursor report `partial` or `unknown`, so their
   chats never closed. A finished foreground Claude `Agent`/`Task` call also left its row `unknown` for ever.
2. **Restarts froze them.** A chat restored at start-up is `closed` without its (unsaved) `lastResult`; a chat whose
   engine ended by itself is `closed` too. Neither was ever eligible.
3. **The warning had to be seen.** The 120-second warning counted only while its notice was visible on screen, with
   the window shown and no modal; a hidden window also let the 15-second presence lease lapse (throttled timers). With
   many chats off-screen or the user away, nothing closed.

## Decision
1. **Sub-agents: what was seen.** A live session is done when every sub-agent it observed has ended (no row
   `running`, `waiting` or `unknown`; a complete census also needs `active === 0`). Its background tasks stay held
   apart (`background`, `waitsOnWork`). An engine that is gone left nothing running: only `running`/`waiting` rows hold.
   A foreground Claude `Agent`/`Task` call ends `completed` with its result unless a native task took it over.
2. **Ended and restored chats count as finished** when their last result was clean and nothing waits. `chats.json` now
   keeps `lastResult`, `waitsOn`, `waitsOnWork` and `unfinished` (the engine ended with an error or in the middle of a
   turn), so an error, a Stop, «Vuoi che proceda?» or «Aspetto la QA…» stay open across a restart. A chat saved before
   this (no saved result) counts as finished when it had turns. The saved result feeds only the auto-close
   (`Rec.savedResult`); the summary still starts without one. Their clock starts at start-up (full delay and warning).
   On resume, the sub-agent rows the previous engine never saw end (`unknown`) are dropped: they died with it.
3. **The warning runs whether or not it is seen.** The notice still shows on the strip with
   «Resta aperto» (the corner list was removed on 2026-10-24, owner: it was noise); any touch, draft, focus or queued message still stops it. With the window hidden or minimized
   (`away`) a stale presence keeps its last holds instead of suspending the close. The renderer no longer sends
   `ackDeadline`/`ackGeneration` and `lib/notice-visible.ts` is gone.

Unchanged: errors and the user's Stop stay open; the Orchestrator and Flash never auto-close; waits name themselves
(«In attesa di…»); trees close leaves-first; closed chats come back from Ctrl+K «Chiuse»; Settings `autoCloseMin`
(0 = never) and «Resta aperto» still opt out.

## Consequences
- A chat whose sub-agent work the engine did not report may close; the archive is reversible and the closing chat's
  engine is ended as before (a background task it reported holds it).
- Tests: `test/unit/auto-close-service.test.ts`, `test/unit/chats/auto-close-manager.test.ts`,
  `test/unit/chats/agent-children.test.ts`.
