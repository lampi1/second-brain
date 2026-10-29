# ADR 0170 — Reviews on/off, honest counters for the Orchestrator, Flash and Pulse, reconcilable writes without a grant

Status: partly superseded by ADR 0179 (app-execution portions); accepted. Date: 2026-10-27. Owner request (thread «Fix revisioni, contatori e riconciliazione»).

## Reviews

The daily count `delegation.judgeDaily` is removed (type, defaults, range and settings schema; a stored value is
dropped by `checkedDelegation`). Automatic reviews are only the `judging` switch: on = every finished root work run gets
one Sentinel review (at most two running at once), off = none. It had been ignored since 2026-10-22 but still showed in
`app_config`/`app_guide` as «3 al giorno», which is why the owner saw "limit 3, at least 14 reviews".

A review is never reviewed. Before, `pickSamples` skipped only runs with `reviewOf`; a new task given to a «Revisione · …»
chat (`ChatManager.beginAssignment` starts the next run without `reviewOf`) or a continuation of it was sampled again
(«Revisione · Revisione · …»). `judge-sample.ts reviewRuns` now marks every run of a chat that hosted a review and every
run continued from one; audits, receipt audits and the cost estimate use the same set, and a chat titled
`Revisione · ` is passed over as a last guard.

## Counters and levels

The card's «Lavori conclusi» read only `metrics.all.ended`; the Orchestrator has no run of its own and Flash none at all,
so both showed 0. `shared/agents.ts completedRuns` takes the larger of it and the standing's count (the Orchestrator's
ended root jobs, Flash's answers).

Pulse (Battito) stayed at the first level for two reasons: its card jobs almost always run on a fallback engine (its own
engine is rarely an isolated one), and fallback one-shots were not counted; and its only verdict comes from the user's
action on its cards, which mostly expire unseen. Pulse's card jobs now count on any engine (`standing.ts pulseJob`,
`run-metrics.ts foldRun`), the one-shot keeps `oneshot.ok`, and a Pulse run with no verdict on its cards gets the
low-trust observed proxy Flash already has (TRUST.quick, `PULSE_XP` 0.25 for an answer within limits, a fail for a
failed run). A saved, acted or dismissed card still outranks it as the user's verdict. Rollups keep the same XP.

## Writes without a recorded request or a live grant

Each journal entry now also keeps the organization and work item it was written under, the PR id of PR-only ops and the
related work item; `relate-pr` keeps the same routing identity as `link-pr` (ADR 0169). When the run's approved DevOps
scope is gone (a paused, replaced or changed trigger), `runtime.ts reconcileScope` uses the scope the pending writes
kept, so the user can still mark them; the receipt stays local bookkeeping and grants nothing. The modal shows the hash
with its label and asks to pick an outcome instead of "Confermi … di 0 scritture?".

## Orchestrator

`app_guide` has entries for the review switch and for how completed work and levels are counted; the reconciliation
tools were already mounted and indexed (ADR 0169).

## Stutter («va a scatti», «si freeza senza loader»)

The main process's JS runs on the browser UI thread, which routes input and presents frames: any long synchronous step
there freezes the window without a spinner. Every settled turn of every chat wrote the whole `agent-runs.json` (up to
7 MB: serialize + write + rename, synchronous): measured 45 ms a write at 7 MB on a fast Linux disk and 236 ms with a
prune; on Windows an antivirus scans each new file. The per-turn changes (cost, tokens, turns, skills used) are now
written once per second (`ChatManager.runSaveSoon`), flushed at stop, exit and metrics reads; a run's start and end
still write at once. `perf.ts startStallWatch` logs each main-thread stall over 200 ms (`npm run logs -- --scope perf`,
«main process blocked») with the slow steps seen meanwhile (agent-runs.json and chats.json writes are timed), so the
next cause, if any, is named by real use instead of guessed.
