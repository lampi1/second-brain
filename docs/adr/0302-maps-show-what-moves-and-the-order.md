# ADR 0302 · The maps show what moves, the order of the steps, and the passage between levels

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «vorrei che nelle mappe fosse evidente con una discreta
animazione la parte in corso se presente se non sono tutte finite, che si capisse quando i lavori sono in parallelo o
uno dopo l'altro, e che la transizione da una mappa padre a una mappa interna fosse meglio, e cambia quel dropdown con
una selezione laterale tipo quella della sezione giornale») · Builds on: ADR 0271, ADR 0275, ADR 0276

## Context

A project's map showed each box's status as a colour, with nothing that told «somebody is on this right now» from
«this is marked in progress». A plan drawn on the map listed its steps inside the boxes, with no sign of which wait for
which: a plan had no notion of parallel work, only an ordered list. Entering a system swapped the drawing in one frame.
With more than one project the map was picked from a native menu.

## Decision

1. **What is worked on right now moves, quietly.** A box with a plan step under way, or with an agent at work bound to
   it (or to a part inside it), breathes: a soft ring every 2.4 s, and its status dot beats. A line whose status is «in
   lavorazione» carries a small mark that travels along it. The legend gains «ci lavorano ora» only while something
   moves. Nothing moves in a past version, and under `prefers-reduced-motion` the ring is still.
2. **A plan step may go together with the one before it.** `plan_propose` and `plan_update add` take `par: true` on a
   step; `planWaves` (shared/strategy.ts) gives each step its turn: a step opens a new turn unless it is `par`. The
   map's view carries every step in order with its turn (`MapPlan.flow`) and each work its turn (`MapWork.wave`).
   A step is shown as going in parallel when it shares its turn, or when it is under way together with another step:
   what happens wins over what was planned.
3. **The plan reads left to right.** Over the drawing, the turns in order with an arrow between them; the steps of one
   turn stacked under «insieme». A step under way beats; a click on a step shows the box it works on. In a box each
   step wears its turn («2», «2∥» when in parallel), and a box with more than two steps shows the one under way.
4. **A passage, not a cut.** A click on a system zooms the view into its box for 200 ms, then the level inside comes in
   from slightly smaller; going back up the level comes in from slightly larger and the box just left is ringed for a
   moment. With `prefers-reduced-motion` the level changes at once.
5. **The projects are a list at the side**, as the newspaper's sections: a dot (amber when something waits for the
   user), the name and how many wait. Beside the Orchestrator's column the agents go under the drawing and the list
   stays at the side; under 700 px it is a row of pills. One project: no list.

## Alternatives

- Deriving parallel work only from what runs at the same time: it says nothing before the plan starts, which is when
  the user approves it.
- Dependencies between steps (`after: [1, 2]`): more than the Strategist needs to say and more to check; a turn is one
  boolean.
- An AI mark on boxes for what is wrong: rejected by the owner in ADR 0276, not reopened.

## Consequences

- Plans saved before this have no `par`: every step is its own turn, as they were shown.
- The Strategist's flow text gains one sentence on `par` (the tool schema carries the rest).
- The demo brain gets a second small project (`beta-crm`) so the list shows in the demo and in the e2e.
- Untried on a real PC with a real model.
