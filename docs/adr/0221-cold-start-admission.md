# ADR 0221 · Cold-start admission: a slot semaphore, CPU/RAM only as an emergency brake

Date: 2026-11-07 · Status: accepted · Supersedes: ADR 0036 (its CPU thresholds as the queue's rule; the queue itself,
its priorities, "Avvia ora" and ADR 0064's bypasses stay)

## Context
The cloudroom speed plan (stage 1, proposals 1, 2, 6) measured the CPU queue of ADR 0036 on the user's PC (14 cores,
logs of 57 agent chats): 39 of 57 waited, queue wait p50 267 s / p90 1211 s; a warm engine was adopted once in 57
(the pool never refilled while the queue said "busy"); a cold first turn took p50 36.0 s / p90 58.6 s against a warm
one's 3.4 s, with the engine ready at p50 8.2 s. With 20-30 engines alive the CPU sits at 100 % almost always, so a
75 % threshold held work that the machine could have run: a running chat costs little, a cold start costs a lot.
cloudroom bounds only its launches (`startups` semaphore, `available_parallelism()/2`, held during launch).

## Decision
- **Only cold starts wait** (`chats/admission.ts`): a chat's engine that has to be spawned (`kind: 'start'`: an
  agent's new chat, a closed or engine-freed chat reopened by an agent, the app's resume after a restart) takes one of
  `max(1, floor(cores / 2))` slots (7 on 14 cores). The slot is held from the spawn until the engine's first answer
  (any item but the user's or a system line, a pending question, the exit, a failed send; `manager-sink.ts`
  `coldStarted`), and frees itself after 120 s at most, so a slot never leaks. A chat whose engine is up (`'turn'`)
  never waits; neither do the user's messages nor messages between open chats (ADR 0064).
- **CPU and RAM are only an emergency brake**: CPU over 95 % or free RAM under 10 % (Impostazioni, `loadQueueCpu` /
  `loadQueueRam`, still protected) holds the queue; after it, two samples in a row under are needed, then the heads go
  up to the free slots. A saved 75 / 15 nobody chose (no change in the log) moves to 95 / 10 once
  (`brain/config.ts` `migrateLoadBrake`).
- **The warm pool refills under load** (proposal 2): `ChatManager` starts the next warm engine unless the brake is
  on; chats waiting for a slot are no reason to stop, since the next one adopts that engine.
- **The queue shows why** (`QueuedInfo.starting/slots`): the tile reads "In coda · 7/7 avvii a freddo pieni", the
  tooltip counts the slots and the load; `app_state` and the queue log lines carry `coldStarts`/`slots`.
- **Every engine**: the queue sits in `ChatManager`, before any harness, so Claude, Codex, OpenCode and Cursor (both
  over ACP) are all covered; the warm pool stays Claude-only (warm.ts, unchanged in this stage).
- **The cold first turn is timed per step** (proposal 6): Claude's first `timing: turn` adds `stateAfterSpawnMs`,
  `initAfterSpawnMs`, `firstEventAfterSpawnMs`, the MCP servers and plugins at init and those still pending; Codex
  and ACP log `timing: engine ready` with `initializeMs`, login/skills/thread or session/choices laps.

## Evidence for proposal 6 (2026-11-07, CLI 2.1.283, haiku, one "ok" prompt, PC at 100 % CPU, 29 engines alive)
A probe spawning the embedded CLI the app's way, with `--debug-file`: spawn 1.7 s, first `session_state_changed`
28.6 s, `system/init` 32.9 s, `message_start` 35.7 s, result 38.1 s (API 3.8 s). About 25 s go inside the CLI before
its turn starts: settings and CA certificates 2.4 s, a 5.2 s gap before its Git Bash lookup, setup 2.4 s, MCP configs
awaited at +8 s, its startup gate open on a fallback timeout after 8.2 s, the brain's prompt hook settled in 5.8 s,
event-loop stalls of 1.7 s. User and claude.ai MCP servers connect in the background and do not hold the turn.
Variants run one after the other (message_start, two runs each): base 22.8 / 32.2 s; `CLAUDE_CODE_GIT_BASH_PATH` set
69.1 / 46.8 s; also `ENABLE_CLAUDEAI_MCP_SERVERS=0` 39.8 / 51.2 s. The CPU contention's noise dwarfs any flag: nothing
under our control is cut; the lever is fewer concurrent cold starts (the slots) and the warm pool.

## Consequences
- More chats run at once on a busy PC (up to 7 cold starts plus every running one); the brake still protects a PC at
  its limit. Tests force the load with `SB_LOAD_FORCE` ("99,40" is over the brake) and the cap with `SB_COLD_SLOTS`.
- The queue e2e (`test/e2e/admission.spec.ts`) was rewritten for the brake and the slots; it runs first on main.
- Rejected: copying cloudroom's VM pool, its bypassed permissions or its Agent SDK; a slot per running chat (a
  running chat never waits, the stage 1 brief).
