# ADR 0343: The plan is its map, the maps are a list

Status: superseded by ADR 0363 (the plans replace the maps) · it was: accepted (2026-11-24). Screens of ADR 0342. Amends ADR 0108 and 0312 (the plan's steps on the strip), 0269 (the
plan's card among the questions), 0276 and 0326 (a plan approved on the project map). Amended by ADR 0346 (a box shows
role and preset, never a model).

## Context

The owner, 2026-11-23: «il piano che propone deve essere solo la mappa non quella UI strana con gli agenti uno sotto
l'altro, l'approvazione si fa nelle mappe», and «le mappe devono essere ben navigabili perchè ce ne saranno tante». The same
steps were listed in three places (the questions' card, the strip, the project map's column), each with its own buttons.

## Decision

1. **One place for a plan: its work map** (`components/work-map/`). A box per step with its role and preset (no model since ADR 0346), the
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
8. **Mappa opens on «Lavori»** (the owner's answer, 2026-11-23). A place that names a view, a project map or the links still
   lands there; `app_project_map open` too.
9. **A map and its boxes say the live status** (ADR 0342, `LiveBits.tsx`): what is being done, for whom it waits, what failed
   or was lost, since when nobody confirms it, why it stopped. A map that waits for the user stands in «Aspettano te»
   whatever its state. Amber is the user's alone.
10. **The doubts and the questions are on the map** (ADR 0344, `MapDoubts.tsx`): every doubt, its state, what closed it and the
   source; every question of its chats, its way up, who answered and why. With a doubt open the approval buttons stay in
   view, off, with the reason; `approve`, `keep` and `start` are refused in main too.

## Consequences

- The demo has more than twenty maps in every state through `__sbDemo.workMaps()`; its usual seed is unchanged.
