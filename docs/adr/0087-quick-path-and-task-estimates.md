# ADR 0087 · The quick path and task estimates from similar tasks

Date: 2026-10-19 · Status: accepted (owner, 2026-10-19 evening: «deve esserci una soluzione per le chat veloci,
l'orchestratore deve essere bravo a capire se può cavarsela in fretta anche con le stime per task simile … stime
leggibili e poi il progresso dei classificatori nelle stime») · Builds on: agent runs (A5, `agents/runs.ts`), the
keyword classifier (`brain/estimates.ts` `classify`), ADR 0083 (roles and direct delegation) · Revisits: ADR 0053

## Context
Since ADR 0083 the Orchestrator's rules said "use app_create_chat for every task", and a role could delegate any part
with `agent_delegate`. The owner saw that delegation costs more tokens and time than it saves on small jobs: a question
that needs one read became an Orchestrator turn, a role chat and sometimes children. The Orchestrator had no figure to
tell a quick single-part job from a real plan. The strips' estimate (renderer `lib/agent-estimates.ts`) was the median
of all the agent's ended runs, whatever the task, with a one-line tooltip: not readable, and no way to know whether it
was any good. ADR 0053 had removed an earlier per-job estimate because, measured, it held only 47% of the time; the
lesson kept here is that an estimate must say what it rests on and show how often it held.

## Decision
- **One estimator, from similar tasks** (`src/main/agents/task-estimate.ts`, pure). The ended agent runs (one-shot jobs
  excluded) are grouped three ways by agent and kind (the classifier on the run's goal, the app's leading agent label
  dropped): same agent and same kind, same kind on any agent, same agent on any kind. A request takes the first group
  with at least 3 runs (`MIN_SIMILAR`), the 30 most recent (`MAX_SIMILAR`) that ended before the moment of the estimate.
  Time = the run's execution time (waits for the user and permissions excluded; the elapsed time only for a completed
  run under 8 h without it), cost = its reported cost. Figure = median; range = the middle half; confidence high (≥ 10
  tasks, p75/p25 ≤ 3), medium (≥ 5), low, one level lower on the agent-only group. No model is ever called.
- **Parts and the path.** The parts of a request are its list items (two or more) or 1 + its joins ("poi", "inoltre",
  ";", "then", "also"…). quick = median time ≤ 10 min and cost ≤ 0,50 $. path: `tree` for 3+ parts or 2 parts that are
  not quick; `self` for a short question (≤ 400 characters, one part, quick or without data); else `one-agent`.
- **The Orchestrator decides with data.** Its fixed rules (`orchestrator-role.ts`, so they reach existing catalogs too)
  and its shipped role text say: call `task_estimate` first; `self` → answer yourself; `one-agent` → ONE chat whose
  prompt says to work alone, without `agent_delegate`; `tree` → plan it; tell the user the estimate in one line and say
  when it rests on few tasks. `app_create_chat`'s description says the same and its answer carries the estimate;
  `agent_delegate`'s description says to delegate only work of several independent parts. `task_estimate` is on the
  Orchestrator's own endpoint only (numbers, never a run's content), like `agent_metrics`.
- **Readable estimates on screen.** IPC `agents:estimates` (`agents/run-estimates.ts`) returns, for the runs the strips
  show, the estimate made from the runs ended before each started (so an ended run is compared with what was known
  then, and never with itself), its actual once ended and whether the time held (between half and double). The strip
  chip reads «STIMA ~4 min · ~0,12 $ · su 12 task simili ?», «ne restano ~3 min» / «oltre la stima» against the strip's
  own work time, and «~4 min → 6 min ✓/✗» once ended. Its "?" (HelpTip) names the group, the kind, the range, the
  confidence, the actual, and the accuracy. The Orchestrator's plan (under its head) lists the runs it started today
  with their estimates, a «via rapida» mark on quick single-agent jobs, the sum, and the accuracy line.
- **The estimator's progress** (`agents/estimate-accuracy.ts`, a small module of its own): a weekly backtest of the
  same estimator on the last 8 weeks of ended runs, each from the runs ended before it started: how many had an
  estimate, the share that held, the median relative error, and the share resting on the most specific group (it grows
  as the classifier sees more tasks of each kind). Shown as «precisione 68% · +14 pt in 6 settimane» with weekly bars;
  the Dashboard and the Classificatori page can read the same `EstimateAccuracy` from `agents:estimates`.
- The old strip estimate (`lib/agent-estimates.ts`, its keys and test) is removed. The demo carries a deterministic
  8-week run history (`demoEstimateRuns`) and three runs at work, so the chip, the plan and the bars show with data;
  with no history the chip and the plan simply do not show (a fresh install starts empty).

## Consequences
- Small requests stop paying for a delegation tree; the user sees why (the path and the estimate) and how far to trust
  it (n, confidence, the accuracy the app measured, not claimed).
- The kind is the keyword classifier's: a misclassified goal falls into another group. The backtest makes this
  visible as lower accuracy and a lower specific share; improving the classifier improves both.
- Costs are in $, as everywhere in the app (the engines report $).
- The heuristics (parts, 10 min, 0,50 $, 400 characters) are constants in `shared/task-estimate.ts` and
  `agents/task-estimate.ts`, pinned by `test/unit/agents/task-estimate.test.ts`; a later ADR may learn them from the
  ledger instead.

## Revision (owner, 2026-10-20, #113)

The Orchestrator no longer writes the estimate in its replies: the agents view (strip chip, plan under its head)
already shows it. Its rules now say to keep its own turn short, hand runs of tool calls to a work chat, and acknowledge
a delegation with one emoji (ADR 0089, shared/reaction.ts).

## Revision (owner, 2026-10-21, #124)

The plan panel under the Orchestrator's head («Piano dell'Orchestrator») is gone: it took the top of the chat even for
a single one-agent job, and the same facts are on the strips in the Grindhouse and in each run's verdict. The
Orchestrator's chat starts with its messages.
