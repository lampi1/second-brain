# 0333: Claude chats keep WebFetch as a plain tool (built-in web-fetch agent off)

Status: accepted (2026-11-22)

## Context

The owner, 2026-11-22: «è fondamentale che l'app possa fare ricerche in internet senza dover aprire un browser». A Scout
chat could not read a web page. Claude Code 2.1.322 has a built-in `web-fetch` agent, turned on by the env
`CLAUDE_CODE_WEB_FETCH_AGENT` or a server flag. While it is on, and the session has the Agent tool, Claude Code drops
its own WebFetch tool from the session: pages can be read only by starting that agent. A role chat whose policy has every
tool class gets the Agent tool, and the role gate (`agents/role-gate.ts`, SubagentGate and gateRequest) refuses every
sub-agent outside its rules, `web-fetch` included. So a role chat had WebSearch but no way to read a page, with Code
Mode on or off.

A first fix let the role gate run `web-fetch` for chats with the web class. Review showed it cannot be made safe: a
custom agent takes the name by its frontmatter `name` (any YAML form, symlinked folders, a git worktree's main repo,
the managed policy folder), so the gate would have to copy Claude Code's whole agent loader to tell the built-in agent
from a custom one.

## Decision

Every Claude session the app runs gets `env.CLAUDE_CODE_WEB_FETCH_AGENT = "0"` in its inline `--settings`
(`chats/claude.ts` NATIVE_WEB_FETCH). It is merged last, so settings a chat brings cannot turn the agent back on.
Inline env wins over a folder's own settings env (as ADR 0031 measured). `mergeSettings` merges `env` maps key by
key, so the compaction window keeps its key next to it.

With the agent off, Claude Code keeps WebFetch as a plain tool (measured on 2.1.322: `system/init` lists WebFetch and
no `web-fetch` agent, both with the env var and with the inline setting). The chat's tool policy decides, as for every
other tool: the web class gives WebSearch and WebFetch, no web class gives neither. The role gate is unchanged and still
refuses a `web-fetch` sub-agent.

## Consequences

- Role chats with the web class search and read pages without the app browser, Code Mode on or off
  (`test/unit/chats/native-web-fetch.test.ts`).
- Plain chats lose the built-in agent's summarising fetch; they get WebFetch itself, as before Claude Code shipped the agent.
- If a later Claude Code drops the env var, WebFetch could disappear again. The test only pins the arguments, so a
  live `system/init` check is the way to see it.
