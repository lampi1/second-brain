# ADR 0292 · The strip: a state dot in front, time and cost against the estimate always in sight

Date: 2026-11-13 · Status: accepted, partly amended by ADR 0293 (the character is back, the dot on its corner) and ADR 0311 (the strip became a square bench) (owner, thread «Rifare la UI della Grindhouse»: shown three other layouts and a
drawing of the current one, he picked the drawing: «mi piace proprio questa … con questo identico stile e pulizia …
tieni le stime di tempo e costi come info sempre visibile nella strisciolina») · Amends: ADR 0287 (the strip's row and
the open window's details row)

## Context

After ADR 0287 the owner still was not convinced by the Grindhouse. Asked for alternatives, he chose none of the three
(inbox, board, Orchestrator in the centre): he chose the plain drawing of the current layout. What the drawing had and
the app did not: rows edge to edge with a hairline between them, a coloured dot in front instead of the character,
one quiet pill on the right, an open window with no row of chips under its head.

ADR 0287 showed a strip's numbers only out of the norm. The owner wants them always.

## Decision

1. A strip starts with a dot in the colour of its state (amber when it waits for the user). The character stays in
   full screen, on the cards of the delegation tree and in the sidebar.
2. On the right the strip always shows the work time and the cost so far, each next to its estimate when there is
   one: «22 min / ~19 min · 1,84 $ / ~0,60 $». A figure past its estimate turns amber (time: past it; cost: past 1.5
   times, as before). The estimate is shown for an ended run too. Since 2026-11-13 (the owner: «voglio vedere il
   modello e effort nelle striscioline degli agenti») the model and the effort the chat runs with stand before the
   figures in plain words, on a root strip and on a delegated row: «Opus 5.5 · high» (`StripMeta.tsx`; the effort
   as the engine reports it or as the last turn sent it, never the one only asked for).
3. The state is a pill only when words are needed (waiting, error, queued). «Finito» is the little person alone; the
   word stays for screen readers. Since 2026-11-13 (the owner, on a screenshot of his app: «non so perché vedo "in
   attività" nel comando e non nella strisciolina degli agenti») a working chat says «In attività» on its strip and
   on a delegated row (one just started too), in the same plain coloured words as the rows of what it started
   (point 6), not a pill; a chat whose turn is over while a sub-agent still works says «aspetta sotto-agenti» the
   same way. On a narrow strip the model text is the part that is cut (its tip says it whole). The
   violet «ripresa dopo il riavvio» chip is gone from the strip (the owner, the same message: «non serve … è
   inutile»); the line above a chat the user started («Ripresa dall'app dopo il riavvio · 09:12», ADR 0102) stays.
4. Rows run edge to edge of the page with a hairline between them; the area heading is a small label. The open window
   is a panel between two hairlines, no card and no focus border.
5. The open window's details row (version, model, the full estimate chip, context, links) opens from the ⓘ, in the
   column as in full screen.
6. A sub-agent's state, under a strip and in the Orchestrator's column, is plain coloured words, not a second pill.

## Consequences

- The amber «0,35 $ · stima 0,14 $» text of ADR 0287 is gone: the same fact is the amber figure in the pill.
- The estimate chip with its «?» is one click further (ⓘ).
- The top bar and the sidebar are unchanged; in the Orchestrator's column only the sub-agents' state changes (point 6).
- Demo chats carry a work time, so the screenshots show both figures.
