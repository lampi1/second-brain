# ADR 0360 · The user's ✕ keeps the chat among the closed, and the Orchestrator hears of it

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25) ·
Keeps: ADR 0352 (a chat the user closed takes no agent's message), the delegation tree's cancel (ChatManager.cancelTree), the auto-close

## Context

Seen on 2026-11-25 in the log: two root Strategist chats closed with ✕. `chat archived auto:false` came first, then (after the
renderer's 6-second «Annulla» toast, or as soon as a slow engine finished exiting) `chat closed` and `chat forgotten`. The
renderer's final step called `chat:close`, which runs `ChatManager.close` and deletes the chat from the manager. So
`app_chats` «closed» did not list it, and `app_reopen_chat` / `app_send_to_chat` answered «chat non trovata», against the
contract that a ✕-closed chat is reopened when the user asks (tools.ts, ADR 0352). Only its delegated children stayed.
The Orchestrator got no message either.

## Decision

- **The ✕ never deletes.** After «Annulla» the renderer calls `chat:close` with `keep: true`: `ChatManager.finishClose` ends
  the engines the chat outlived and its run, and the chat stays among the closed (`closedBy: 'user'`) with its history for the
  usual 7 days (`recentClosed`), reopened by one click, by `app_reopen_chat` (the user asked), or by his own message. A
  reopen resumes the engine session. `chat:close` without `keep` stays the explicit removal for good (agents' `app_close_chat`,
  tests); the demo keeps its archived chats as they are.
- **The Orchestrator hears of a ✕ that cut open work short, once.** `archiveOne` records `closedWith` (an assignment, a turn at
  work, requests waiting for the user, a queued start; the run id; the last line) before the interrupt changes the state.
  OrchestratorWake adds a quiet `user-closed` news for a root chat: it never wakes the Orchestrator by itself, rides along
  with its next turn, is dropped when the chat is reopened before it went, and is listed in the held news. A delegated chat
  stopped with its parent is not told (the parent's notice says it). `app_chats` («closed») and `app_digest` show `closedWith`.
- **«Annulla» lasts 6 seconds from the click** (the toast), whatever the engine does: a slow exit (the second chat took over
  10 s) only delays the final close, it never eats the window; a click during the exit reopens as soon as the archive ends.
  Main also ends the run after 15 s with no reopen.

## Consequences

A ✕-closed root chat is never lost: it is in the closed list, on `app_chats`, reopenable. The closed list is still capped
(`MAX_ARCHIVED` 60, newest first). Tests: `test/unit/chats/user-close-keep.test.ts` (final close, closed list, reopen with
resume, no-op after «Annulla», removal without `keep`), `test/unit/orchestrator-wake.test.ts` (the notice). Untried on a real PC.
