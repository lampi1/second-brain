# ADR 0350 · The Orchestrator sets a role's model lists per level; its own card has an ordered Base list

Date: 2026-11-24 · Status: accepted (issue #468, filed from the app; owner, 2026-11-24: «fai subito anche l'ultima
richiesta aperta dell'app») · Amends: ADR 0347 (levels are lists), ADR 0336 (app_config presets)

## Context

- ADR 0347 made each level (Minimo, Base, Massimo) an ordered list of models from any engine, editable only on the
  role's page. Through `app_config` the Orchestrator could set only `presets`, models of the role's one engine, so a
  level with a Claude and a Cursor model had to be built by hand, one «+ Aggiungi» at a time.
- The Orchestrator's own page showed one model and one effort at Base, no list.
- The issue's addendum: the effort of OpenCode GPT models was not visible as a list (the model catalog had none for them).

## Decision

- **`app_config`, area `agent`, key `levels`**: `{ min?, base?, max? }`, each an ordered list of `{ engine, model | null,
  effort? }`. Checked like the page (`checkedLevels`: at most 8, no engine + model twice) and by the card's save (each
  model known to its engine; an effort the model is known not to take is refused). A level left out keeps its list;
  `[]` sends Minimo or Massimo back to following Base. `get` returns each role's three lists. The change is in place
  (version unchanged, logged with the Orchestrator's reason) and posts a feed card «Ruolo aggiornato» with **Annulla**
  (`FeedAction` `levels-undo`: the stored lists back through `agents:save`, refused when the card changed since). The
  tool answer's `undo.value` sets the old lists back too.
- **The Orchestrator has Base only**: it runs on its chat's engine and is never launched at a level. Its page shows the
  same draggable list (no «ora userebbe» line); its chat starts on the first model of the list on that engine
  (`catalog.resolve`), else the card's model as before. `levels` with `min` or `max` for it is refused with that reason.
- **Provider-prefixed model ids** (`openai/gpt-…` in OpenCode, OpenRouter) read the registry's bare row
  (`modelRow`): their efforts and price come from `harness/models.json` like any other model.

## Consequences

- OpenCode applies an effort only through a model's `thought_level` option (chats/acp.ts): a model without one logs
  «effort not applied». Whether OpenCode's GPT models offer it on the owner's PC is not verified.
