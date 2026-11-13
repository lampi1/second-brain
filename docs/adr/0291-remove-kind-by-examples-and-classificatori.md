# ADR 0291 · The kind of work by examples and the Classificatori section are removed

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «Ma sui classificatori?»,
then «Si fallo» to the proposal below) · Supersedes: part 2 of ADR 0197 (the kind of work by examples), the
Classificatori section of ADR 0210 and ADR 0077, the Classificatori cards of ADR 0186

## Context

Counted on the owner's own runs for ADR 0285 (658 ended jobs): the estimate holds for time in 42% of the jobs when
they are grouped by kind of work, 43% grouped by role alone, 39.5% with no grouping. The kind adds nothing there.

What was left of the classifiers:

- The kind of work by words (`taskOf`): the fallback of the estimate when a job has no role yet, the role hint of
  Balanced mode, the kind written on the ledgers.
- The kind of work by examples (ADR 0197): a nearest-centroid model trained on the user's runs. It decided nothing:
  it only filled its card in Andamento → Qualità → Classificatori.
- The Classificatori section: read-only cards about the sorters above.
- The fixed rules that filter lessons and memory facts, the Orchestrator's mail, production commands: rules, not
  models, and at work.

## Decision

1. The kind of work by examples is removed: `brainmodel/kind-model.ts`, `kind-centroids.ts`, its card.
2. The Classificatori section of Qualità is removed with its data (`brainmodel/classifiers.ts`,
   `classifier-cards.ts`, IPC `classifiers:state`), its components, its texts, the G K key, its README part and
   screenshot. The old id and link «classificatori» still open Qualità.
3. `renderer/brain/lib/learn.ts` goes with it: only the section read it.
4. Kept: `taskOf` where it is still used, the estimate chip with its «entro ×2» count, the Guida card «I
   classificatori» (it describes the sorters that still work), the Log's «Classificatori» events, the demo's work
   history (`demo-history.ts`, once `demo-classifiers.ts`), the app-errors styles (`styles/app-errors.css`, once in
   `classifiers.css`).

## Consequences

- One section less to read and about 2,200 lines less to keep (code, tests and texts). No decision of the app changes: nothing read the
  removed model.
- The weekly trend of the estimate's backtest is no longer drawn anywhere; its last count stays on the estimate
  chip. `agents/estimate-accuracy.ts` still computes the series.
- The outcome ledger and the job ledger are still written as before.
