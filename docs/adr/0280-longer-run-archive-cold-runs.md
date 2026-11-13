# ADR 0280 · A longer archive of runs, and a save that costs what the runs at work weigh

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: the report's proposal
«archivio dei lavori a 30 giorni», approved with «Approvo tutte le tue modifiche del report») · Amends: ADR 0199 (runs
in app.db)

## Context

The runs kept whole were held to 7 MB (`RUNS_BYTES`), the limit of the JSON file they lived in before app.db. A run
weighs about 9.5 KB in the owner's data (the report's output 2.5 KB, the commands 1.3 KB, the goal twice 2.4 KB), and
he starts about 115 a day: 7 MB held five or six days. The role suggestions and the review's cost cap read 30 days
(`suggestions.ts`, `judge-sample.ts`), the standing has a 30-day half-life. Older runs survive only as rollups, which
keep counts and sums but no dates.

Raising the limit alone would have cost at every save: a deferred save built the JSON of every run to see which ones
changed. Measured here on a copy of his data: 61 to 71 ms of the main process (in 8 ms slices) for 7 MB, once per burst
of run events (every 250 ms while agents work).

## Decision

1. In app.db the runs' budget is `RUNS_DB_BYTES` = 16 MB. The JSON fallback keeps 7 MB (its file is written whole).
   `RUNS_MAX` stays 5000.
2. A deferred save into app.db skips the cold runs: one that ended more than `COLD_AFTER_MS` (10 minutes) ago and is
   already in the database keeps the JSON last written. Every `COLD_PASS_MS` (15 s) at most a save looks at all of them,
   and so does every synchronous save. After a save that skipped them a timer asks for the full one, and the armed
   timer counts as something still to write, so the quit's flush writes it.
3. Runs are not slimmed. Dropping an old run's output or contract was measured (it would reach 30 days at the owner's
   pace) and left out: the skill candidates, the result cards and the delivery metrics read those fields, and a run
   without them would count as a run without a report.

## Consequences

- Measured on a copy of the owner's runs doubled to 13 MB: the save between two full passes takes 4 to 9 ms instead
  of 61 to 71 ms at 7 MB; the full pass takes 93 ms in slices, once every 15 s while runs change; the start reads the
  runs in 156 ms (it was about 80) and the main process holds about 48 MB for them (it was about 25).
- At about 115 runs a day the archive holds 13 to 14 days instead of 5 to 6; up to about 55 runs a day it holds 30.
- A change to a run that ended more than ten minutes ago (a late verdict, a review, feedback) reaches the database up
  to 15 s later than before; a crash in that window loses that change, not the run.
- Tests: `test/unit/agents/runs-db.test.ts`.
