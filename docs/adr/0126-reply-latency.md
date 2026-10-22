# ADR 0126 · Reply latency: the engine starts while the user types, the user's request skips the CPU queue

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «c'è un serio problema di lentezza nelle risposte da sempre,
un altro mio collega anche lui istanzia le cli ma non ha questo problema») · Builds on: ADR 0025, 0036, 0099, 0103

## Context
An audit of the path from Enter to the first token (2026-10-22). Already in place: one long-lived process per chat on
every engine (Claude stream-json, `codex app-server`, ACP), streamed text flushed at once, warm Claude engines for new
chats (ADR 0025, 0099), the Orchestrator never released. What still sat between the user and the first token:
- **A chat with no engine starts it after the Enter.** After a restart only the Orchestrator and Flash start ahead;
  every other chat (and one whose engine ended or was released) first waits the CLI's start-up (10-25 s measured in ADR 0025; public reports of Claude Code on Windows show far
  longer cold starts: issue 85050 of anthropics/claude-code, read on the claudeissues.com mirror, measured 111-136 s for a trivial `claude -p` on Windows 2.1.224).
- **The request the user waits for could wait for the CPU queue.** A root chat the Orchestrator opens is an agent's
  start (ADR 0036): with the CPU over 75 % (often, right after a CLI starts) it waited, in turn, behind the start-up.
- **The turn's checkpoint runs before the message reaches the engine** (ADR 0103): seven git starts in a row.
- **No timing between Enter and the engine:** the logs timed the engine (`timing: engine ready`, `timing: turn`), not
  the app's own steps before it.

## Decision
- **The engine starts while the user types** (`ChatManager.prewarm`, IPC `chat:prewarm`, ChatInput at most once a
  minute per chat): a chat with no engine resumes as soon as the input has text (a resume, no message, no tokens).
  Not for a chat whose next message goes, or within 5 min will go, to a fresh session (ADR 0031 `coldRoute`), nor a
  closed, queued, closing or failed one; Claude only (`caps.warm`), like the warm pool. Such an engine never writes a
  cold note (no quiet turn, no tokens), and one nobody writes to within 5 min ends again (`releaseIdle` never ends a
  Claude engine whose sub-agents it cannot observe, so nothing else would).
- **A root chat the Orchestrator opens while answering the user's own message never waits for the CPU queue**, like
  the user's own messages (ADR 0036); one it opens on its own (app news, mail) and every delegated child still do.
- **Checkpoint:** the tree and HEAD are read in parallel (the root is still asked each turn: a `git init` or a removed
  `.git` in the folder must be seen).
- **Timings in the logs:** `timing: before send` (total, cold switch, engine start, checkpoint), `prepMs` and
  `queued` on `chat created`, `timing: brain sync before a new chat` when the pull before a new chat takes ≥ 300 ms.
  `npm run logs -- --scope chats --grep timing`.

## Amended (owner, 2026-10-22: «SI fallo subito»): a waiting engine for delegated chats
- Asked «perché non conviene avere le CLI sempre accese?»: an open Claude chat's CLI already stays on (`releaseIdle`
  never ends one whose sub-agents it cannot observe). One idle CLI measured ~190 MB RSS (Linux, no MCP server, CLI
  2.1.308), plus its MCP servers; no tokens. One per role was judged too much memory for engines mostly idle.
- A delegated chat now takes a waiting engine too: launched as a child of the same role under the same role chain
  (`WarmLaunch.view.child.ancestors`, part of the launch digest). Before a chat owns it, its endpoint lists the
  child's tools (`agent_ask_parent`) and `mcpContext` answers that chain, so its managed MCP servers are bounded as a
  cold child's; a parent with no known chain → cold, as before. After a delegated chat starts, one like it waits for
  the next (a role's steps one after another, e.g. the Strategist's plan); parallel delegations take one, the others
  start cold. The pool keeps up to 3 engines instead of 2 (least recently used leaves first); a child's
  engine past 30 min is closed, not started again. An adopted engine gets the mode the chat would be launched with
  (`modeFor`: a delegated chat's ceiling is its parent's mode), never the user's default above it.

## Consequences
- Writing to a chat after a restart: the start-up overlaps the typing instead of following the Enter.
- Not changed here, to measure first with the new timings: the Orchestrator → role hop itself (two model calls before
  a role's answer), the cold continuation after the cache expired (a fresh session
  that starts at the Enter), the checkpoint on the critical path.
