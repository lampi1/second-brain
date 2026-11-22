# ADR 0335 · A line of phases and steps is drawn top to bottom, with parallel groups in their own frame

Date: 2026-11-22 · Status: accepted (owner, through the Orchestrator: «the graph must never wrap to a new row. Lay the
whole map out vertically (top to bottom: single steps one under the other, a parallel group as side-by-side columns
inside its frame, then joined). Also make parallel group colours readable: the frame/label colour must signal
"parallel" independently of each step's status colour»; on the mockup: «Il primo è il migliore»; «aggiorna anche le
istruzioni di pianificazione dello Strategist. Deve dire per ogni passo da quali dipende, raccogliere in un gruppo
parallelo i passi indipendenti e delegarli in parallelo quando possibile, non solo disegnarli») · Amends: ADR 0322
(point 3, the line), ADR 0302 (`par` on a plan step)

## Context

ADR 0322 drew a level of phases or steps as a line left to right that went on in the next row after six places, with
`par: true` stacking a piece under the one before it. Real plans (Air Refactoring: 2.1–2.5 together, then 2.6) read
badly: a wrapped row looks like a new branch, a stacked pair looks like two separate places, and nothing told where
the parallel work splits and joins again. The steps of a phase were seen only after a click into it.

## Decision

1. **Top to bottom, never wrapping.** The places of a line sit one under the other, centred on one axis, in the saved
   order. `LINE_MAX` is gone: a long line only grows downwards; the canvas already opens a tall level from its top.
2. **A parallel group is a frame.** Consecutive pieces joined by `par: true` sit side by side, top aligned, in a dashed
   frame labelled «∥ N in parallelo». Its colour (`--pm-par`, pink; darker in the light theme) means «together» and
   is no status colour; status colours stay on the boxes. A split point on the frame's top edge and a join point on its
   bottom edge, each drawn only where an arrow passes; the arrows into and out of the group (`fan`) run through them in
   the same colour. The legend gains the frame swatch when a level has a group.
3. **A phase is drawn open.** At a level of phases, a phase whose pieces are all steps on a line is a frame with its
   number, name, status, count and bar on the head, its steps laid out inside it (one level deep: their sub-steps stay
   a box to click). A click on the head enters the phase as before.
4. **Arrows never cross a box.** The arrow to the next place goes straight down or through the split and join rails;
   a jump, a way back and an arrow to an outside box run along a lane on the right of the column.
5. **The Strategist plans with dependencies.** Each step's `detail` says which steps it depends on («dopo 1, 2» or
   «subito»); independent steps are one group (`par: true` on all but the first); a whole group is delegated in one
   `agent_delegate` call so it really runs at the same time, and a step starts only when what it depends on is done.

## Consequences

- `levelOf` returns `groups` and, for an open phase, its steps with `in` = the phase; `lineOf` takes the open
  sub-levels. Tests: `test/unit/project-map-linear.test.ts` (order, groups, frames, no arrow behind a box) and the
  phases e2e in `test/e2e/project-map.spec.ts`.
- Maps with no phases or steps are drawn as before (layered). Existing maps with `par` simply get the frame.
- The owner's maps Air Refactoring, Air su Linux and Air MCP were redrawn as phases and steps with their groups.
