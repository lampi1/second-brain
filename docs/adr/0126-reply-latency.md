# ADR 0126 · Reply latency: the engine starts while the user types, the user's request skips the CPU queue

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «c'è un serio problema di lentezza nelle risposte da sempre,
un altro mio collega anche lui istanzia le cli ma non ha questo problema») · Builds on: ADR 0025, 0036, 0099, 0103

## Context
An audit of the path from Enter to the first token (2026-10-22). Already in place: one long-lived process per chat on
every engine (Claude stream-json, `codex app-server`, ACP), streamed text flushed at once, warm Claude engines for new
chats (ADR 0025, 0099), the Orchestrator never released. What still sat between the user and the first token:
- **A released engine starts after the Enter.** After `engineIdleMin` (30 min) a chat's engine ends; its next message
  first waits the CLI's start-up (10-25 s measured in ADR 0025; public reports of Claude Code on Windows show far
  longer cold starts: issue 85050 of anthropics/claude-code, read on the claudeissues.com mirror, measured 111-136 s for a trivial `claude -p` on Windows 2.1.224).
- **The request the user waits for could wait for the CPU queue.** A root chat the Orchestrator opens is an agent's
  start (ADR 0036): with the CPU over 75 % (often, right after a CLI starts) it waited, in turn, behind the start-up.
- **The turn's checkpoint runs before the message reaches the engine** (ADR 0103): seven git starts in a row, one of
  them `git rev-parse --show-toplevel` asked again on every turn.
- **No timing between Enter and the engine:** the logs timed the engine (`timing: engine ready`, `timing: turn`), not
  the app's own steps before it.

## Decision
- **The engine starts while the user types** (`ChatManager.prewarm`, IPC `chat:prewarm`, ChatInput at most once a
  minute per chat): a chat whose engine was released resumes as soon as the input has text (a resume, no message, no
  tokens). Not for a chat whose next message goes to a fresh session (ADR 0031 `coldRoute`), nor a closed, queued,
  closing or failed one; Claude only (`caps.warm`), like the warm pool. A started engine the user leaves is released
  again after `engineIdleMin`.
- **A root chat the Orchestrator opens while answering the user's own message never waits for the CPU queue**, like
  the user's own messages (ADR 0036); one it opens on its own (app news, mail) and every delegated child still do.
- **Checkpoint:** the repository's root found once per chat folder is reused; the tree and HEAD are read in parallel.
- **Timings in the logs:** `timing: before send` (total, cold switch, engine start, checkpoint), `prepMs` and
  `queued` on `chat created`, `timing: brain sync before a new chat` when the pull before a new chat takes ≥ 300 ms.
  `npm run logs -- --scope chats --grep timing`.

## Consequences
- Returning to a chat after a pause: the start-up overlaps the typing instead of following the Enter.
- Not changed here, to measure first with the new timings: the Orchestrator → role hop itself (two model calls before
  a role's answer), a delegated child's cold start, the cold continuation after the cache expired (a fresh session
  that starts at the Enter), the checkpoint on the critical path.
