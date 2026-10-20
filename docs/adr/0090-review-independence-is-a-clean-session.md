# ADR 0090 · A review's independence is its clean session; roles without a model follow the table; untouched roles follow the chosen engine

Date: 2026-10-20 · Status: accepted (owner, issues #99 and #96) · Supersedes: the "independent role" model switch of
ADR 0083 (§1's `independent` field, §9's "on another model") · Restores: ADR 0078's "a profile with no model takes the
matching row's model"

## Context
Sentinel and Judge had `independent: true`: with no model of their own, the catalog (`independentModel()` in
`agents/model-tier.ts`) dropped the parent's model and took the next `top` candidate of `harness/models.json`. With the
parent on `claude-opus-5-5` that was a legacy manual row (`claude-opus-5`, `claude-opus-4-8`) with effort `high`: a
worse and dearer reviewer the user could not override, because roles with `model: null` never read the routing table.
A Judge review counted as reviewed evidence only "on a model other than the run's". The premise was wrong: a review is
independent because it starts in a new session that never sees the parent's reasoning, not because it runs elsewhere.

Separately (#96), a fresh install showed Brain → Agenti with every role on Claude, "installazione o accesso da
verificare" and an empty model list: the price table (which also lists Claude's models) was set after the catalog was
built and was empty without a brain `harness/models.json`; the renderer's catalog only refreshed on a role commit; the
default engine ignored the engine chosen at onboarding (`orchestratorChats.harness`).

## Decision
- **No model switching for independence.** `independent`, `independentOf` and `independentModel()` are gone; Sentinel
  and Judge resolve their model like every role. A role chat (delegated, opened by the Orchestrator or a Judge sample)
  is always a new session with only its contract. A Judge review is reviewed evidence when it ended verified in its
  own session, on any model. Old `roles.json` / history entries with `independent` are read without it.
- **Model of a role**: its own model; else, unless the launch asked a tier, the routing table's row that matches the
  chat (kind and area from its title and prompt) on the role's engine, with that row's effort when the role names none
  (`agents/role-table.ts`; never exploration, never the API switch; `route.agent.modelFrom: table`); else its tier's
  model; else the engine's default. So a "review" row on `claude-opus-5-5` + `low` sets Sentinel's reviews, and the
  role editor can set model and effort per role.
- **Legacy Opus rows removed** from the template registry: `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`,
  `claude-opus-4-6`. Old transcripts naming them are priced at the default model and flagged unpriced.
- **Catalog freshness (#96).** The price table is set before the catalog and falls back to the release template's
  `harness/models.json` (`live-cost.ts priceTableSource`). The catalog re-emits `agents:changed`
  (`AgentCatalogService.refresh()`) on `cli:ready`, on a change of `brainRoot`, `engineOn.*`,
  `orchestratorChats.harness` or `modelTiers.*`, and when an engine reports its models. Untouched default roles take
  the onboarding engine while it is usable (enabled, trusted, not known to be missing or logged out) and follow it
  when it changes; a role the user edited keeps its engine.

## Consequences
- Reviews cost what the user's own model costs; the tier/table/role editor are the only levers, all visible.
- The Studio's "Su un modello diverso da chi lo avvia" checkbox is gone.
- A table row that matches a role's work now sets that role's model when the role has none (as ADR 0078 intended):
  the App row keeps app work on its model for every role.
