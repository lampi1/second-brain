# ADR 0351 · Antigravity keeps agent_report small; a child that answered without it goes up as partial

Date: 2026-11-24 · Status: accepted (issue #463, filed from the app; owner, 2026-11-24: «falla») · Amends: ADR 0332
(mcpCompact), the delegation's report rule (#152)

## Context

- Four delegated Antigravity chats (agy 1.5.16) did not see `agent_report` among their tools, although agy cached its
  schema; one was closed as blocked, 0 of 4 criteria, though it had answered. agy drops the largest tools first when
  the eager MCP schema budget is over (ADR 0332), and `agent_report` was the second largest tool of the chat endpoint
  (≈2.6 KB compacted, after `agent_delegate`, which non-delegating roles never see).
- All four ran in a worktree directly under the user's home; why that matters is not proven, and the tool list the
  engine was offered was not logged.

## Decision

- **Core tools compacted harder** (`compactMcpTool`): `agent_report` and `agent_ask_parent` keep every field, type,
  enum and required entry, with property descriptions cut to 40 characters (80 for the other tools), so they are not
  the first ones agy drops.
- **One log line per compact chat** (`compact chat tools listed`, browser/service.ts): number of tools, bytes, the five
  largest, and whether `agent_report` was offered, so the next case says what the engine got.
- **An answered child is partial, not blocked**: a delegated chat that ends its turns twice with an answer and no
  `agent_report` goes to its parent as `partial` (criteria unverified, its last message as output); a chat with no
  answer, or whose engine died, stays `blocked`. The reminder names Antigravity's spelling `mcp_second-brain_agent_report`.

## Consequences

- The cause of the home-folder correlation is still open: the new log line is the evidence to read next time.
