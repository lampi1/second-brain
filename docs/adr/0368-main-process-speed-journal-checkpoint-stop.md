# ADR 0368 · The journal reads only open requests, a clean tree's checkpoint is HEAD, a stop ends within a second

Date: 2026-11-27 · Status: accepted (owner's measurements of 2026-11-27) · Amends: ADR 0103 (checkpoints), ADR 0228
(checkpoint alongside the turn), the coordination journal of `src/main/coordination/store.ts`

## Context

Measured on the owner's PC on 2026-11-27, after his latest updates:

- **Window stalls**: «main process blocked» about 45 times an hour (p50 0.23 s), every one labelled `wiring/auto-close`,
  because every `setInterval` in `src/main/wiring.ts` shared that label. The probable cause: the work driver's minute
  tick calls `Workflows.projection()`, whose `projectionRequests()` decoded the last 2000 rows of the coordination journal
  (three JSON columns each), and that journal grew ~470 rows an hour: each permission the app's own gate allowed
  («auto-permit allowed») wrote a request, a decision and a delivery in four synchronous transactions. 66,689 rows on his PC.
- **Pre-turn checkpoint** on every engine but Claude (only Claude can hold its writes, ADR 0228): p50 4 s before the
  turn starts. A snapshot is 6-7 git processes, and each git spawn costs 0.9-6 s there (ADR 0227).
- **Stop**: after a stop the next turn started ~12 s later (p50); OpenCode ignored the cancel 13 times (each a 5 s wait,
  then a restart); the Orchestrator's red square was slow to show the stop.

## Decision

1. **Each poller has its own label** (`wiring.ts`, `every(label, …)`): `wiring/auto-close`, `wiring/work-driver`,
   `wiring/lifecycle`, `wiring/judge`, `wiring/worktree-cleanup`; a stall names the one that ran.
2. **A permission the app's gate allowed is not journaled** (`manager-requests.ts` `gateAllowed`): auto-permit and the
   role gate's allows go straight to the engine; their record is the gate's own log line. A request shown to the user, a
   refusal, and every answer given for him (night mode, the Orchestrator, the ladder) keep their receipts as before.
3. **A projection reads only the open requests** (`CoordinationStore.projectionRequests`): `coordination_open_requests`
   drives the query (a cross join: the plain join made SQLite walk every request by its time), and the rows are cached
   until a commit to the file by any connection (`pragma data_version`) or a write of this one (`total_changes()`). Closed
   history is no longer part of a job's `coordination.requests`; `requests()` still reads it.
4. **The old auto-permitted rows are removed once** (`coordination/prune.ts`): three minutes after the start, 50 requests
   per transaction (with their decision, delivery and execution rows), one batch a second, only permissions allowed by
   auto-permit or the role gate, delivered and older than a day. When a pass leaves rows younger than a day (the day
   before the upgrade) it runs again a day later (or at the next start); only when no such row is left at all is it
   marked done in `coordination_meta`, and it never runs again. A failing batch pauses it until the next start.
5. **The checkpoint checks first** (`checkpoints.ts` `turnCheckpoint`): one `git status --porcelain=v2 --branch`; a tree
   that matches HEAD has HEAD itself as its checkpoint (its ref written in the background), so the turn starts after one
   git process; a changed tree (or no commit yet) takes the full snapshot as before, with the root already known.
   `prune` keeps the newest checkpoints by the time in their ref name, not git's creatordate (a HEAD checkpoint's commit
   may be days old and would be deleted first).
6. **A stop ends within a second**: an ACP engine's cancel grace is 1 s (`CANCEL_GRACE_MS`, was 5 s); a Claude turn
   whose result has not come 1 s after the interrupt (`STOP_GRACE_MS`, `claude.ts` `watchStop`) ends at once as the
   user's stop and the engine is restarted on the same session through the same `SessionPatch.restart` as ACP, carrying
   every message sent into the turn that no result answered (app news, mail, a «step» correction, what came after the
   stop; one the model already read between two tool steps may reach it twice). The tile shows the stop at once
   (`renderer/store/stopping.ts`): main's «running» while the turn ends is shown as stopped, and what the user types
   waits in the queue until main is free; the queue goes when the stop settles even if main's idle equals the shown one,
   and after STOP_SHOWN_MS (15 s) with no word from main its last state shows again.
7. **The user's message goes before the app's news**: a message to the Orchestrator while it works on a turn only the
   app's own news started interrupts that turn and goes first («Invia subito»'s path). Main says whose turn it is
   (`ChatSummary.turnFromUser`, its `turnFromUser` of #123): a turn the user started stays his when news joins it.

## Measured

`node scripts/bench-main-stalls.mjs` (this container, Linux, 66,689 seeded auto-permit rows; the owner's Windows PC is
several times slower, so the ratios matter, not the milliseconds):

| What | Before | After |
|------|--------|-------|
| `projectionRequests()` (first read) | 42.7 ms, 2000 rows decoded | 0.3 ms, the 5 open rows; cached reads 0.01 ms |
| `Workflows.projection()`, the work driver's tick | 46.7 ms | 0.12 ms |
| journal writes per auto-permitted permission | 4 transactions, 0.28 ms | none |
| clean-up batch (50 rows) | — | median 4 ms, worst 66 ms (a WAL checkpoint) |
| pre-turn checkpoint, clean tree | 7 git processes, 45 ms | 1 git process, 8-14 ms |
| pre-turn checkpoint, changed tree | 7 git processes | 7 git processes (status replaces rev-parse) |
| stop → engine ended, an engine ignoring it | 5 s (ACP), unbounded (Claude) | 1 s |

## Consequences

- The minute tick no longer decodes the journal; the ~470 rows an hour stop; the old rows go within ~25 minutes of the
  first start.
- A Claude engine that does not end a stopped turn in 1 s is killed and resumed: its next turn pays a cold start
  (~3 s) instead of waiting for the old one. Messages sent into the turn and not answered by a result go to the new
  engine; one already read mid-turn may be read twice.
- A job's `coordination.requests` lists its open requests only.
- Not proven on the owner's PC yet: the stall rate and the stop-to-next-turn time need his next day of logs
  (`npm run logs -- --scope perf`, «timer wiring/…»). Every git spawn of the worktree hold (#357) still runs on the main
  thread's CreateProcess; it is async JS and was left as is.
- Pinned by `test/unit/coordination-prune.test.ts`, `test/unit/chats/gate-allowed-journal.test.ts`,
  `test/unit/chats/turn-checkpoint.test.ts`, `test/unit/chats/claude-stop-watch.test.ts`, `test/unit/store-stopping.test.ts`,
  `test/unit/chats/turn-from-user.test.ts`.
