# ADR 0282 · A chat's first turn takes its checkpoint, and a follow-up turn has its own files

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: the report's proposal
«numeri veri dei livelli», approved with «Approvo tutte le tue modifiche del report») · Amends: ADR 0103 (checkpoints),
ADR 0228 (snapshot beside the message)

## Context

A run's verdict needs the files its turns changed (`src/main/agents/receipts.ts`). They come from the turn's
checkpoint: the files' tree before the turn against the tree at its end. In the owner's real data (683 runs, five days)
57 to 60% of the runs ended with «files unknown», so their outcome could not count for the role's level.

The cause, measured on his PC: 330 checkpoints for about 520 runs, only 13 failed snapshots, none given up. Of the
runs with one turn, 328 had no files against 160 with them. A chat's first message starts its engine, and an engine
that is booting answers `busy` (`claude.ts`, `codex.ts`, `acp.ts`: stop and quit must count it). `deliverNow` read
that as «a turn is in flight» and took no checkpoint, exactly for the turn most runs consist of.

A second gap: a message queued while a turn runs takes no checkpoint on purpose (the undo covers both), and the
receipts then had nothing for that follow-up turn but what its tool rows named.

## Decision

1. `turnInFlight` (`src/main/chats/manager-core.ts`) replaces `midTurn` where a message is delivered: an engine that is
   booting and has taken no message yet has no turn in flight. `Rec.sentTo` holds the engine session the last message
   went to. `midTurn` stays as it is for stop, quit and the queue.
2. A follow-up turn under a checkpoint already read gets its own files: the tree at the previous turn's end
   (`Rec.receiptTree`) against the tree at its own end (`treeFiles`, `src/main/chats/checkpoints.ts`). Only when it
   began the moment that turn ended (`Rec.turnChained`): after an idle gap the difference would also hold what the user
   or another chat changed, so such a turn keeps what its tool rows named. The reads run one after the other
   (`Rec.receiptChain`), and a run's verdict waits for its own reads only.
3. A read that fails falls back to what the turn's tool rows named, and is logged as a warning with its cause: it was
   a debug line nobody saw.
4. A chat in a worktree the CLI made («Worktree separato») works outside its folder: the snapshot of the folder says
   nothing of its files, so its turns keep what their tool rows named.

## Consequences

- A chat that starts its engine takes one more snapshot than before (the owner's median: 3 s). It runs while the
  engine boots and the first message waits for it: a booting engine cannot hold its writing tools yet (ADR 0228).
  «Annulla l'ultimo turno» now works on a chat's first turn too.
- The share of runs with known files should rise from about 40% to most of them; to be checked on the owner's data
  after a few days of use. Still without a checkpoint: a turn resumed after an app restart, a turn the engine starts by
  itself, a chat outside a git repository.
- Not changed: runs already stored keep «files unknown».
- Tests: `test/unit/chats/receipt-files.test.ts`.
