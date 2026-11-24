# ADR 0343: The plan is its map, the maps are a list

**Status:** Accepted (2026-11-24). Screens of ADR 0342. Amends ADR 0108 and 0312 (the plan's steps on the strip), 0269 (the
plan's card among the questions), 0276 and 0326 (a plan approved on the project map).

## Context

The owner, 2026-11-23: «il piano che propone deve essere solo la mappa non quella UI strana con gli agenti uno sotto
l'altro, l'approvazione si fa nelle mappe», and «le mappe devono essere ben navigabili perchè ce ne saranno tante». The same
steps were listed in three places (the questions' card, the strip, the project map's column), each with its own buttons.

## Decision

1. **One place for a plan: its work map** (`components/work-map/`). A box per step with its role, model and preset, the
   steps of one turn side by side, when it is done, the history. The stacked lists and their code are deleted:
   `PlanApproval.tsx`, `project-map/PlanCard.tsx`, the steps of `StrategyPanel.tsx`.
2. **The buttons are `WorkMapInfo.can`, nothing else.** «Approva e parti» and «Approva, parti dopo» are two buttons;
   `planAt` goes with both, so an approval is always of the plan on screen. «Cambia il piano» asks what in words.
3. **Elsewhere one line.** Strip: a dot per step, the count, «apri mappa». Orchestrator's row: the job, the count,
   «Apri la mappa». Project map: the jobs that touch it, each opening its map; the steps stay drawn inside their boxes.
4. **In words where there is no screen.** The phone and Remote Control keep the steps as text with Sì / No, and a typed
   approval counts as before (ADR 0274, 0275).
5. **The list** is the «Lavori» view of Mappa, place `lavori` or `lavori/<id>`: by status (what waits, under way, stopped,
   planned, ideas), the finished in their own tab. The project is a label and a filter; search reads titles, ideas and steps
   in both tabs; search, filter and order stay when the user comes back from a map.
6. **Seen on opening.** A finished map the user opens moves to the archive at once and stays on screen.
7. **A plan proposed on a project map opens its work map** where the project map opened before, at the same moment.

## Consequences

- The doubts of a map and who answered them have one place ready, `work-map/MapDoubts.tsx`, empty until that data exists.
- The screens read the live fields of a box when they are there and need none of them.
- The demo has more than twenty maps in every state through `__sbDemo.workMaps()`; its usual seed is unchanged.
