# ADR 0009 · Settings as data with agent proposals; calm toasts; spending limits that never stop; honest estimates

Date: 2026-10-11 · Status: accepted (brain module, `src/main/brain/`)

## Context
The user: agents should change settings for them "in modo che io non me ne accorga nemmeno, fare modifiche deve essere
molto figo vederle live"; a spending limit they can switch off, per day and per chat, Claude and Cursor apart; an honest
cost/time estimate per job that becomes accurate with use. Calm UI: few, useful notifications.

## Decision
- **Settings are data** (`settings-schema.ts`): one dot key each (type, default, Italian label and description,
  `protected`). One pure `validate(key, value)` for the UI, agents and the saved file. Every change is logged in
  `userData/changes.jsonl` (who: `user` | `agent`, chat id; older logs that name the user differently are read as `user`), applied live (`settings:changed`), undoable.
  **Protected keys** (engines, spending limits, notifications off, brain folder, MCP port) can only be *proposed* by
  an agent (`settings:proposed`); the user accepts with a click (`settings:confirm`). The brain folder is protected
  because the app runs that folder's Node tools.
- **Toasts**: only urgent kinds by default, only when the window is not focused, grouped, max one per 20 s except
  urgent, replaced not stacked, per-kind mute and do-not-disturb. Unpackaged Windows builds may drop toasts silently
  (no Start Menu shortcut with the AppUserModelId): in-app feed is always the source of truth.
- **Spending limits report, never act**: `evaluateBudget()` is pure; 80 % and 100 % are reported once
  (`budget:alert` + feed). Mode `ask` lets the chat manager ask "stop or continue?"; nothing is ever interrupted
  halfway by this module. Claude $ = list price from the brain's `cost.mjs` (an equivalent cost on a subscription);
  Cursor $ only from its usage export, otherwise unknown (no alert, never a guess). Plan windows (5 h / 7 d) only
  when a running Claude chat reports them (`rate_limit_event`, `get_usage`) or Claude Code's 1-hour cache has them.
- **Estimates**: kind from the first prompt (keywords), p25-p75 of similar past jobs (same kind/harness/model/effort,
  then wider, labelled "stima grezza"), null under 5 cases. Ledger in `userData/jobs.jsonl` behind a pluggable store,
  backfilled from `cost.mjs` per-chat data. Prompts are never stored, only their length.
- **Brain data**: the brain's own `makeServer` runs in an Electron-node child; the main process proxies GET on an
  allow-list of read-only `/api/` paths (`brain:api`); never `/api/send`.

## Consequences
- The UI can draw settings, history and proposals from the schema without hard-coding labels.
- Estimates start coarse (per-chat spans from transcripts) and sharpen as app jobs are recorded with model and effort.
- A brain-side ledger (`<brain>/measures/jobs.jsonl` via a brain CLI) can replace the default store later.
