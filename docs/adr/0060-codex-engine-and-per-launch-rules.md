# ADR 0060 · Codex as a third chat engine, and the brain's rules loaded per launch

Date: 2026-10-16 · Status: accepted (owner, panel 16/10) · Source: the owner's request (16/10: work on this app from a personal PC "anche
con codex cli", "crea anche l'adattatore") · Builds on: ADR 0010/0011 (engines), ADR 0046 (keys), ADR 0055 (CLI
contracts), ADR 0059 (brain domains)

## Context
Chats run on two harnesses: Claude (`stream-json`, `src/main/chats/claude.ts`) and Cursor (ACP, `acp.ts`). Both
implement `HarnessSession` (`session.ts`). The user's rules reach the CLIs today through user-level config
(`~/.claude/skills`, agents, output styles, hooks) that the user installed by hand; the app must never change that
config (repo rule 6). On a new PC, and for a new engine, the rules must arrive without it.

Docs read on 16/10 (no CLI run, no tokens): developers.openai.com/codex/app-server, /codex/local-config,
/codex/skills, /codex/cli/reference; code.claude.com/docs/en/cli-reference, /plugins.

## Decision
- **Codex runs through `codex app-server` over stdio** (JSON-RPC 2.0, one long-lived process per chat), in a new
  `src/main/chats/codex.ts` implementing `HarnessSession`:
  - start/resume = `thread/start` / `thread/resume`, send = `turn/start`, mid-turn message = `turn/steer`,
    stop = `turn/interrupt`;
  - items (`agentMessage`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `plan`) map onto the
    contract's chat items, deltas stream;
  - `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` become permission panels; the
    answer goes back as accept / decline / cancel.
  - Rejected: `codex exec --json` (one-shot, no approval round-trip), `codex mcp-server` (removed upstream), the ACP
    wrapper `codex-acp` (now a layer over app-server: one more process for nothing).
- **Login is Codex's own** (rule 4): the app never copies `auth.json`; it uses the user's `CODEX_HOME` as it is. An
  API key typed in Settings → Motori goes only to that process's env (`CODEX_API_KEY`, ADR 0046).
  Owner, 16/10: login is only the user's own `codex login`; the app never calls `account/login/start`, and Codex
  reporting no account shows the login help, key or not.
- **Per-launch config, never the user's files**:
  - Codex: model, approval policy, sandbox and the app's MCP server as `-c key=value` overrides at spawn; the brain's
    instructions through the project's `AGENTS.md` and skills in the repo's `.agents/skills` (same `SKILL.md`
    shape as Claude's; Codex-only fields checked per skill).
  - Claude: the brain's skills, agents, hooks and output styles packed as a plugin folder that the app generates in
    userData from the brain's domains and passes with `--plugin-dir`; extra rules with `--append-system-prompt-file`.
    The user's `~/.claude` stays as it is; once the plugin covers it, the user may empty it by hand.
- **One source, adapters per CLI**: the domains hold the rules once (Markdown + `SKILL.md`); a small generator per
  engine (`src/main/brain/adapters/`) turns them into what each CLI loads. Cursor keeps its existing snapshot
  (`CURSOR_CONFIG_DIR`).
- **Contract checks** (ADR 0055): recorded app-server sessions in `test/fixtures/cli/codex`, replayed without tokens;
  unknown events go to the `drift` log scope.

## Consequences
- Not verified yet, to check on the first real run (owner's ok, cheap model, one run): app-server parity on native
  Windows; whether Codex reads a global `AGENTS.md` in `CODEX_HOME`; the exact config key for extra instructions.
- An agent working on this repo inside Claude Code never runs the Codex CLI (rule 4, as for Cursor): live tests are
  run by the owner (`SB_LIVE=1`).
- Work: `codex.ts` + registry entry + engine detection in `npm run doctor`, the adapters, fixtures, unit tests, an
  e2e with a fake app-server, a new runtime dependency: none (JSON-RPC over stdio is written here, as for ACP).
