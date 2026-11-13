# ADR 0285 · An estimate rests on the role and its model before the kind of work

Date: 2026-11-13 · Status: partly superseded by ADR 0291 (the Classificatori page it names is removed, the estimate chip keeps the count); accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «i classificatori secondo
me non sono molto efficaci solo per le stime di tempo e costo, però il costo è problematico calcolarlo multi harness»,
and the report's proposal «stime dallo storico di ruolo e modello», approved with «Approvo tutte le tue modifiche del
report») · Amends: ADR 0087 (which past tasks are similar), ADR 0186 (the estimate's measure)

## Context

An estimate was the median of the past jobs of the same role and the same kind of work (the classifier's kind of the
request), else the same kind on any role, else the same role. A backtest on the owner's data (658 ended jobs of 13
days, each estimated only from the jobs ended before it started; «held» = the real figure between half and double):

| Similar jobs | Time held | Cost held |
|--------------|-----------|-----------|
| role + kind, kind, role (before) | 39.6% of 632 | 48.6% of 514 |
| role only | 42.9% | 54.8% |
| kind only | 42.0% | 46.2% |
| every job, no grouping | 39.5% | 46.2% |
| role + model, role, kind (now) | 43.4% | 55.4% |

The kind of work adds nothing to the role. The model adds a little, more for the cost than for the time; 525 of his
658 jobs ran on one model, so the gain can grow with more models in use. 119 jobs had no cost, 102 of them on the
engines that report tokens only (Codex, OpenCode), so a role on those engines had no cost estimate at all.

## Decision

1. Similar jobs (`task-estimate.ts rawFigures`): the same role on the same model, else the same role on any model,
   else the same kind on any role. A request with no role yet (the line under the user's message) still rests on its
   kind. `EstimateBasis` = `agent-model`, `agent`, `kind`; `agent-kind` is gone.
2. The model is the run's own for a strip and the backtest, the chat's for `app_create_chat`'s answer;
   `task_estimate` names a role only, so it rests on the role.
3. A job whose engine reported tokens and no cost counts at list price (ADR 0284, `standing.ts listCost`), its
   delegated children too (`treeCosts`). The read worker gets the prices as a table (`ChatManager.listPrices`).
4. The calibration by kind and the confidence from the spread stay (ADR 0186). The confidence is one step lower when
   a role was named and only other roles' jobs matched.

## Consequences

- Four estimates in ten hold, as before: a job's time depends on the job more than on who does it. The figure is an
  order of magnitude; the Classificatori page keeps saying how often it held (since ADR 0291 the
  estimate chip's «?» does).
- The kind of work still picks the path (a short question, one agent, a tree) and the calibration.
- «Da ruolo e modello uguali» on the Classificatori page replaces «Da ruolo e tipo uguali» (the page left with ADR 0291).
- Tests: `test/unit/agents/task-estimate.test.ts`, `test/unit/agents/estimate-replay.test.ts`.
