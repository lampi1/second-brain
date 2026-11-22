# ADR 0332 · Antigravity (agy acp) joins the ACP engine catalog; its permissions go through the app's gates

Date: 2026-11-22 · Status: accepted (owner, via the Orchestrator 2026-11-22: «use agy acp (not Gemini CLI)»; «never
--dangerously-skip-permissions: permissions go through session/request_permission to the app's gates»;
«--disable-telemetry is fine»; «Code Mode only if MCP works») · Amends: ADR 0221 (catalog entries), ADR 0331 (which
engines get Code Mode)

## Context

Google's Antigravity CLI (`agy`, checked on 1.5.14) speaks ACP over stdio (`agy acp`), the same path the app already
uses for OpenCode and the catalog engines (`src/main/chats/acp.ts`). It differs from them in a few ways that matter:

- It has no `--model` flag: the model is a session config option (`configOptions` with category `model`). Its
  session/new also answers a `models` block, with one id per model and thinking level (`gemini-3.8-flash-high`,
  `…-low`); the picker has the bare models, the thinking level being the separate `thought_level` option.
- Its initialize announces no `mcpCapabilities`, yet it connects to the http MCP servers session/new passes, and names
  MCP tools `mcp_<server>_<tool>` (the server name kept as given, hyphens included) in `session/request_permission`'s
  `name`.
- Its modes are `default` (asks before edits and commands), `accept-edits`, `auto` and `plan`.
- Reasoning effort is `thought_level`, a config option that exists or not depending on the model.
- `session/load` replays the history, so a chat resumes after a restart.

## Decision

1. **A catalog entry, off and untrusted until «Attiva»** (`src/main/engines/acp-catalog/catalog.ts`): `agy acp
   --disable-telemetry`, login `agy acp --login`, with two new optional flags: `modelOption` (the model is the
   `configOptions` picker, not a CLI flag) and `mcpHttp` (the app's MCP endpoints go in as `type: "http"` servers).
   `readState` reads the model picker before `models`, so the menu lists the bare models and the effort stays
   `thought_level`. The app passes its MCP servers although initialize announces no http capability (`mcpHttp`).
2. **Never `--dangerously-skip-permissions`, never `auto` or `accept-edits`.** The session runs in `default`
   (`setPermissionMode` picks `agent`/`default`, and fails loudly if neither exists); every edit and command reaches the
   app as `session/request_permission` and goes through the same chain as any ACP chat (role gate, auto-permit, the
   user's rules in permissions.json, the permission panel).
3. **The app's own MCP tools pass without a panel** (`acpAppTool`, `src/main/chats/app-tool-approval.ts`): the
   `mcp_<server>_` spelling joins `<server>_` and `mcp__<server>__`, still bound to the app's own endpoint and the
   listed tools; a look-alike server still asks. `request_permission` reads the tool from `name` before `title`.
4. **No Code Mode on Antigravity for now** (`CODE_MODE_ENGINES` stays Claude and Cursor). Live, with Code Mode on, agy
   fetched and cached the `run_code` schema, but neither Gemini 3.8 Flash nor Claude Sonnet 4.6 running inside agy saw
   the tool: Sonnet answered that `mcp_second-brain_run_code` was not among its tools. Why agy drops it is still to be
   verified (its schema or description may be filtered). `acpAppTool` keeps a `codeMode` parameter so an ACP engine
   that does expose `run_code` only needs its line in `CODE_MODE_ENGINES`.

5. **Its folder as the long real path, and no read-only chats** (`realCwd`, `noReadOnly`). With the brain under
   `%TEMP%` behind an 8.3 short name (a `~1` segment) agy once wrote a file without asking
   `session/request_permission`; with a normal path it asked. The cause is not isolated, so: the engine starts and opens
   its session in `fs.realpathSync.native` of the chat folder (short names expanded; the path as given when it cannot be
   resolved), and `engines/sessions.ts` refuses an Antigravity session for a read-only run (a comparison side, the
   ceiling «plan», a role allowed neither edits, commands nor brain writes: by default Strategist, Router, Judge, Scout, Herald), whose
   only guard would be
   agy's own requests. Both stay until a live check on a short-name path explains the skip; balanced mode and
   delegation do not filter it yet, so such a pick fails at start with a message naming another engine.

## Consequences

- Live check (test profile, real agy 1.5.14, 2026-11-22): enabled through «Attiva» (source catalog, trusted); a chat
  ran on Gemini 3.8 Flash and another on a model picked from the menu; app MCP tools ran with no panel («acp app tool
  allowed» for `mcp_second-brain_list_chats`); an ordinary write was auto-allowed as for Claude; a write of the brain's
  permissions.json showed the panel and, denied, left the file unchanged; after an app restart the chat resumed with
  its history and ran a new turn.
- Known risk until the live 8.3 check (Decision 5): a write gate that depends on agy's own requests. Work chats keep the
  app's auto-permit and the user's rules, as on every ACP engine.
- An ACP engine's models are known only after its first `session/new`: a chat created with a model before that is
  refused, as for the other catalog engines.
