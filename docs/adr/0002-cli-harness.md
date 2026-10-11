# ADR 0002 · Chats run through the official CLIs, spoken to directly (no SDK runtime dependency)

Date: 2026-10-11 · Status: accepted

## Context
The user wants to keep Claude desktop and Cursor closed and log in "nelle loro cli". Claude Code's Agent SDK
(`@anthropic-ai/claude-agent-sdk` 0.3.296) drives the CLI with `-p --input-format stream-json --output-format
stream-json --permission-prompt-tool stdio` and a control protocol (`control_request` / `control_response`:
`initialize`, `can_use_tool`, `interrupt`, `set_model`, `set_permission_mode`, `apply_flag_settings`,
`get_context_usage`, `rename_session`…). The SDK package bundles its own ~290 MB CLI binary, is proprietary-licensed,
and pulls `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` and `zod` as peers. Cursor's CLI offers `agent acp`
(Agent Client Protocol over stdio: `session/new`, `session/prompt`, `session/request_permission`,
`cursor/ask_question`, `session/cancel`).

## Decision
- Spawn the user's installed `claude` (resolved on PATH, no shell) and speak the same stream-json control protocol
  the SDK speaks, in `src/main/chats/claude.ts`. Proven live on 2026-10-11 (AskUserQuestion answered by the host,
  Write executed, cost 0.26 $ reported).
- Spawn `agent acp` for Cursor chats, in `src/main/chats/cursor.ts`.
- ~~Pass `--permission-mode` explicitly~~ (superseded 2026-10-11): `--permission-mode` is passed only when the user
  chose a mode for that chat; with no choice ("Come da impostazioni") the CLI applies `defaultMode` from the user's
  `settings.json` (e.g. `auto`), and the mode shown is the one the CLI reports at `system/init`. A forced `default`
  overrode the user's settings and made every command ask ("perchè tutti questi comandi mi proponi non va in automode?").

## Consequences
- Same version, login, settings, hooks, skills, agents, CLAUDE.md and output style as the user's terminal; zero
  runtime dependencies. Risk: protocol drift on CLI updates → a protocol test in `test/live` and a startup check of
  `claude --version`; the SDK's `sdk.d.ts` is the reference when fields change.
- A desktop session is never resumed in place while open there (two writers on one transcript): the app forks it.
