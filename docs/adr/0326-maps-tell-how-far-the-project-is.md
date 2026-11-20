# ADR 0326 · The maps tell how far the project is: a percentage, a progress card, the plan in the side panel

Date: 2026-11-19 · Status: accepted (owner, 2026-11-19: «nella mappa la parte in alto dei passi è completamente inutile
rimuovila occupa solo spazio … le mappe servono per tracciare l'andamento di un piano sarebbe bello ci fosse anche un
progressivo una percentuale e più dettagli nella parte dx») · Amends: ADR 0302 and ADR 0307 (where a plan's steps are
told), ADR 0276 (where «Approva e parti» sits), ADR 0322 (the side panel) · Amended by: ADR 0330 (what is stuck is read
from the pieces, not from the boxes around them)

## Context

A plan drawn on a map (ADR 0276) was told over the drawing: a strip with the turns left to right, the steps of one
turn stacked under «insieme» (ADR 0302), and under it a card per step (ADR 0307). With four steps open it took a third
of the window, and it stayed there after the plan was finished. The owner uses the maps to follow a plan, and nothing
on the map said how far the project was: no count, no percentage, no «we are here». The side panel told the picked
box, the paths and the agents, never the state of the whole.

## Decision

1. **Nothing over the drawing.** The strip and the step cards are gone (`PlanFlow.tsx` is now `PlanCard.tsx`). The one
   exception: while a plan waits for the user's ok, one line over the drawing names it and holds «Approva e parti» and
   «Cambia qualcosa» (`PlanAsk`), so the approval is in sight also where the panel goes under the drawing (a narrow
   page).
2. **A count read from the map** (`src/shared/project-map-progress.ts`, pure, no model and no token).
   - What is counted: the pieces of work with nothing inside them (a step, a part, a system or a document without
     pieces). People and external systems are context, never work; on a level that has phases or steps, whatever
     stands beside them (an environment, a document, a system) is context too. A level made of one piece only (a
     project box that holds the phases) is read as what is inside it. Done = status `ok`, as saved: a file edited
     later turns the box «da verificare» on the drawing but does not take the step back.
   - The percentage is done / all, whole; 100 only when every piece is done, never 0 once one is.
   - The groups are the top-level pieces, each with its own count and a state (closed, under way, blocked, to start).
     They are in order when the level is a line (ADR 0322), when it has phases and steps, or when its boxes are chained by their links from the first to the last with no fork and no way back (a
     map drawn as numbered systems joined by «poi»). In order, the map also says where the project is (the first
     group not closed) and what comes next (the first piece not started).
   - Under way = status `work`, or somebody works on it right now (a plan's step under way on it, an agent at work
     bound to it; a box with pieces inside is named itself when the work is bound to it and to none of its pieces). Stuck = every piece of any depth, and every link, with status `blocked`: the ones whose actor is
     the user are told first, as «tocca a te».
   - Which maps have a progress (`progressOf`): the ones told as phases and steps (the level is made of them, or
     every piece counted is a step: one step deep inside a system does not make the map a plan), and the ones whose
     top-level pieces are in order with something still to do. Any other map is a picture of a system, not a plan: it has no progress
     of its own, and the percentage shown is the one of the plan under way on it. `countOf` counts any level.
3. **Where it shows.**
   - The header: «Avanzamento», a small bar and the percentage, always in sight (the map's own, else the plan's).
   - The side panel opens with the progress card (`MapProgress.tsx`): the percentage in large type with its bar, the
     count («4 di 10 passi fatti · 1 di 4 fasi chiuse», and how many nobody knows), then «Siamo a», «In corso» (with who
     works on it and the piece's note), «Tocca a te», «Bloccato», «Poi», and every phase with its bar and its count. A
     click on a piece shows it on the drawing, a click on a phase enters it. With a box picked, a path walked or
     inside a system the card folds to its first three lines; «Dettagli» opens it there.
   - Each box with pieces inside wears its count in its foot («2/4») and a thin bar along its bottom edge; its panel
     shows the same count with a bar.
   - The history slider plays the progress too: a past version shows the count it had.
4. **The plan in the side panel** (`PlanCard`). Its phase, its title, the percentage with the bar, «1 di 4 passi
   fatti · ora il passo 2 · 1 bloccato · 1 aspetta te», when it is finished («Finito quando»), then one row per step in
   order: its mark, its title, how far it is. A row opens on a click and tells what ADR 0307 asked for: what the step
   does, when it starts (after which steps, together with which), who does it, on which box (the button shows it on
   the drawing), the chats working on it. A plan that waits for the ok has every row open; a plan under way the step
   being done, and it follows the plan until the user opens or closes a row. A step waits for the user when a chat
   working on it asked something. A plan waiting for the ok comes before the progress card, the others after it.
5. **The same number for the agents.** `project_map_read` and `app_project_map read` end with one line,
   «Avanzamento: 3 di 8 passi (38%); siamo a «…»; in corso: …; aspettano l'utente: …; poi: …», on the maps that have a
   progress: the Orchestrator answers «a che punto siamo» with the number the user sees.

6. **The drawing keeps its height on the page.** Outside the full screen, with the panel beside the drawing, the
   drawing is as tall as the window allows and the panel scrolls beside it. Before, the panel's content stretched the
   row: a long panel (a plan with every step open, many agents) made the drawing taller than the window and pushed
   the boxes out of sight. Where the panel goes under the drawing (a narrow page) nothing changes.

## Consequences

- The drawing gets back the height the strip took; a finished plan no longer covers anything.
- «Insieme» as a group over the drawing is gone. Which steps go together is still told: «∥» beside the turn on the
  boxes, and «Va insieme al passo 4» in the open row.
- A click on a step's row no longer moves the drawing; the «su <riquadro>» button in the open row does.
- A holder's own status does not enter the count: a phase is closed when every step inside it is done, whatever the
  phase's status says. A phase with no steps counts as one piece.
- A chained map where everything works or nobody knows shows no progress, so a finished project drawn as chained
  systems loses its card at the end. A project told as phases and steps keeps it at 100 %.
- Not done: the Strategist's plan still adds systems and parts, not phases (ADR 0322); the plan card outside the map
  (`PlanApproval.tsx`) is unchanged; nobody tried it on a real PC with a real plan.

## Tests

`test/unit/project-map-progress.test.ts` (the percentage, the count of a map of phases, each phase's count and state,
where the project is, what is under way, what waits for the user, what is blocked, what comes next, a piece somebody
works on, a finished project, the count of one piece, chained systems, the maps with no progress, a plan's own count,
a step that waits for the user, the line of text), `test/unit/plan-card.test.ts` (a step in words),
`test/e2e/project-map.spec.ts` (the plan in the side panel with its percentage, the rows opened by a click, the line
with the approval, the «Gamma» map's progress card, a phase's count on its box and in its panel, a map without
progress).
