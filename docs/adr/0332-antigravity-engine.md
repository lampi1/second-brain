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
4. **Code Mode on Antigravity** (originally off: live on 2026-11-22 with Gemini 3.8 Flash and Claude Sonnet 4.6 inside
   agy, agy fetched and cached the `run_code` schema but those models did not report seeing `mcp_second-brain_run_code`).
   Amended 2026-11-22 (owner: extend Code Mode to Antigravity chats like Cursor, for Sentinel chats on Gemini 4 Neon):
   `codeModeFor` (`src/main/code-mode/policy.ts`) now includes `'antigravity'`. When `codeMode` is on (never for the
   Orchestrator or maintenance research), `run_code` is exposed on the chat endpoint, auto-allowed by `acpAppTool`, and
   the first turn includes `CODE_MODE_HINT` (`src/main/chats/acp.ts`) while native tools stay visible; when `codeMode` is
   off, `run_code` is not exposed and no hint is sent.

5. **Its folder as the long real path, and no read-only chats** (`realCwd`, `noReadOnly`). With the brain under
   `%TEMP%` behind an 8.3 short name (a `~1` segment) agy once wrote a file without asking
   `session/request_permission`; with a normal path it asked. The cause is not isolated. The mitigation for that write,
   until a live check on a short-name path explains it, is `realCwd`: the engine starts and opens its session in
   `fs.realpathSync.native` of the chat folder (short names expanded; the path as given when it cannot be resolved).
   On top of it, `engines/sessions.ts` (`readOnlyRun`) refuses an Antigravity session only for a run whose sole guard
   would be agy's own requests: the comparison's side b (`readOnly`), the ceiling «plan», and a role the user restricted
   on its card to none of edits, commands and brain writes. There is no filter by role id: with ADR 0085's defaults every
   role has every permission, so no default role is refused. Balanced mode and delegation do not filter these runs yet:
   such a pick fails at start, its message saying the chat is read-only and to use another engine.

## Consequences

- Live check (test profile, real agy 1.5.14, 2026-11-22): enabled through «Attiva» (source catalog, trusted); a chat
  ran on Gemini 3.8 Flash and another on a model picked from the menu; app MCP tools ran with no panel («acp app tool
  allowed» for `mcp_second-brain_list_chats`); an ordinary write was auto-allowed as for Claude; a write of the brain's
  permissions.json showed the panel and, denied, left the file unchanged; after an app restart the chat resumed with
  its history and ran a new turn.
- Known risk until the live 8.3 check (Decision 5): a write gate that depends on agy's own requests. Work chats keep the
  app's auto-permit and the user's rules, as on every ACP engine.
- An ACP engine's models are known only after its first `session/new`: a chat created with a model before that is
  refused, as for the other catalog engines. Amended 2026-11-22 (owner: «fix it directly»): that left Antigravity with
  no first chat, because the Orchestrator can open one only with a listed model. Antigravity's list now comes from
  `agy models` (`modelsArgs`, engines/model-lists.ts `textModels`), which opens no session and spends no token; the
  executable runs with no shell (a `.cmd` shim is refused: cmd.exe spawns from the app fail intermittently). Its
  `id<TAB>name` lines carry the thinking level in the id (`gemini-4-neon-high`), so they fold into the bare model
  with its efforts, the ids the session's model picker sets; `userModel` takes the suffixed id too, as that bare
  model with that effort (agents/discovery.ts `userModelOf`). The list refreshes with the others (about two minutes
  after the start, then every six hours, or «Aggiorna elenco»).
