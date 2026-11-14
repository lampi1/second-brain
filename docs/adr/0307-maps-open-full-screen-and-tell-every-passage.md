# ADR 0307 · The maps open full screen, tell every step and every passage, and are redrawn from a button

Date: 2026-11-14 · Status: accepted (owner, 2026-11-14: «le mappe quando le apro le voglio di default full screen, e
voglio che si capisca bene ogni passaggio e vorrei anche poterle aggiornare da un tasto volendo, secondo me hanno un
gran potenziale ma il contenuto testuale non è molto dettagliato») · Builds on: ADR 0271, ADR 0275, ADR 0276, ADR 0302 ·
Amends: ADR 0276 (where the map opens when the user opens it)

## Context

A box on a project's map held a name, one line of description (300 characters at most) and a status. A link held a
label of a few words. That is enough to recognise a piece, not to understand it: the map said that «Ordini» talks to the
payment gateway, not what it sends, what comes back, or what happens when the payment fails. A plan's steps were chips
with a title cut to fit; what a step waits for, who does it and how far it is had to be read elsewhere. The map was
redrawn only when the user asked the Orchestrator in words. And it opened as a page beside the Orchestrator's column,
where a drawing of ten boxes is small.

## Decision

1. **Opened by the user, the maps take the whole screen.** The «Mappe» button (top bar and the Orchestrator's head),
   Ctrl+Shift+S and the palette call `openMaps()`, which raises `ui.mapsFull`; the view reads it once, goes full screen
   and clears it. Esc leaves the map where it was before: a page beside the Orchestrator. When the Orchestrator opens
   the map (`app_project_map` open → `ui:command maps`) it stays beside its column, because the user is talking to it.
2. **Every piece has a longer text.** `details` on an element (1500 characters) and on a link (800): how it works in
   plain words, paragraphs kept. The box on the drawing stays short. A redraw that leaves `details` out keeps the old
   text, an empty string removes it; the Orchestrator's edit ops (`app_project_map` edit) take it too. The brief for the agent that draws the map asks
   for it on every element and link it understood, and tells it not to invent.
3. **A click tells the piece in full, at the side.** «Come funziona» (the details, or how to get them when nobody wrote
   them), its parts, «Cosa entra e cosa esce» (each link in and out, with its own text), the plan's steps on it. With
   nothing picked inside a system, the side tells that system. A link's label is a button: it tells what passes on the
   arrow; an arrow that stands for several links (`LevelEdge.ids`) tells each one.
4. **A plan's step is told in words.** Under the strip of ADR 0302, the step under way in full: when it starts («Parte
   quando è finito il passo 1», «Va insieme al passo 4»), how far it is («in corso da 10 min», «fatto in 5 min»), who
   does it, on which box, its chat. A click on any step tells that one; «Tutti i passi» tells them all; a plan that
   waits for the user's ok shows them all from the start. The view carries what the plan already knows
   (`MapFlowStep.detail`, `chatIds`, `startedAt`, `endedAt`, `added`): no new tool, no token.
5. **«Aggiorna» asks for a redraw.** The button sends the Orchestrator a message, as the user's own (ADR 0275), that
   asks to have the project read again and the map redrawn with the details, keeping ids and corrections. The button
   waits until a new version of that map is saved. It costs tokens, and the tip says so; nothing is redrawn by itself.
6. **Agents read one piece without the whole map.** `project_map_read` and `app_project_map` read take `element`:
   that piece in full (`elementText`). The map's text stays short.
7. **The drawing is never fitted too small to read.** By itself the view does not go under 62 %: a tall level starts
   from its top and the wheel moves down it. ⤢ still shows the whole level.

## Consequences

- A map drawn before this change has no details: each piece says so and points at «Aggiorna». Nothing is migrated.
- The details are as good as the agent that reads the project; a wrong one is corrected like the rest, through the
  Orchestrator.
- ADR 0276's «the map is a page beside the Orchestrator, never over it» now holds after Esc and when the Orchestrator
  opens it; opened by the user it starts over everything.
- Tests: `test/unit/project-map-details.test.ts`, `test/unit/plan-flow.test.ts`, `test/e2e/project-map.spec.ts`
  (e2e runs with reduced motion and, headless, may not get the OS full screen: the view still covers the window).
