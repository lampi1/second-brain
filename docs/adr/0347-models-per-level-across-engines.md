# ADR 0347 · Several models per level across engines, picked by the room of each plan; one page per role, no permissions

Date: 2026-11-24 · Status: accepted (owner, 2026-11-24: «vorrei poter assegnare più modelli possibili per livello agente
tra minimo base e massimo … togli la balanced mode vorrei proprio che di default scegliesse il modello migliore … la UI
della modifica agente è terribile deve essere clean … non mi interessano le versioni … anche i permessi degli agenti
toglili voglio tutto concesso sempre … sul retro delle card non ha senso mostrare il modello»; «da qui voglio poter
accendere e spegnere in fretta i motori» on the ⚙ menu; picked proposal 1A, the page as one page); partly superseded by [ADR 0354](0354-engine-limits-follow-real-data.md) (point 3: the room of a model is the one credit rule) · Amends: ADR 0336
(a preset is the head of a list), ADR 0337 (the model lives on the role's page, not on the card back), ADR 0346 (the
card a waiting chat follows is the level's pick), ADR 0218 (Balanced mode stays retired: the pick by room is always
on) · Partly supersedes: ADR 0085 (the user no longer narrows a role; every role has every tool), ADR 0082 (no versions
on the role's page)

## Context

- A role card had one model per level, on the card's one engine. The owner pays several plans (Claude, Codex, Cursor,
  …) and wants the app to spread the work over them and to know when one is about to run out.
- The role's editor was a dialog of sections: versions, a permissions card with tool classes and a ceiling, presets,
  instructions. The owner found it unreadable; the permissions only made him answer questions.
- Engines could be turned on and off only in Impostazioni, which he never opens.

## Decision

- **Levels are lists** (`src/shared/model-levels.ts`, `AgentProfile.levels`): Minimo, Base and Massimo each keep an
  ordered list of up to 8 `{ engine, model, effort? }`, from any engine. The order is the user's: the first is the best
  for the role. A card without lists reads as before (one model per level on its engine, `cardPresets`): no migration.
  The head of Base is the card's own `engine` / `model` / `effort`, and the heads on the card's engine are its
  `presets`, so every reader of the card's model (maps, app_config, strips, a delegation's price ceiling) still works.
  A save checks each model against its engine's list, as for the card's model.
- **The pick** (`pickInLevel`, `catalog.resolve`): the first model of the level whose engine is on, trusted and may be
  opened by agents, and whose plan has room; else the first on pace; else the first usable (it starts, hits its limit
  and waits, ADR 0346). Room comes from the usage panel (ADR 0334) and the credit book's exhausted pools (`roomOf`):
  spent at 98% of a window or after a limit hit until it renews; on pace when a window used at least half would, at the
  pace since it opened, end before it renews. Model-scoped and spend windows do not stop a plan. The reason is on the
  run's `presetChoice.route` and on the role's page («Ora userebbe … · saltato …», `agents:levelRoute`).
- **The user's own pick** (ADR 0296) is any model of the role's levels, on its own engine; another model is refused.
- **A delegation** starts on the engine of the model the level picks; `assignChild` accepts any engine of the role's
  levels.
- **No permissions**: every role has every tool class and no ceiling, on load and on every save; a chat of a role gets
  no policy. The API engine, which has no tools, stays read-only. The rules of the brain and the app's own guards are
  unchanged.
- **One page per role** (`AgentStudio.tsx`): a header with the numbers, «Modelli per livello» (`RoleLevels.tsx`:
  draggable chips, «+ Aggiungi», what each level starts on now), the instructions saved as you type, skills, options
  (Code Mode, context, who it may launch) and results per model. Each change saves at once. No versions, no
  permissions, no editor dialog.
- **The card back** shows the role's engines as marks, not a model.
- **Engine switches in the ⚙ menu** (`TopBar.tsx`): each engine row has a switch; off sets `engineOn[h] = false`, on
  sets it and `engines[h]` true. An engine that is off is never picked.

## Consequences

- A chat out of credits (ADR 0346) follows the level's pick: when its plan is spent the pick moves to the next model
  with room. Moving it on its own, with a short notice and a way to cancel, is the next step (proposal 3A).
- Room is only as good as the usage reading: an engine with no reading (Cursor Enterprise, OpenCode providers) counts
  as unknown and is taken like one with room.
- Old versions stay on disk; the page no longer shows or restores them.
