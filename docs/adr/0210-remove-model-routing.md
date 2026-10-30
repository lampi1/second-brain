# 0210 — Remove the model-routing classifier: every agent runs on its own card's model

Status: accepted. Supersedes ADR 0032, ADR 0047 and ADR 0078. Changes ADR 0052 and ADR 0091 (see below). Builds on ADR
0077, ADR 0083, ADR 0186 and ADR 0202.

2026-10-30.

## Context

The model routing (ADR 0032) kept a versioned table in the brain (`ops/state/improve/routing/v<N>.json` and
`current.json`). It picked the engine, model and effort for each kind of work and area. ADR 0047 added votes and prices.
ADR 0078 put the agent's own profile first and kept the table only to fill a missing model. ADR 0091 made roles without
a model follow the table. The Orchestrator could read and rewrite the table (`app_routing`, `app_routing_save`). The
renderer read it through `routing:get` and `routing:save`. The Classificatori tab had a «Scelta del modello» card with
the table, its history, its quality per route and «chi ha scelto il modello».

By now the role cards decide nearly every chat. A role has its engine, and a model or a tier. The Settings editor for the
table was already retired. What remained was a second, hidden source of models that the user could not see on the
card. On 2026-10-30 the owner chose «Toglierlo» (remove it): every agent uses the model on its own card, or its tier's
model when the card names none.

## Decision

**D1 — no routing table.** `src/main/brain/routing.ts` keeps only the parts that other features use:

- `resolve` and `routeChat` take the engine, model and effort the user picked («Nuova chat», «Chat aperte
  dall'Orchestrator»). A pick the user names is an override.
- `routeAgent`: a role chat takes what its role resolved to.
- The route on the chat (kind, area, source `default` / `override` / `agent`, version always null).
- The ledger lines: the prediction and then the measured actuals in `<brain>/ops/state/improve/outcomes.jsonl`. They
  feed the «Tipo di lavoro» card, the verified outcomes and the agent runs' verdicts.

The table, its checks, its exploration, its cost weight, its history, `APP_AREAS` export, `role-table.ts` and the
`routing-api.json` choice of ADR 0052 are gone.

**D2 — a role's model.** `agents/catalog.ts` resolves the role's own model, else `tierModel(engine, tier)` (Impostazioni
› Ruoli e deleghe, else the registry's model of that tier), else the engine's default. The effort is the role's own,
else the launch's. A role run's `modelFrom` is `role`, `tier` or `engine`. An old chat with `modelFrom: 'table'`, or a
route with source `table` / `explore`, still reads back (`validRoute`) and is shown as before.

**D3 — removed surfaces.**

- IPC: `routing:get` and `routing:save`, with `RoutingRow`, `RoutingTable`, `RoutingChange`, `RoutingInfo` and
  `ModelRegistry.appChats`. `BrainService` now offers `modelRegistry()` instead of `routingInfo()`.
- MCP tools: `app_routing` and `app_routing_save`, with their tool-catalog rows and docs/agents/commands.md lines.
- `app_create_chat` drops `routeHint` and the result's `tableVersion`.
- The Guida card «routing» (concept-guide.ts, concept-ids.ts, the German map). The agents, orchestrator, classifiers and
  trends cards say who picks the model now.
- `app_guide` gains the entry «Modello di un agente: chi lo sceglie».
- The «Scelta del modello» card (model card, routing table, history, quality, sources) and its i18n keys in it/en/de.
- The e2e spec settings-routing.spec.ts and the routing test of api-credits.spec.ts. routing-ledger.spec.ts now checks
  the tier model, with an old table that the app ignores.

**D4 — Classificatori folds into Qualità.** Without the model card, the tab had only the classifier cards (kind of work,
task estimates, job kinds, mail, commands, the kind model by examples). They are now a section «Classificatori» of
Andamento › Qualità (`ClassifiersSection.tsx`, test id `bx-q-classifiers`). `TREND_TABS` is costi, qualita,
apprendimento, uso. The old ids `classificatori` / `classifiers`, the G K key, `andamento/classificatori` and old usage
counter keys all land on Qualità.

**D5 — stored data stays harmless.** Old `routing/v<N>.json`, `current.json` and `userData/routing-api.json` are never
read, and nothing deletes them. Old ledger lines with `source` or `version` still load, and those fields go unread. No
setting key held the table, so no migration is needed.

## Consequences

- One place decides a model: the role card (or the user's pick for a chat without a role). The Guida, `app_guide` and
  the card say the same thing.
- ADR 0052: the API-credit routing of writing rows (`onApi`) is gone with the table. The judge and text-only calls keep
  their own API choice.
- ADR 0091: roles without a model follow their tier, not the table. A review's independence is still its clean session.
- The brain's improve loop may still propose a "routing" policy. The app shows such proposals as brain data and never
  applies them to a model choice.
- Kept: task estimates, levels, Qualità, the ledger and the kind-of-work classifier.
