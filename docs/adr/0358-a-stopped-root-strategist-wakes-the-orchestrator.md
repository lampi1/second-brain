# ADR 0358 · A root Strategist stopped without a result wakes the Orchestrator

Date: 2026-11-25 · Status: accepted (owner, project thread «Far svegliare l'Orchestrator dallo Stratega fermo»,
2026-11-25: «Uno Stratega fermo senza risultato deve svegliare l'Orchestrator») · Amends: the quiet turn ends of
2026-11-07 (cloudroom comms proposal 1) and 2026-10-13, for this one case

## Context

A plain turn end is `quiet` (`orchestrator-delivery.ts`): it rides along with the Orchestrator's next turn and never
wakes it. Seen on 25/11 (release 0.1.0-fc55c02d, Strategist on OpenCode, Orchestrator on Claude): a Strategist the
Orchestrator opened closed its turn at 09:17:13 with a final text and no `agent_report`, waiting for an answer from the
Orchestrator; the idle Orchestrator heard of it only at 09:19:20, with the user's own message. For the user the
Strategist had finished, and the Orchestrator knew nothing.

## Decision

1. **The turn end of a root Strategist is `group`** (delivered within `ORCHESTRATOR_GROUP_MS`, 30 s) only when all
   hold (`stuckStrategist` in `src/main/chats/orchestrator-wake.ts`): a catalog Strategist with no parent, started by
   the Orchestrator, its run still open and no `agent_report` for that run; no question, permission or command open
   (the chat's `pending` and the requests seen on `pending:added` / `pending:resolved`) and no plan `proposed`; no
   chat under it, at any depth, running, waiting, starting or queued; no `agent_wake_later` set (`useWakeLater`,
   wired in `wiring.ts`); no `creditWait` and no `plan.stopped` («Ferma»). Otherwise it stays `quiet`.
2. **Read again at delivery**: the class is computed from the live chat list every time the buffer is timed and sent,
   so a new turn, a report or a request within the window makes it quiet again, and nothing goes by itself.
3. **The line says it is stopped without a result**, with its last line, and that it is no completed work and does
   not count as a report, consent or permission. The flag `stuck` is set only on the message sent, never stored.
4. **Unchanged**: Scout, Artisan, Sentinel, Herald and child Strategists; the `hold` gate (only `now` passes while the
   Orchestrator waits for the user); one news per chat every `ORCHESTRATOR_PER_CHAT_MS`; a delivered report adds no
   second wake for the same turn.

## Consequences

One Orchestrator turn more when a Strategist really stops (the measured cost of a wake, ~0.18 $, ADR header of
`orchestrator-delivery.ts`), never for a Strategist that reported, asks the user or waits on work. Tests:
`test/unit/chats/orchestrator-wake-stuck.test.ts`. Untried on a real PC.
