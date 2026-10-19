# ADR 0086 · MCP servers managed by the app, given to every engine through a local gateway

Date: 2026-10-19 · Status: accepted (owner, issue #91 and its comment; owner, 2026-10-19 evening: "by default every
role has every permission, including all MCP servers; the user narrows per agent from the agent card") · Builds on:
the local MCP server (ADR 0006), per-Orchestrator mounts and endpoint tokens (ADR 0021), engine API keys with
safeStorage (ADR 0046), the agent tool policy, Settings → Connettori (account connectors). Extends AGENTS.md rule 2.

## Context
Each engine keeps its own MCP configuration (Claude's `~/.claude.json`, Cursor's `~/.cursor/mcp.json`, Codex's
`~/.codex/config.toml`): the user adds the same Azure DevOps or GitHub server three times, with three copies of its
token in plain files, and the app cannot say which agent may use which server or whether a server works. The app must
never write those files (rule 6) and must never put a token in a file or a log (rule 2).

## Decision
1. **The app keeps its own list of MCP servers** (`main/mcp-servers/store.ts`, `userData/mcp-servers.json`):
   id, name, purpose, transport (`stdio`: command, args, env; `http`: Streamable HTTP URL, headers), on/off, where it
   was imported from, the last test. Definitions are validated strictly. A value that looks like a secret (by name, in
   plain env, headers or the URL's query) is refused: it must go in a token slot.
2. **Tokens are write-only.** Each server declares token slots (an env variable or a header, with an optional prefix
   such as `Bearer `). Values are encrypted with safeStorage in `userData/mcp-secrets.json`. Each value is bound to a
   fingerprint of the server (transport + command, or URL origin, + slot), so a definition later pointed at another
   host never receives the old token. The UI gets only a mask (`ghp_…9f2c`). Values join the log redaction list. No
   IPC channel, MCP tool or agent can read one back.
3. **One gateway for every engine** (`main/mcp-servers/gateway.ts`). The servers reach a chat only through the app's
   own MCP server, at `http://127.0.0.1:<port>/mcp/ext/<chatId>/<server>/<token>`, with a per-chat endpoint token (ADR
   0021) and the existing Host/Origin checks. Main opens the real server (spawns the stdio process with the tokens in
   its env, or calls the URL with the tokens in its headers) and relays `tools/list` and `tools/call`. Main keeps one
   pooled connection per chat and server, closed after 10 idle minutes. Why a gateway rather than handing each engine
   the real config:
   - the token never leaves main: no engine config, command line or env carries it;
   - per-role access is enforced the same way on all three engines, and re-checked live at every call (a change on the
     agent card applies to running chats without a restart);
   - each engine gets only a loopback URL, in the form it already supports:
     - Claude: one more entry in its `--mcp-config` JSON;
     - Cursor: one more `{type:'http', name, url, headers: []}` in ACP `session/new` `mcpServers` (not when the chat
       is read-only);
     - Codex: `-c mcp_servers.<id>.url=<url>` and `-c mcp_servers.<id>.default_tools_approval_mode="prompt"`.
4. **Access per role, open by default.** By default every role may use every server and every tool (owner, 2026-10-19).
   The agent card's MCP section narrows each server: all, read only, chosen tools, or none.
   - The choice lives in `mcp-servers.json` (`access[role].servers[id]`), not in `roles.json`, so the per-agent
     permissions editor and this feature do not edit the same file.
   - A tool counts as read only when the server marks it with `annotations.readOnlyHint`. An unmarked tool counts as a
     write.
   - A chat's access is the intersection along its chain (its own catalog role, then each parent's role), so a worker
     never gets more than the Orchestrator chat that started it.
   - The role's tool policy still applies: without the `mcp` class no managed server is given, and a named `tools.mcp`
     list keeps only those ids.
   - A managed server a Claude chat may not use is also passed as `--disallowedTools mcp__<id>`, so a same-named server
     from the user's own Claude config cannot stand in for it. Damaged access entries narrow to none.
5. **Import is read only.** "Importa da Claude e Cursor" reads `~/.claude.json` (user and project servers), Claude
   desktop's `claude_desktop_config.json`, `~/.cursor/mcp.json` and the `[mcp_servers.*]` tables of
   `~/.codex/config.toml`. The files are never changed. Secrets are never copied: a secret-looking env, header or
   argument becomes an empty token slot, and the preview lists what was dropped. The user picks the servers to add.
6. **"Prova" tests a server as a chat would**: it opens the server with its tokens, lists its tools (read / write) and
   records the result with an Italian error and its fix. Error codes: auth, not found, timeout, spawn, protocol, missing
   token, invalid. The client (`main/mcp-servers/client.ts`) is written by hand, with no new dependency:
   - Streamable HTTP (JSON or SSE answers, `Mcp-Session-Id`, `MCP-Protocol-Version`);
   - stdio with newline-delimited JSON-RPC (a `.mjs` runs under Electron's Node; a Windows `.cmd` runs through
     `cmd.exe` with plain arguments only).
7. **Settings → Connettori is one section.** It holds the account connectors (Azure DevOps, GitHub, Jira) and the MCP
   servers as cards in a grid. Each card shows what the server is, its state, what it is used for, its tools, its roles
   and its last test, with one "Prova", the error and its fix, and "?" help tips. Totals sit on top. The demo seeds
   four made-up servers with a fake upstream: no process, no network.
8. **Rule 2 extended**: tokens of app-managed MCP servers are typed in Settings → Connettori, encrypted with
   safeStorage, write-only from the UI, given only to that server's own process env or HTTP header by main.

## Consequences
- **Codex unverified.** The Codex overrides could not be checked against a live CLI here (none is installed in the
  build container). They reuse the `-c mcp_servers.*` keys already verified on CLI 0.163.0-alpha.10.2
  (`brain/adapters/codex.ts`). The first live Codex chat should confirm the managed servers appear.
- **Not supported yet:**
  - servers that need an OAuth sign-in (the gateway has no browser flow; such a server answers 401 and "Prova" says
    so);
  - legacy SSE-only servers (only Streamable HTTP and stdio).
- stdio servers start in the user's home folder.
- MCP access per role is not versioned with the role history (it lives outside `roles.json`).
- The user's own servers in the engines' configs keep working as before. A Claude chat without the `mcp` class still
  runs with `--strict-mcp-config` (only the app's servers).
- Tests: `test/unit/mcp-servers/*` (store, client against `test/fixtures/fake-mcp-stdio.mjs`, gateway access, import,
  engine launch arguments, UI readings) and `test/e2e/connectors-hub.spec.ts` (dark and light shots).
