# ADR 0238 · Approved work goes on by itself: stalls, crashes, waits and pushes need no human nudge

Date: 2026-11-09 · Status: accepted (owner, project thread on total agent autonomy, 2026-11-09: stage 5 asked for
directly; decision card «Sì, push normale libero» for plain pushes) · Builds on: ADR 0234 (uncertain deliveries are
never re-executed), ADR 0191 (night mode), ADR 0103 (auto-permit) · Pattern source: davidondrej/cloudroom

## Context
The owner's goal is total autonomy: agents plan, build, test, review and ship approved work, and the owner presses
«Esegui» only for DB writes (test and production), production releases and Azure writes. Before this ADR, approved
work stopped whenever nothing pushed it: after an app restart or an engine crash, when a review sent the work back
to a chat that had closed, when a delegate went quiet, or when a chat waited on CI and simply ended its turn. A plain
`git push` also asked the user every time. cloudroom avoids these stops with a few patterns: the parent hears every
child turn end, a message to a sleeping session wakes it, a session can schedule its own next turn
(`loop create --in`), and a restart relaunches queued work.

## Decision
- **Approved = a recorded decision.** A work thread with an `approved` event is approved work. It is driven only
  while it is not waiting for the user, not done, not blocked on purpose (a `blocked` or `rejected` event after the
  last approval, even with an update after it, or 3 failed review cycles: those need a new proposal) and has no
  accepted request without a delivered or applied receipt (ADR 0234; workflow approvals never get one).
- **Stalled work is news for the Orchestrator** (`workflows/driver.ts WorkDriver`, ticked every minute by
  `wiring.ts`). When no linked chat is running, waiting, starting, pending, queued, running background tasks
  or waiting for the user in plain text (a wait on a colleague or on CI may never end, so it does not count), and nothing moved for 15 min, the Orchestrator
  gets grouped news (`OrchestratorWake.stalledWork`, kind `stalled`, class `group`) with the stage, the next action
  and why nothing moves. Again after 30 and 60 min while nothing moves, then it stops; any move resets the count and
  withdraws news not delivered yet (`unstalled`). It is not kept in the outbox: after a restart the driver tells it
  again if the thread still stalls. The Orchestrator's rule says to dispatch the next action, never only to
  acknowledge.
- **Mail wakes a closed chat** (cloudroom: a message to a sleeping session wakes it). When a linked chat closed by the
  app (not by the user) has unread mail, the driver reopens it with one app line instead of telling the Orchestrator.
- **One recovery after a crash.** An engine that exits mid-turn gets one automatic «resume» line
  (`manager-sink.ts recoverCrash`), once per turn; a result clears the flag. Never for delegated children (their
  parent already got a blocked result and decides), quick or research chats, archived routine chats, or chats the
  user closed.
- **A chat can schedule its own next turn** (`chats/wake-later.ts`, tool `agent_wake_later`, pre-approved like the
  other app chat tools): in 1–1440 minutes the app writes «[sveglia app] <reason>», reopening a closed chat. One per
  chat, kept in `userData/wake-later.json` across restarts, minutes 0 cancels, dropped for chats the user closed.
- **Plain push passes** (`auto-permit.ts`): `git push` to a named remote, with simple refs or `src:dst` refspecs and
  harmless options, runs without asking. Force pushes, deletes, URLs, `--no-verify`, `--receive-pack`, `--all` and
  odd refs still ask.
- **Gates map to the three «Esegui» categories.** The mockup and plan gates are the recorded decision that starts
  the work; the deploy gate stays the production release. Everything between them (implementation, review, fix,
  re-review, merge) runs without the user.

## Consequences
- After a restart, a crash, a review that sent the work back or a quiet delegate, approved work is taken up again
  within about 15 minutes without the user.
- The Orchestrator can be nudged at most 3 times per stall; a thread nobody can move is reported by the Orchestrator.
- Tests use fake clocks only: `test/unit/workflows/driver.test.ts`, `test/unit/chats/wake-later.test.ts`,
  `test/unit/chats/crash-resume.test.ts`, `test/unit/chats/auto-permit.test.ts`, `orchestrator-wake.test.ts`.
