# ADR 0092 · Cursor takes an effort; the tiles show the effort in use

Date: 2026-10-20 · Status: accepted (issues #97, #100) · Builds on: ADR 0046 (engines and caps), ADR 0083 (roles)

## Context
A Cursor chat (ACP) refused any effort: `caps.effort` was false for every ACP engine and `AcpSession.setEffort` threw,
so `app_set_chat_effort`, the chat menu and the role editor's Approfondimento could not set one. Yet the session already
changed the model's reasoning with `session/set_config_option` on the parameter of category `thought_level`, from the
setting `orchestratorChats.cursorReasoning` alone. Separately, the tiles and the delegation card showed only the model:
the effort a chat really ran with was visible nowhere.

## Decision
- **ACP engines take an effort** (`ACP_CAPS.effort = true`; the HTTP engines stay without). The chat's (or its role's)
  effort is the `thought_level` value: at start it wins over `cursorReasoning` (a parameter pinned in the model id in
  brackets still wins over both), mid-chat `setEffort` sends it at once. The app's level is mapped onto the values the
  parameter offers (the same value, else the nearest step, lower first: `max` → `xhigh`). Only an effort named for
  Cursor (the role, the chat, a table row) is sent: the user's default effort (`orchestratorChats.claudeEffort`) is
  Claude's, so the routing defaults never give it to a Cursor chat, which keeps `cursorReasoning`. A model with no such
  parameter refuses in Italian, and the chat keeps the effort it had.
- **The effective effort is the engine's own report** (`effortObserved` → `effortStatus.effective`): Claude's init,
  an ACP model's `thought_level` value. The label beside the model (`renderer/lib/format.ts` `modelWithEffort`, used by
  the chat tile, the Orchestrator tile and the delegation card) shows it, else the value the app last sent with a turn
  (`submitted`, what that turn runs with), else nothing: never an effort only asked for. A turn sent without a
  per-turn effort (Claude reports its effort only at init) keeps the last report; a different submitted value makes
  it unknown until the engine reports again.

## Consequences
- The routing table can name an effort for a Cursor model where `models.json` lists it for that model.
- A one-shot job on Cursor (Battito) now runs with its role's effort (`low` by default), as on Claude.
