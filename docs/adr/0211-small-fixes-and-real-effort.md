# 0211 — Agent card picks model, effort and context; real effort names; owner's small fixes of 2026-10-31

Status: accepted. Builds on ADR 0210 (every agent runs on its card's model), ADR 0201 (Battito removed), ADR 0203
(nightly sampled reviews), ADR 0202 (Andamento).

2026-10-31.

## Context

The owner (2026-10-31) listed small problems: the script cards spill their text under the tags and break the language
badge; Andamento is a group of its own with one entry; the description of «Abilita controllo livello e performance»
says «ogni notte» while his PC is off at night; the Log still shows «Battito»; an agent's result in the Orchestrator
has no quick way to have the Orchestrator summarize it, and «Agente» takes room as a word. On the agents he wants
model, effort and context window on the back of the card, with the effort by its real names («non mid top ecc») and
a real behaviour («non è possibile che se scelgo top non so se è high o xhigh»).

## Decision

- **D1 — script cards.** Every block of a card keeps its height; title and description are clamped (3 lines) with a
  hard height and wrap anywhere; the language badge never wraps.
- **D2 — Andamento under Brain.** The sidebar has three groups (Lavoro, Brain, App); Andamento is Brain's last entry.
- **D3 — the review switch says when it runs.** Once a day: at 3:00 only if PC and app are on, else at the first pause
  after the next start (app open 5 minutes, no input for 10), or at once in Modalità notte; missed nights make one
  review over the last 7 days, within the cap. The same words in it/en/de and in the cards' «Aggiornato» tooltip.
- **D4 — no Battito in the Log.** The journal skips the old `pulse` events when it reads its files; the kind, its
  filter chip, colour and labels are gone.
- **D5 — result row icons.** The row of an agent's result carries two round icons: ✦ «Fallo riassumere
  all'Orchestrator» (the existing synthesize turn, its cost in the tooltip) and → to the agent's chat.
- **D6 — the card's back picks model, effort, context.** `AgentCardModel.tsx` saves through `agents:save` (a new
  version, as any model change). The catalog's models carry their registry facts: `efforts`, `defaultEffort`,
  `contextWindow` (new optional registry field; the release template's row fills a brain made before it). The effort
  list is the chosen model's own; the context list stops at the model's window.
- **D7 — real effort names and behaviour.** Effort labels are the engine's own words (low, medium, high, xhigh, max)
  in every language. At launch `effortOn` (shared/agents.ts) gives the run the asked level when the model takes it,
  else the nearest lower one, none on a model without efforts; the card says so under the picker. The model tier
  (leggero/medio/alto) only picks a model, never an effort.

## Consequences

- What the card shows is what the run gets. Tiers stay for roles without a model.
- An existing brain's `harness/models.json` gains no field: the context window comes from the release template.
