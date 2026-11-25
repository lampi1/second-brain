# ADR 0337: Model choice and Code Mode live on the role card; Settings has none

**Status:** Accepted (2026-11-23). Amended by ADR 0347 (the models live on the role's page as lists per level; the card back shows engines).

## Context

The model a chat ran on could be set in four places: a role card (ADR 0336 presets), Impostazioni's preset picker and
per-tier table (`modelTiers.*`), «Balanced mode» (ADR 0218, a credit-weighted pick across engines) and «Chat aperte
dall'Orchestrator» (`orchestratorChats.claudeModel/cursorModel/claudeEffort/cursorReasoning/cursorFast`). Code Mode
(ADR 0331) was one global switch for every role. The owner, 2026-11-23: the preset is chosen «solo ed esclusivamente
dalle card degli agenti oppure che lo setti l'orchestrator, non dalle impostazioni»; Code Mode per role on every engine;
redundant settings and dead code deleted with a one-off migration; Artisans run well on mid/low models.

## Decision

- Impostazioni has no model, preset, tier, Balanced or Code Mode control. Deleted: `RolePresets` in Settings, Balanced
  mode (`balanced-mode.ts`'s choice, the `balanced` delegation param, `balanced_status`), the tier table and the
  `tier` / `presetOfTier` aliases on delegation tools (a `tier` argument is refused with the way to `preset`). The card's
  internal `tier` stays only as the brain registry's fallback model for a card with none; the credit book stays as
  cost data.
- The Orchestrator's model, effort and Cursor fast are its role card's (`orchestratorChats` keeps only `harness`).
- Code Mode and Cursor's fast are role card fields (`AgentProfile.codeMode` / `fast`, in `BEHAVIOUR_FIELDS`, the
  catalog's versions, `app_config` area `agent`, `agent_catalog`); `codeModeFor` reads the chat's role, never the
  Orchestrator. Levels per engine (`codeModeLevel`): Claude full (natives hidden, run_code loaded); Cursor,
  Antigravity, OpenCode (ACP) and Codex partial (a first-turn hint names run_code and the app refuses the native tools
  it is asked to approve; what the engine approves on its own still runs); the API engine none. The card says
  «parziale» when the level is not full.
- One guide for choosing a preset, the owner's approved text, verbatim: `src/shared/model-choice-guide.ts`, in the
  Orchestrator's and the Strategist's role frame and served by `app_guide` topic «model choice». Tool descriptions
  point to it in one line.
- One-off migration (`agents/legacy-cards.ts`): config.json's old keys are captured to
  `userData/legacy-model-settings.json` and dropped; at the next start a card with no model gets the model its tier
  resolved to that day, the old global Code Mode goes to every work role, the Orchestrator's settings go to its card;
  a marker file keeps it from running twice.

## Consequences

- Amends ADR 0336 (no Settings picker; `userModel` must be one of the card's presets), ADR 0331 (per role, not a
  setting) and retires ADR 0218's choice logic (its cost data stays).
- A chat with no role (a user's plain chat) no longer runs in Code Mode.
- ~~An old Balanced child on another engine than its role's is not reused: `agent_assign_task` asks for a fresh chat.~~
  Replaced by [ADR 0352](0352-any-engine-reaches-any-engine.md): it is reused on its own engine and model.
- Tests: `test/unit/agents/legacy-cards.test.ts` (migration), `test/unit/shared/model-choice-guide.test.ts` (the guide
  reaches who chooses), `test/unit/code-mode/*` (per role, per engine), `test/unit/renderer/agent-card-presets.test.ts`
  (the card).
