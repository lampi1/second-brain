# 0217. Closing a chat with ✕ cancels its whole tree

Date: 2026-10-31. Status: accepted.

## Context

The owner (2026-10-31): «se chiudo lo stratega dalla X si chiudono anche tutte le chat figlie, e quando chiudo dalla x
interrompo anche ovviamente l'agente e il suo lavoro». Before, ✕ archived only the chat itself: its delegated children
went on working, queued turns still started, and a late child result, mail or report reopened the closed parent
(`queueChildResult` → `flushChildResults` → `send`).

## Decision

- A user close (✕ in the header or the sidebar, then the final close after «Annulla» expires) is a real cancellation
  of the chat and of every descendant (BFS over `parentId`, deepest first): active turns are interrupted, queued work
  leaves the admission queue, open questions and permissions are withdrawn unanswered (`dropPending`), the engine
  process tree of each chat ends (`session.close`, `reapKept`). Descendants already archived get `closedBy: 'user'`.
- `Rec.userClosing` is set synchronously before the first await on the chat and its descendants, so nothing that
  arrives while the close runs slips through; it is cleared only by a reopen and never persisted. Afterwards
  `closedBy === 'user'` carries the same meaning across restarts.
- No resurrection: on a chat the user closed, `agent_report` (root and delegated) throws a "stop here" error, mail is
  ignored, child results are dropped, `assignTask` from anyone but the user throws, and `send` refuses a resumed turn,
  a mail (`from`) or a non-user source, `app_send_to_chat` included (before, it reopened any closed chat). Only the
  user's own message reopens a chat, and it reopens only that chat; an agent reopens one only explicitly, with
  `app_reopen_chat` when the user asks (the refusal names it).
- «Annulla» after ✕ reopens the closed chat only; its descendants stay closed, because their work was already stopped.
- Not a cascade: auto-close (`archive({auto: true})`, ADR 0084), reports and progress mail; the Orchestrator's own
  archive. Routine-archived chats are skipped.
- Transcripts and worktrees are kept (descendants are archived, not deleted); only processes owned by the closed
  chats end, shared processes and other chats are untouched. Running the close again changes nothing more.

## Consequences

- A Strategist closed by mistake loses the in-flight work of its tree; «Annulla» brings back the chat, not the
  children's turns. The children can be reopened one by one by writing to them.
- Tests: `test/unit/chats/close-tree.test.ts` (cascade on active, waiting and queued chats, idempotence, no
  resurrection, subtree only, no cascade on auto-close and mail, real CLI processes end).
