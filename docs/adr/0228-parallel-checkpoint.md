# 0228 — The checkpoint runs while the message goes; the first write waits for it; a restart resumes only recent turns

Accepted. Refines [ADR 0103](0103-safety-without-popups.md) (a checkpoint before every turn). The undo stays exact. What changes is where the wait happens.

## Context

ADR 0103 takes a git snapshot of a work chat's folder before each turn: a temporary index, `git add -A`, a commit under `refs/sb/checkpoints/`. The message waited for it. From 4 to 7 November 2026, 172 of 1047 sends waited more than 1 s before reaching the engine (521 s in total). Almost all of that was the snapshot (p90 of the wait before send: 2.4 s), on big repositories and on a busy machine.

The snapshot only has to come before the turn's first change to the files. Reading, thinking and answering can start at once.

## Decision

1. **Send first, snapshot in parallel, gate the first write.** For a session that can hold its tools, `deliverNow` starts the snapshot and sends the message at once. The session holds every tool that may write until the snapshot settles. Sessions that cannot hold their tools keep today's order: the snapshot first, then the message.
2. **Claude: an always-registered PreToolUse hook** (`claude.ts`, `write-barrier.ts`). Non-read-only sessions register a `*` matcher with callback `sb_write_barrier` at initialize. PreToolUse runs before the permission check, and it also runs for sub-agents. Read-only tools (Read, Grep, Glob, WebFetch, TodoWrite, AskUserQuestion, …) get `{}` at once. Every other tool waits for the snapshot, including Write, Edit, MultiEdit, NotebookEdit, Bash, PowerShell, MCP tools, Agent, and tools we do not know yet. `holdWrites` answers true only after the CLI's initialize reply, so the hook is known to be in place. Before that (a cold first turn), the manager waits for the snapshot as before; that wait overlaps the engine's own boot anyway. Warm-pool engines are ClaudeSessions, so they get the same barrier.
3. **Codex and ACP (Cursor, OpenCode) keep waiting before send.** Codex runs in `workspace-write` with `on-request` approvals: it writes inside the workspace without asking, so no approval request comes before the change. ACP agents get no `fs` or `terminal` client capabilities from us and write directly; a remembered grant also skips the permission request. Neither path gives a reliable hook before the first write. Holding them would let a write slip into the snapshot, so they keep the ADR 0103 order.
4. **A deadline that never lies.** A turn's snapshot not in `CHECKPOINT_DEADLINE_MS` (45 s) after the turn asked for it is given up. The clock includes the wait for the previous turn's snapshot, so a chain of slow snapshots never holds a write longer. It is logged with cause and hint, and the held writes go on. That turn simply has no checkpoint: an undo rewinds the previous turn, and that turn's recorded end leaves later changes alone. The deadline is below the hook timeout we register (120 s): if the CLI timed out first, it would run the tool without us.
5. **Order and ownership.** A turn's snapshot starts only after the previous one settled and the previous turn's end was recorded, so the list stays in turn order and this turn's writes never reach that record. A sequence number marks a turn undoable only when its own snapshot landed, so a late one never marks a newer turn. Each checkpoint remembers its turn. A snapshot that lands after a newer turn's is dropped. `recordTurnEnd` records every turn end, in order, once that turn's snapshot is in (a turn with no write can end before it), and only on that turn's own checkpoint: a given-up turn never records on the previous one. Receipts check the same turn and keep their own rows when they wait. `undoTurn` waits for the pending snapshot.
6. **After a restart, only recent turns resume by themselves.** A turn cut by a quit or crash resumes at the next start only when the chat did something within `engineIdleMin` (30 min by default; 0 = all), measured by its last transcript item or its last turn's end. Older cut turns are marked unfinished. They keep their session and resume with `--resume` on the user's next message, like an engine released for being idle.

## The restarts of 7 November (evidence for 6)

The stable log for 13:58-14:45 UTC shows 11 starts:

- **Two were Aggiorna**: the user switched version at 13:57 and at 14:24, each with a clean quit.
- **One was a double start** at 14:09. The new version's window was ready after 8 s on a machine at 82-86 % CPU. The launcher judged it failed and started the previous release, while the first process still held the MCP port.
- **The other short-lived processes went silent 6-12 s after their start**, right after "brain data server started". They logged no exit, and Windows logged no crash report. Each was started again by hand, minutes later. Their cause is not proven by the logs.

The "43 resumes" of that day were 7 distinct chats. Most were the same 4, queued again at each short-lived start. All had been active within 19 minutes, so rule 6 would not have skipped any of them on that day. It stops resumes of chats cut long ago.

## Consequences

- A gated Claude turn reaches the engine without waiting for git. Its first write waits only for what is left of the snapshot.
- Codex, Cursor and OpenCode see no change.
- The fake CLI (`test/fixtures/fake-claude.mjs`) asks every PreToolUse hook. Its `scrivifile` scenario writes a file after the hooks allow it. The exact-rewind, race and deadline tests run against a real git repository (`test/unit/chats/checkpoint-barrier.test.ts`).
