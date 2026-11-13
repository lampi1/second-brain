# ADR 0235 · Measure how well the launch memory finds the right fact

Date: 2026-11-09 · Status: accepted (owner, project thread «Migliorare la memoria degli agenti», 2026-11-09: «si procedi
con i primi 2 punti», point 2 of the LangChain/LangGraph report: measure the memory before changing technology) ·
Builds on: ADR 0094 (hybrid search, local e5), ADR 0137 (selective launch memory), ADR 0150 (launchable facts)

## Context
A role's launch gets at most 8 facts of its scope (`rules/launch-memory.ts`), ranked by shared words weighted by rarity.
The meaning (the local e5 model of ADR 0094) is used only when the agent calls `memory_recall` itself. A goal written
in other words or in another language than the fact (Italian goals, English facts) may miss it. Nobody had measured how
often, so there was no evidence for or against a new memory technology.

## Decision
- **A recall check, zero tokens, read-only** (`rules/recall-check.ts`). Each launchable fact written by a recorded run
  (its `sourceRunId`) is a case; that run's goal is the question; the fact is found when it is among the first 8 facts
  of its own scope (role, project…). Two rankings on the same cases: the launch's words (`rankByWords`, now exported
  with `launchCandidates`, behaviour unchanged) and words fused with meaning (reciprocal rank, k = 60, facts at cosine
  ≥ 0.8, as `memory_recall`). At most 400 newest cases.
- **Shown in Memoria → Statistiche** as «Quanto ritrova la memoria» (`RecallCheckCard.tsx`, IPC `memory:recallCheck`):
  both percentages, what meaning finds that words miss and the other way round, up to three missed facts with their
  goal. Computed only when the tab asks, embedded at low pace in the search worker, vectors cached by text hash, the card
  kept 10 minutes or until the facts change. Under 5 cases it says «too few»; without the model, words only.
- **The launch does not change.** If the meaning wins clearly on the owner's data, using it at launch is a separate
  decision.

## Consequences
- The cases favour words (a fact is often written with the words of its own task); the card's «?» says so. A gain for
  meaning here is a lower bound.
- CPU: one embedding pass of the goals and facts the first time the tab opens, then only new texts.
- Tests: `test/unit/recall-check.test.ts`; the launch's own tests are unchanged (`test/unit/launch-memory.test.ts`).
