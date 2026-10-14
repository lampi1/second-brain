# ADR 0030: one shared, honest self-improvement loop (step 1: estimates)

Date: 2026-10-13 · Status: accepted (step 1 of 3)

## Context

The app and the brain each had their own time/cost estimator (the app's keyword classifier over `jobs.jsonl`, the
brain's `estimates.mjs` table by chat title). Their ranges were p25-p75, i.e. they promised to hold the truth only half
of the time (the app's $ range held 40 times out of 101), and nothing recorded what was predicted before a chat ran, so
no change could be verified. The user approved one shared loop for everything that learns (estimates, model routing,
notification thresholds), never applied without his ok.

## Decision

- **The loop lives in the brain** (`ops/improve/lib.mjs`, no model calls): `observe()` appends predictions (before
  the item runs) and outcomes to `ops/state/improve/outcomes.jsonl`; `backtest()` is rolling-origin (each item
  predicted only from items finished before it started) with metrics median/mean absolute error, log-ratio error and
  coverage (never MAPE). One adapter per policy in `ops/improve/policies/<name>.mjs`.
- **Honest 80% ranges**: split conformal on the log errors of past predictions (range = median × e^±q, q = the
  ⌈(n+1)·0.8⌉-th residual); under 20 residuals there is no 80% range and the estimate falls back to p25-p75, labelled
  as the middle half. The coverage it actually held is measured the same rolling way and shown in the tooltip.
- **One estimator in the app**: with the brain's table (`estimates.json`) the estimate is the brain's, or "stima
  senza dati" when no group has enough chats; the app ledger's keyword estimate is only the fallback without a brain
  table. The ledger keeps recording actuals (Cursor's work time comes from it).
- **Prediction recorded before the run**: at a job's first turn end (when the session id is known) the app appends
  the estimate it showed, with `at` = the job's start and the title it was made on, to the brain's `outcomes.jsonl`
  (the prompt's length only, never its text). The brain's `estimates.mjs --update` adds the measured outcome once
  the chat has been quiet for an hour, or `known: false` after 3 days without a measurable chat.

- **Changes only with the user's ok** (step 2, brain CLI `ops/improve/improve.mjs status|propose|apply|reject|rollback|verify`):
  each policy is versioned (`<policy>/v<N>.json` + `current.json`, an audit line per change, one-click rollback). A
  challenger becomes a *proposal* only with ≥ 30 items shared with the version in force, the 90% interval of a paired
  bootstrap on the log errors entirely above 0 and no secondary metric worse; evaluated on demand or every +20 known
  outcomes (no timers). A policy applies its own proposals only if the user whitelisted it. After a change, the
  version in force is checked on the next 20 items against the old one in shadow: worse beyond the noise → a revert
  *proposal*, never an automatic revert. Brain rules never learn: they only get the same after-check.
- **The app's "Miglioramento" page** (brain area, G R): one card per policy with its version and since when, the
  typical error now (× between estimate and truth) with the last ones as bars, how often the 80% range held, with
  every n, results out of the count, "senza dati" under 20 measured, a drift warning, a waiting proposal with what it
  gains and [Applica] / [No], the after-check and [Ripristina v<N-1>]. It reads `/api/improve` (the brain site runs
  `improve.mjs status --json`, cached a minute) through the allow-listed proxy; a click goes to main (`learn:act`,
  `brain/learn.ts`), which runs the brain's own `improve.mjs` with `--by "app (clic)"`, one at a time, after checking
  the action and the id/policy name: the app never writes the loop's state.

## Consequences

- Wider ranges where the past errors are wide: honest, not pretty (on 146 past chats the 80% range held 90%).
- Model routing and notification thresholds plug into the same library with their own adapters (`policies/*.mjs`).
- No new dependency; the app writes one line per job into the brain folder (the user's), nothing else.
