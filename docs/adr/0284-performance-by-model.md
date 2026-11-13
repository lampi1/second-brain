# ADR 0284 · The level is the role's, the performance is the model's

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «performance con cambi di
modello frequenti», and the report's proposals «livello del ruolo, performance del modello», «il cambio di modello non
crea più una versione», «un modello nuovo parte dalla media del ruolo», «costo stimato dai token», approved with
«Approvo tutte le tue modifiche del report») · Amends: ADR 0186 (what makes a role version), ADR 0131 (the performance
estimate)

## Context

A change of model (engine, model, effort) or of tier made a new role version (ADR 0186), and the role's page showed
its numbers per version. In the owner's data 102 of 145 versions came from a model change alone; his Strategist was at
version 36 with a median of 3.5 runs a version, so no version reached the five verdicts a percentage needs. The card's
level and performance already count every version together, which also mixes every model. Only Claude Code reports a
cost in dollars: Codex, OpenCode and Cursor report tokens, so 106 of his runs had no cost and «cost per successful
run» could not be compared between models.

## Decision

1. Only the role's text and its skills (and know-how) make a new version (`versions.ts versionedChanges`). Model,
   effort and tier change the active version in place, like tools and permissions: every run already names the model
   and the tier it ran on. Going back to an older version keeps today's engine, model, effort and tier
   (`catalog.ts restoreVersion`), and the version's record takes them. 'model' and 'tier' stay as names for the
   versions older releases made and for a trial of a model or a tier, which is still compared as a version. The
   nightly review's share (ADR 0203) counts a role's verdicts on the model of its latest run, so a model change
   still takes the role back to the wider sample.
2. `AgentStanding.models` (`standing.ts`): one row per model among the role's kept runs, with the runs, the verified
   successes, the performance and its spread, the cost of one verified success and the median working time.
3. A model's performance is the same weighted estimate as the role's, started from the role's performance on its
   other models instead of 50% (no verdict counts twice; a role with one model starts at 50%): a prior worth
   `MODEL_PRIOR_WEIGHT` = 4 verdicts, shown from `MODEL_MIN_EVALUATED` = 3 verdicts with a spread no wider than the
   card's, and only when the card shows its own. The two numbers are a first choice, not a measured one.
4. A run with tokens and no cost is priced at list price (`list-price.ts`): the brain's `harness/models.json` first,
   any engine's row, then the list prices kept for Cursor's models, by the exact name only (a near name would take
   another model's price). The row is then marked as an estimate («stima»).
   A model in neither table has no cost («prezzo sconosciuto»), never 0. Nothing is written on the run: the estimate
   is computed when the metrics are read, so a corrected price corrects the past too.
5. The cost of a success is every run's cost over the verified successes, failed runs included. Runs without a cost
   count as the average of those with one, and the row is marked as an estimate.
6. The role's page in Agent Studio shows the rows in a «Per modello» table (`ModelStandings.tsx`). The card's front
   is not changed here.

## Consequences

- The level never resets with a model change, and a role keeps one row of numbers per model however often the model
  changes. The owner's 145 versions would have been about 40.
- The rows count only the runs kept whole (ADR 0283: about two weeks at his pace). The rollups of pruned runs carry
  no model, so older runs are in the level and not in the table.
- The version list no longer says when a model changed; the runs do.
- A list price is not a bill: a subscription plan, a cached price or a provider discount make the real cost lower.
- Tests: `test/unit/agents/model-standing.test.ts`, `test/unit/agents/versions.test.ts`,
  `test/unit/agents/catalog.test.ts`, `test/unit/agents/judge-sample.test.ts`.
