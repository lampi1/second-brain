# ADR 0103 · Safety without popups: a checkpoint before every turn

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «di default hanno tutti i permessi perché se no i popup compaiono
ogni 2 secondi») · Builds on: ADR 0085

## Context
Every role has every permission by default (ADR 0085), but nothing could put a chat's files back after a bad turn:
no checkpoint, no undo, and the guards outside the stable copy only cover killing processes. A popup per command is
what the owner refused; the safety net has to work after the fact.

## Decision
- Before each turn of a work chat whose folder is in a git work tree, `chats/checkpoints.ts` records the files as they
  are (tracked and untracked, `.gitignore` respected) in a commit object under `refs/sb/checkpoints/<chat>/<time>`,
  through a copy of the index: the user's index, HEAD and branches are never touched. The last 30 per chat are kept.
- «Annulla l'ultimo turno» (the chat's menu, IPC `chat:undoTurn`) restores the files changed or deleted since and
  removes the files created since; ignored files (builds, dependencies) stay. The chat learns it with its next message.
  Never while the chat works.
- Not the Orchestrator (it does not edit work files). Off in the test suite (`SB_TEST`).

## Consequences
- A turn costs a `git add -A` on a temporary index before it starts (fast with the index's stat cache; a failure only
  means that turn cannot be undone, never a held message).
- Checkpoints live in the app's memory for the session; their refs stay in the repository until pruned.
- Proposed and held for the owner's explicit confirmation: the app answering permission requests itself (allow normal
  work, refuse destructive commands with their reason, ask only for what leaves the machine). The session's own safety
  review stopped it as an agent that approves agents' actions; the code waits in a stash.

## After the review (2026-10-20)
- When a turn ends its files are recorded again; the undo puts back only the paths that turn changed, and leaves a path
  changed again since (the user's or another chat's edit) as it is. Nested repositories are skipped; names are literal.
- Before it touches a file, the undo records the files as they are under `refs/sb/undo/<chat>/<time>` (the last 10).
- It asks for confirmation, and is refused while chats this one started still work or another chat works in the same
  repository.
