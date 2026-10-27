# ADR 0171 · Main-process stalls: per-second work kept linear, store writes deferred and asynchronous

Status: accepted (2026-10-27, after the owner reported "si freeza ogni 2-3 secondi", "va a scatti anche se non ci sono
agenti che lavorano").

## Context

The stable app logged "main process blocked" 18-31 times a minute (200-2600 ms, spikes of 8.7 s and 13 s), mostly
with `steps: []`, so the log could not say what ran. `scripts/bench-stalls.mjs` replays a copy of the owner's profile
(72 chats, 765 runs, 4.5 MB agent-runs.json, 1.3 MB chats.json) in a hidden dev instance and CPU-profiles the main
process. The profile showed:

1. `ChatManager.list()` ran `refreshTaskSummary` for each chat, and each call filtered **every** run: O(chats × runs).
   list() is called by the automatic archive (every 1 s, through `mail.hasWork` for each open chat), the mail tick and
   the taskbar badge (every 2 s), and many IPC reads. It was 8.7 s of self time in 120 s with 3 chats streaming.
2. `mail.hasWork` per open chat, every second: the whole list() to find one chat, `brain.info()` (a config clone plus
   the brain folder checks: `existsSync`, `isProduct` reading files) and a synchronous `readdirSync` of the mailbox.
3. The settings clone behind the archive delay, read several times per chat per tick.
4. Every agent-runs.json and chats.json save was a synchronous serialize + write + rename on the main thread, and a
   locked rename (EPERM from antivirus or indexer) waited with `Atomics.wait` for up to 300 ms.

The garbage from these copies also explains many unlabelled stalls (GC pauses).

## Decision

1. list() builds one index of canonical root results per pass (`resultIndex`); `summary(chatId)` returns one chat
   without the whole list. mail.hasWork uses summary() and reuses a mailbox listing for `BOX_TTL_MS` (2 s). The
   automatic archive reads the mailbox again (`fresh`) right before it archives a chat.
2. `brain.info()` checks the brain folder at most every 2 s, or at once when the root changes. The archive delay reads
   the settings at most once a second.
3. `ChatManager` takes `writeDelayMs` (production: 250 ms). With it, non-strict `persist()` and `runSave()` coalesce
   into one write per burst. The body is serialized once, written to a fresh tmp asynchronously, renamed
   synchronously (writes of one file land in start order), and retried asynchronously on EPERM, EACCES or EBUSY
   (`writeLocalTextAsync`). A newer write supersedes one in flight (a generation check before each rename), so an
   older body never lands. An unchanged body is not written. Strict checkpoints (`persist(true)`, a run's start
   through `runs.start`) stay synchronous. `shutdown()` and the process `exit` handler call `flushWrites()`, which
   writes everything pending or in flight synchronously. Unit tests keep the old synchronous saves (no
   `writeDelayMs`).
4. Every timer (`timersFor`), IPC handler, emitted event, engine stdout chunk and MCP tool call is a labelled step
   (`timedStep`). A stall names the labels by their total time, count included, with `labeledMs` (the share inside
   labelled steps), and the once-a-minute log line lists the labels of the stalls it did not log (`topSinceLast`).

## Consequences

- A crash, as opposed to a quit or a normal exit, can lose the last ≤ 250 ms of non-strict chat or run changes. A
  run's start and every strict checkpoint are on disk at once.
- Bench, same snapshot, 120 s (stalls per minute from the bench's own uncapped watch; main-thread busy time from the
  CPU profile):
  - Idle, with the production pollers on: 1.5/min, 16.0 s busy before; 0/min, 2.7 s busy after.
  - 3 streaming chats: 9.5/min, 32.8 s busy before; 1.5/min, 5.6 s busy after.
- `SB_BENCH_TIMERS=1` lets the flow and lifecycle pollers run under `SB_TEST`, for the bench only. Engines stay fakes.
