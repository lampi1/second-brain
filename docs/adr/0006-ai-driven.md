# ADR 0006 · The app is AI-driven: self-test, logs, doctor, and an app-control MCP

Date: 2026-10-11 · Status: accepted

## Context
The user: "rendila AI driven e l'IA deve sapere perfettamente come testarla da sola vedere i log ecc ecc perchè dovrà
usarla al meglio". Future agents must become productive from AGENTS.md alone and verify their own work.

## Decision
- **One command to verify**: `npm run check` (typecheck, lint, unit, e2e that launches the real app, drives it and
  compares screenshots against committed baselines in a deterministic demo mode `SB_DEMO=1 SB_DEMO_FREEZE=1`).
- **Doctor**: `npm run doctor [-- --json]` checks build, Electron, Claude CLI + login (`claude auth status`), Cursor
  CLI (version only), brain folder, MCP port, today's errors; each failure has a next step.
- **Structured logs**: JSON lines in `%APPDATA%/second-brain/logs/app-YYYY-MM-DD.jsonl`, levels, scope, chat id,
  secrets redacted, 14-day retention; errors carry `cause` and `hint`. Reader: `npm run logs -- --level warn --since 1h`.
- **App-control MCP** at `/mcp/app` (`src/main/appctl/tools.ts`): state, chats, items, pending, feed, logs,
  screenshots (UI + every visible browser tab), UI steering, labelled messages to chats.
- **Hard limits of app control**: it never answers a question or permission (only the user's click is their ok); every
  message it sends is labelled as an agent's; same network protections as the browser MCP.

## Consequences
- Agents can test end-to-end without a human, and debug from logs instead of guessing.
- Header comments on every module (what, why, who uses it) are part of the definition of done.
