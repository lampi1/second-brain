# ADR 0322 · Project maps told as a line of phases and steps, with a richer and wider panel

Date: 2026-11-18 · Status: accepted (owner, issue #443: «Project maps should read as a simple sequence: phases one after
the other, and steps inside each phase one after the other. Today a map looks like a free graph and is hard to
follow»; thread «Risolvere le issue aperte»: «sistema anche l'ultima issue aperta sulle mappe») · Amends: ADR 0271 (the
kinds and the layout), ADR 0307 and ADR 0316 (the side panel)

## Context

A project map (ADR 0271) is drawn in the C4 style: people on top, each box under what calls it, the layout decided by
the links. That fits a system. A project that is a path of work (a migration, a delivery in stages) has an order, and
the layered drawing hides it: the boxes go where the links push them, an arrow between two steps is a link with a
status, so an arrow nobody confirmed reads «da capire», and nothing says «this comes after that». The side panel
(ADR 0307, ADR 0316) was 320 px beside the page and told how a piece works, never what proves it is done.

## Decision

1. **Two kinds.** `phase` and `step` join the kinds of an element. A phase is a stage of the project; a step is one
   thing done inside it (`parent` = the phase, or a step for its sub-steps). A part, a phase and a step can sit inside
   a system, an external system, a part, a phase or a step; the depth limit of ADR 0316 holds. A phase is drawn as a
   headed box, a step as a plain one.
2. **A level is a line when it tells a sequence.** `layoutOf`: the layout a level asks for (`layout` on the map for the
   top, on an element for the level inside it: `linear` or `auto`), else `linear` when every piece on the level is a
   phase or a step, else `auto`, the layered drawing of ADR 0271. A map drawn before this has no phases and no
   `layout`, so it is drawn exactly as before.
3. **The line.** The pieces in the saved order (the order of `elements`), left to right, each in its own place and
   numbered. The only split: a piece with `par: true` shares the place of the one before it, one above the other, and
   both wear «∥». Without the mark two pieces are never side by side. A line longer than six places goes on in the
   next row, read like text. Between two places the line draws the arrow to the following step itself, unless a link
   already joins those two boxes. The outside elements a level talks to stay in a row under the line.
   **No arrow runs behind a box.** The arrow to the place beside runs side to side. Any other one (a jump ahead, a way
   back, the passage to the next row, an arrow to or from an outside box) follows corners the layout computes
   (`LevelEdge.route`): out of a box by its right side, along the free lanes between the columns and between the
   rows, into the other box by its left side (an outside box by its top). A jump ahead runs over its row, a way back
   under it; the drawing grows by the lane when the first row or the last one needs it. The outside boxes sit on the
   line's own columns, so the lanes stay free down through their rows; of three pieces together, an arrow from the
   first to the third goes round the second. The layout lives in `src/shared/project-map-line.ts` (`lineOf`).
4. **The arrow to the following step.** A link of kind `next`: its label may be left out, it has no status of its own
   (saved as `ok`, never stale, a status update leaves it alone, and a map file written by hand with another status
   or a «waits for the user» mark on it is read as `ok`) and it is drawn plain, in no status colour. With a
   label it shows the label; without one it shows nothing: the order is in the numbers. So no sequence arrow is ever
   labelled «da capire», in the drawing, in the panel or in the text the agents read.
5. **A richer panel.** An element carries `proofs` (what shows it is done or how it stands: a line of text, and maybe a
   project file opened in the viewer or an http(s) address opened in the app's browser) and `refs` (addresses worth
   opening). The panel shows description, status, how it works, proofs, links, and the pieces inside in the line's
   order, each with its status and its number, opened by a click (the parts of a system are listed as before, without
   the status). A section with nothing to say is not drawn; a phase
   or a step without written details has no «Come funziona» line (the «premi Aggiorna» hint stays for the other kinds).
6. **A wider panel, resized by the user.** It starts at 400 px in both views, is dragged by its left edge (arrow keys
   on the handle, a double click for the starting width) between 280 and 760 px, and the width is remembered in the
   app's local storage. The grid keeps the drawing at 320 px at least whatever is stored, so the map stays usable at
   both ends; where the panel goes under the drawing (a narrow page) there is no handle.
7. **Tools.** `project_map_save` takes the two kinds, `par`, `layout` (map and element), `kind: "next"` on a link,
   `proofs` and `refs`; `project_map_update` changes status, note and actor of a phase or a step like any element;
   `app_project_map edit` takes `par`, `layout`, `before` (the piece it comes before: its place in the order) and
   `next` on a link, and a piece added inside a phase is a step; `before` names a piece of the same level. The map's
   text says which levels are a line and lists their pieces in order. A redraw that leaves an element's `layout` out
   keeps it, as it keeps the map's (the edit op with `layout: ""` takes it away); `par` is sent again with the order. «Annulla» brings back the map's layout too.

## Consequences

- The order of a line is the saved order: an agent that redraws must send the phases and steps in the order they
  happen. The edit op `before` moves one without a redraw.
- A level mixing phases with systems is layered unless it asks for `linear`.
- Proof addresses are http(s) only and proof files stay inside the map's root, as key files do (ADR 0316).
- The plans drawn on a map (ADR 0276, ADR 0302) are unchanged: their steps still show inside the boxes.
- Not done: phases written by the Strategist's plan (`plan_propose` still adds systems and parts); a drag of a box to
  reorder (only the Orchestrator edits a map, ADR 0276).

## Tests

`test/unit/project-map-linear.test.ts` (the line, `par`, the long line, the asked layout, an old map as before, the
kinds, the next link, proofs and refs, the edit ops, the file read back, the undo of a layout, and every routed arrow
checked against every box: a jump, a way back, the next row with pieces together, the outside boxes), `test/unit/project-map-side-width.test.ts`
(limits, the drawing's floor, the remembered width), `test/e2e/project-map.spec.ts` (the demo's «Gamma» map: phases in
a line, steps inside, the panel, the resize by keys and by drag, the way back under the line).
