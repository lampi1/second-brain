# ADR 0336: Per-task model presets (Minimo / Base / Massimo) on each role card

**Status:** Accepted (2026-11-22)

## Context

A role card had one model and effort (plus `tier` / `tierMax`, and the Balanced pick of ADR 0218 across engines). A
delegation could not say "this task is a light read" or "this one needs the strongest model" without the user editing the
card, and nothing recorded which model a task ran on and why, so the cost per kind of task could not be compared.

## Decision

1. **Three presets per role, one engine.** A card has `presets: { min?, max? }`, each `{ model, effort? }`, on the
   card's own engine (`src/shared/model-presets.ts`). **Base** is the card's own model and effort (else its tier's
   model). Minimo and Massimo absent = the same as Base, so every card saved before this ADR reads as Base only: no file
   migration. On save each preset must be a model the engine is known to have, and Minimo <= Base <= Massimo by price
   when the prices are known (`presetOrderProblem`). An engine change drops presets carried along unchanged. A version
   restore keeps today's presets (they change in place, like the model).
2. **Delegation picks one.** `app_create_chat`, `agent_delegate` (per task) and `agent_assign_task` take optional
   `preset: "min" | "base" | "max"`, `presetWhy` (one line, <= 200) and `taskKind` (short label, <= 60)
   (`PRESET_SCHEMA`, `presetAskOf`). The guards (`choosePreset`):
   - only the three presets; a fourth value is refused before any chat starts;
   - missing preset → Base;
   - a preset other than Base without `presetWhy` → Base and a warning;
   - **ceiling**: a preset is never priced above the delegator's own model (one price table, `harness/models.json`
     through `unitPriceOf`, input + output per Mtok, so across engines too); above it the highest preset that fits is
     used and the result says so; when none fits, Minimo; an unknown price is not capped and the warning says so;
   - the old `tier` argument is an alias: light / mid / top relative to the card's tier → min / base / max; `tier`
     and `preset` together are refused.
   No automatic escalation: a failed or reworked task never moves to a higher preset by itself.
3. **agent_assign_task switches a reused child** to its preset's model and effort (missing = Base) before the task,
   through the chat's own model switch, says so in the warnings, and goes back to the old model when the assignment
   fails. A child an older Balanced pick put on another engine keeps its model; an explicit preset there is refused.
4. **Balanced mode picks only among the role's presets** up to the one chosen (`presetsUpTo`), on the role's engine,
   from the chosen preset downward (one engine shares one pool, so ordering from Minimo would always pick Minimo). An
   agent's own Balanced pick must name one of those presets; another engine or a higher preset is refused.
5. **The user's pick** (ADR 0296 `userModel`) is any of the card's three presets on its engine; not held to the
   delegator's ceiling (the user asked). A model off the card or another engine is refused.
6. **Per-run record**: `AgentRun.presetChoice` = `{ preset, effort?, asked?, presetWhy?, taskKind?, delegatorRole? }`
   next to the run's `agentId` (role), `model`, `costUsd`, `outcome` and the `reviewOf` / `reworkOf` links (the
   Sentinel's PASS / FAIL and the rework count come from those). Stored in the runs' JSON (no schema change); a malformed
   one is dropped on read (`readRunPreset`).
7. **UI**: Impostazioni › Ruoli e deleghe › «Modelli per compito» (`RolePresets.tsx`): each work role's engine once,
   then the rows Minimo / Base / Massimo with a model and an effort, saved at once through `agents:save`.
   The same rows (`RolePresetRows`) sit in each role's own page, Agenti › a role › Configurazione (owner, 2026-11-23:
   «lo volevo settabile anche dalla card degli agenti»), with a toast «Annulla» after each save that puts the card's
   model, effort and presets back; the Orchestrator shows only Base (it is never delegated to). Both edit the same card
   fields, in place like every model change (ADR 0284): no new version. `agent_catalog` shows each role's three presets.

## Consequences

- Changes against earlier ADRs: the user's pick (0296) and the Balanced pick (0218) no longer move a role to another
  engine or to a model off its card; `tierMax` is no longer a limit on a delegation (the presets and the ceiling are);
  `agent_assign_task` without a preset brings a child back to Base.
- The card values (which models each role's presets name) are the user's: this change ships the mechanism only.
- Tests: `test/unit/agents/model-presets.test.ts` (each guard), `catalog-presets.test.ts` (migration, save, resolve),
  `delegation-presets.test.ts` (the tools), `runs-db.test.ts` (the record),
  `test/unit/role-presets-render.test.ts` (the UI), `test/unit/renderer/agent-card-presets.test.ts` (the role's page),
  `test/e2e/agent-card-presets.spec.ts` (the page's picture).
