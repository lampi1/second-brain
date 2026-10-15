# ADR 0055 · CLI contracts: format drift reported, real streams recorded, versions checked

Date: 2026-10-15 · Status: accepted · Builds on: ADR 0002 (Claude stream-json), ADR 0010 (embedded engine, ACP),
ADR 0046 (one ACP adapter for every engine)

## Context
The app reads other programs' output: Claude Code's stream-json (`chats/claude.ts`) and the JSON-RPC of every ACP CLI
(`chats/acp.ts`: Cursor, Kimi…). Every test used hand-written fakes (`fake-claude.mjs`, `fake-cursor-acp.mjs`); the
doctor only checked that `--version` answers. A CLI update that adds an event, renames a field or adds a state fell
to a `default: return` and the chat silently showed less (the 2026-10-15 audit: `claude.ts` bad lines, `acp.ts`
shapes pinned in a comment, a task status the app does not know keeping a chat open for ever). Claude's engine is
pinned by `package.json` (the embedded binary): it changes when we bump it. Cursor and Kimi update themselves.

## Decision
- **Drift is reported, once** (`chats/drift.ts`): each parser branch that meets something unknown (message type,
  system subtype, stream event or delta, content block, session state, task status, a successful result without cost
  or usage, an init without a session id; ACP: session update, notification, agent request, tool kind, stop reason,
  protocol version) calls `drift(cli, version, kind, what, sample)`. One warn per CLI, version and shape per process,
  scope `drift`, with the sanitized sample and the next step. What the app knowingly ignores is listed (`QUIET_*`), so
  a warn means news. The version is what the CLI says (Claude: `claude_code_version`; Cursor: its version folder, the
  same name doctor reads; other ACP engines: `agentInfo.version`).
- **Real streams recorded, sanitized** (`drift.ts` record): the dev instance (no release id, not under tests, never a
  `.mjs` fake) keeps up to 3 samples of every message shape per CLI and version in `<userData>/cli-records/<cli>.jsonl`.
  Every string becomes `s:<length>` except protocol words under known keys (type, subtype, kind, status…, ≤ 64
  chars, no spaces or slashes) and Claude Code's built-in tool names under `name`/`tool_name` (MCP servers, project
  commands and output styles are the user's words): no prompt, answer, path, id or project name leaves the message. `node scripts/cli-fixtures.mjs`
  merges them into `test/fixtures/cli/<cli>/<version>.jsonl`.
- **Contract test without tokens** (`test/unit/chats/cli-contract.test.ts`): every fixture replays through the real
  parsers with no drift and no "not understood" error; synthetic cases prove each drift branch fires and each quiet
  one does not.
- **Doctor**: `claude-tested` (the embedded engine's version) and `cursor-tested` (its newest version folder, no
  process started) are warnings when no fixture covers that version; `cli-drift` counts today's drift warnings.
- **Live smoke only on a new version, only with the owner's ok**: `test/live/claude.live.test.ts` records its turns,
  must raise no drift and writes the Claude fixture. Never Cursor from an agent (AGENTS.md rule 4): its fixtures come
  from the owner's dev chats.
- **No ACP for Claude.** Its ACP is an external adapter package over the Agent SDK: one more dependency, and the
  permission prompts, compaction window and control requests the app uses would be lost. ACP stays the common
  protocol for every other engine (one adapter already).

## Consequences
- A CLI update shows up the first time it is used (`npm run logs -- --scope drift`, `npm run doctor`), not when a
  user notices a missing row. Fixing it = handle or list the new shape, re-record, replay.
- Until the dev instance has seen real chats, the replay has no fixtures (the test says so); doctor warns.
- Not covered: the compaction window precedence (`compactSettings`, measured by hand) and the warm engine
  (`warm.ts`): both are Claude-only, and the embedded engine changes only with an app update, which restarts both.
