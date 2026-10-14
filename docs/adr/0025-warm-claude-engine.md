# ADR 0025 · A Claude engine started ahead for the next new chat; start-up timings in the logs

Date: 2026-10-13 · Status: accepted

## Context
The owner, 13/10: "a parità di modello ed effort, Claude Code desktop risponde più veloce della nostra app; ottimizza
la parte in cui startiamo la CLI". Measured with `scripts/bench-claude-start.mjs` (same embedded engine 2.1.283 as the
app, same cwd, the user's own settings, MCP servers and claude.ai connectors; tiny prompt; normal CPU load):

| step | app engine, cold | plain `claude -p` (2.1.282) | follow-up message (same process) |
|------|------------------|-----------------------------|----------------------------------|
| spawn → initialize reply | 10-17 s | – | – |
| message sent → first text | 13-22 s | 14-27 s | 2.2-3.8 s |
| of which the model (duration_api_ms) | 1.9-2.6 s | 1.9-2.2 s | 2.2-3.4 s |

So the app adds no measurable overhead on top of the CLI: one long-lived stream-json process per chat already, a
stable prompt prefix (follow-ups read 38k cached tokens and write ~0), the first streamed token flushed at once (the
first item is never coalesced). A new chat's wait is the CLI's own start-up (engine debug log): reading settings and
the permission store (~2.5 s), commands/agents/skills (~1.2 s), CLAUDE.md/AGENTS.md (`agents-md prompt.context`,
~4 s), MCP configs and claude.ai connectors (~1.2 s, connections go on in the background; a stdio DevOps server takes
13 s but does not block the turn). Without any MCP server (`--strict-mcp-config` and `ENABLE_CLAUDEAI_MCP_SERVERS=0`)
the start-up is the same within noise: MCP is not the cost. Outside the app, measured and left to the owner: each
user hook is a `node` start of ~1-2 s on this PC (UserPromptSubmit runs two before every turn's API call, Stop two
after it).

## Decision
- **One warm engine** (`src/main/chats/warm.ts`). The manager keeps one Claude process started ahead, idle, in the
  folder of the last new Claude chat (at app start: the newest app Claude chat's folder, after 20 s; after each new
  chat: 5 s later, so it never competes with that chat's own start-up). The next new chat in that folder adopts it:
  the chat id, session id and per-chat MCP endpoint were chosen at its spawn; the chat's model, effort and permission
  mode go as control requests before the first message (the send waits for them), the title by `rename_session`.
  A refused control → that engine is closed and the chat starts cold on a new session id. Regie, the app's Regia,
  worktree chats, forks and `bypassPermissions` chats always start cold (their flags differ at spawn).
- An idle engine makes no model call: it spends no tokens. It is replaced after 30 min (settings and CLAUDE.md
  edits reach the next chat), killed at quit with the chats, and never restarted after it dies on its own (no loop).
  Cost: one idle `claude.exe` and the user's MCP servers it started.
- Off with the fake CLI (`SB_CLAUDE_PATH`, e2e) and with `SB_PREWARM=0`.
- **Timings in the logs** (scope chats): `timing: engine ready` (spawn → initialize reply) and `timing: turn` per
  sent message (first stream event, first text, result, the CLI's API time; for a process's first turn whether the
  engine was already up). `npm run logs -- --scope chats --grep timing`.

## Consequences
A new Claude chat in the usual folder answers in about the model's latency plus ~1 s of engine work, as on any
follow-up message. A chat in another folder still waits the CLI start-up once; the warm engine then moves there.
