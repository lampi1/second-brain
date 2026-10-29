# 0186 — Honest classifiers and statistics: one taxonomy, one success, fewer numbers

2026-10-29. Accepted. Supersedes the exploration part of the routing ADRs (the `exploration` rate no longer drives any
chat), the skill suggester (#159 and the Classificatori «Skill» card) and the parts of ADR 0083 and ADR 0085 that made
every permission save a new role version.

## Context

The owner asked to clean up and fix the app's classifiers and statistics: several figures were computed from data
that is never written, two taxonomies named the same job differently, and some cards showed a percentage from one
outcome. Eleven steps, each its own commit on `claude/project-thread-zsljzi`.

## Decision

1. **Correction hook** (brain-template `ops/tools/app-text.mjs`, `correction-catch` hook): only the owner's own words
   count as a correction. The app's labels, the role frame, Flash context and bracketed app notes are stripped first;
   «non vale» no longer matches «non va»; a plain «come mai» / «perché non» question is not a correction.
2. **Honest outcomes** (`shared/judging.ts`, `receipts.ts`, `run-verdict.ts`): the Agenti page and `npm run levels`
   say when the review sampler is off and since when; a turn outside git knows its files from its edit rows
   (`receipts.filesKnown`); Sentinel reviews are graded by the user, an audit, the parent's feedback or a rework.
   Pulse and the retired roles (Judge, Scribe, Router) get no level or catalog stats; their runs stay readable.
3. **task_estimate** (`agents/task-estimate.ts`): only a new request to the Orchestrator gets the line (not «ok»,
   «vai» or a short answer within 30 minutes of the previous message); parts need a join before an imperative verb;
   pasted mail, logs, code or quotes are one part; a job is measured on elapsed time with its whole tree's cost;
   figures are calibrated per kind by the median actual/estimate ratio; confidence comes from the spread. Synthetic
   replay (`test/fixtures/estimates/synthetic-jobs.ts`, ratios p25 1.03 · p50 2.01 · p75 4.21): **88% held**, above
   the 60% bar. Synthetic data only: the real calibration runs on the owner's ledger.
4. **Skill suggester removed**: `src/main/skills/suggest.ts`, `src/shared/skill-suggest.ts`, the `skills_suggest`
   tool, the launch snapshot, the «Skill per X» line and the Classificatori «Skill» card (**2 files, 28 Italian keys,
   ~450 lines**). Old runs keep their `skillSuggestions` field and load.
5. **One taxonomy** (`shared/work-concepts.ts`): `WORK_KINDS` (was `TASK_KINDS`) and `taskOf` are the one rule for the
   routing table, the job ledger, the estimates and the Classificatori cards. `JobKind` and `brain/estimates.ts
   classify` are gone; old `jobs.jsonl` kinds load through `fromLedgerKind` (fix→bug-fix, qa→qa-run,
   feature→app-feature, research→investigation, question/other→altro). On the holdout fixture `taskOf` without brain
   rules gets **28/30**, the old classifier mapped to task kinds **16/30**. Removed from `brain/routing.ts`: `explore`,
   `EXPLORE_MIN`, the arm counts, `statsLine`, `freshReason`, `kindStats`, `allKindStats` and the generic
   title-prefix area (**7 exports, 7 Italian keys**). `agentStatsLine`, `match` and `resolve` stay: «Nuova chat», the
   Orchestrator restart and the role table still use the table path. Area rows now match only on an explicit area or
   app code (`App · …`, `Pers · App/second-brain`); a «Shop · …» title no longer picks a row by its label.
   `routing.json`'s `exploration` field is kept and read (old tables load, `app_routing_save` no longer takes it);
   old `explore` routes still validate.
6. **jobs.jsonl**: a turn end with the same totals appends nothing; on load the file keeps the last row per id and is
   rewritten (atomic tmp + rename) when the lines exceed three times the ids; `tokensIn`/`tokensOut` (null on every
   row) are no longer written. 1000 updates of one id = 1 line (test).
7. **brainmodel:state cache** (`brainmodel/service.ts`): one read-worker result per generation (bumped on
   `brainmodel:changed` and `agents:changed`), brain, run-store revision and lessons, for at most 5 minutes; a failed
   read is not kept. Two calls without a change compute once (test).
8. **One success** (`shared/success.ts`): verified verdicts only (the user's or a verified review's), a partial counts
   0.5, no share under **5** verdicts (the Skill statistics wanted 10 of any verdict). Used by `memory-stats.ts`,
   `run-metrics.ts`, `routing.ts agentStatsLine` and the front of the Agenti card («Riuscita», `n/5` below the bar).
9. **Orphans and dead metrics removed**: `agents/progress.ts`, `shared/progress.ts`, the `progress:get` IPC, two e2e
   specs and one unit test (personal milestones nobody showed); `brainmodel/error-lessons.ts` and its test (never
   mounted); the run tallies' `permissions` and `contextPeak` (**2 fields**; the raw counters stay on each run);
   context-stats' `notesWritten`, `notesUsed`, `afterContinuation` (**3 counters**). Kept with a reason:
   flow-signals `non_capito` (read by the brain's `routines.md` through `flow-signals --forced`),
   `corrections.tagged` (the «Correggi il pensiero» tag, real), the version trials (`approveTrial` starts them; the
   stale `trials.ts` comment is fixed).
10. **Apprendimento**: the per-run ai-errors metric is dropped (**1 metric**): the app's own `error` command writes
    `- date | agent | text`, never a run id, so the column was always empty; the brain's `mem.mjs error` still tags
    runs for its own tools. The page now says how many lessons the agents proposed in the last 12 weeks and how they
    ended (applied, discarded, waiting), «Nessun dato» when none, «troppo poche» under 5, and that lesson evidence is
    never causal (`lesson-evidence.ts` `causal: false`).
11. **Role versions** (`agents/catalog.ts version()`, `agents/versions.ts versionedChanges`): a new version only when
    the role's text, skills (or know-how), model (engine, model, effort) or tier (or ceiling) change; it records
    `changed`. Tools, permissions, launches, limits, the app's migrations (ADR 0085 full defaults, ADR 0100 texts,
    shipped texts) and engine rebinds update the active version in place, with a note (`amended`, last 5). Reusing a
    child chat also compares the role's revision, so a permission narrowed in place still needs a fresh chat. The role
    page lists per version its runs, verified outcomes and success with a 90% Wilson ± («troppo pochi» under 5).
    Effort counts as "model" because it changes the outcome as much as the model does.

## Removals, in numbers

| What | Count |
| --- | --- |
| Files deleted | 10 (5 source, 2 e2e specs, 3 unit tests) |
| Italian UI keys removed / added (each with en, de) | 43 / 30 |
| Routing exports removed | 7 (`explore`, `EXPLORE_MIN`, `statsLine`, `freshReason`, `kindStats`, `allKindStats`, `KindStats`) |
| IPC channels removed | 2 (`progress:get`, the `exploration` parameter of `routing:save`) |
| MCP tools removed | 1 (`skills_suggest`) |
| Run-tally fields removed | 3 (`permissions`, `contextPeak`, `aiErrors`) |
| Context counters removed | 3 (`notesWritten`, `notesUsed`, `afterContinuation`) |
| Ledger fields no longer written | 2 (`tokensIn`, `tokensOut`) |
| Taxonomies | 2 → 1 |
| Lines (src + test) | 1 708 added, 1 764 removed over 11 commits |

## Consequences

- Old files stay readable: `agent-runs.json` rollups with the dropped fields, `role-history.json` without `changed`
  or `amended` (or with one out of shape: dropped, not refused), `jobs.jsonl` with the old kinds, `routing.json` with
  `exploration`, runs with `skillSuggestions`. The owner's settings, routing rows and roles data are not changed.
- Risk: the brain's own `estimates.mjs` may read `jobs.jsonl` (ADR 0053); its `kind` values are now work kinds.
- Fewer versions: the run statistics of a version are no longer split by a permission toggle or an app migration.
- No new dependency, no new permission prompt, no token cost.
