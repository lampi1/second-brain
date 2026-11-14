# ADR 0307 · The Orchestrator takes half the window; a strip says the task and the state, the rest is a tooltip

Date: 2026-11-14 · Status: accepted (owner, 2026-11-14: «le striscioline devono essere belle anche meno lunghe, di
default voglio che l'orchestrator occupi sempre metà schermata circa, quindi le striscioline e anche tutte le altre
parti dell'app si devono adattare bene»; and four minutes later: «mi interessa vedere a colpo d'occhio cosa fanno a
livello di task e se sono in attività, il resto posso guardarlo da un tooltip informativo») · Builds on: ADR 0295
(the little people) · Amends: ADR 0068 (the column's width: wider on the Grindhouse, narrower elsewhere), ADR 0292
(time, cost, model and effort always on the strip), ADR 0293 (the delegated chat's row), ADR 0207 (Settings on a
narrow page)

## Context

The Orchestrator's column took a third of the window on the Grindhouse and less on the other pages. The owner works
mostly through the Orchestrator and wants it on about half the window, always. With half the window gone a strip is
short: in a 1366 px window the page is about 460 px wide, and a strip that carried the name, the task, the model and
effort, time and cost against the estimate, the state and three controls on one line ran out of the page. Other
pages did too, because their narrow layouts answered to the window's width, not to their own.

One day earlier the owner had asked for the model and the effort on the strips (ADR 0292). With a short strip he
chose again: at a glance the task and whether the chat is at work, everything else on demand.

## Decision

1. The Orchestrator's column is half the window by default, on every page (`lib/orchestrator-dock.ts` COLUMN_SHARE;
   the smaller share on the pages other than the Grindhouse is gone). The user still drags its edge and that width
   stays; the page always keeps 360 px (PAGE_MIN). A width saved before this decision is dropped once (DEFAULT_V 3),
   so everyone starts from the half.
2. A closed strip says, at a glance: who (the person and the name), the task with what the chat does now, and the
   state («In attività», «Ti aspetta», an error, a queue). Nothing else is written on it.
3. The rest is the tip of one small ⓘ mark beside the state (`components/StripInfo.tsx`): the task whole, then one
   line each for the model and effort, the work time and the cost so far next to their estimate, the context. The
   mark is amber when the work is past its estimate (time past it, cost past 1.5 times, as before) or the context is
   long, and the tip says which. The same tip is on the task's text. The mark takes the keyboard focus and has the
   whole text as its label. The global tooltip shows a tip's lines one under the other (`components/ui.tsx`).
4. Open, the window's head has no mark: the ⓘ among its controls opens the details row, as before (ADR 0292). The
   full screen has the room and keeps the figures on its bar (`StripMeta.tsx`).
5. A delegated chat's row has the same mark in place of its figures. A sub-agent's or a command's row keeps agent,
   task and state; its kind, when it started and for how long are in its tip, and on the row only when there is
   room (under 520 px they are clipped, not removed, so a screen reader still reads them). A command's «|» stays
   readable in a tip (`lib/tips.ts` tipOf, splitTip).
6. Under 640 px a strip takes two lines, inside the height the person already gives it: name, state, mark and
   controls on the first; the task and what it does now on the whole second. The open window's head folds the same
   way and its details row wraps.
7. A page answers to its own width. Every page host (`.bx-page`) is a query container; a narrow page keeps a 16 px
   gutter and its grids fold by the page's width. Fixed where it showed: Settings (its two columns never became one,
   because the page was its own query container: the host is now; the sections wrap on top instead of scrolling
   sideways), Memoria (the four counts two by two), a skill's and a memory file's head (the actions go under the
   tabs or the title), Andamento's context rows, Registrazioni (the list over the transcript), the connectors hub.

## Consequences

- The model and effort, time and cost are one hover away on a closed strip, no longer always in sight. This reverses
  ADR 0292's «always on the strip» and the owner's wish of 2026-11-13, by his own later choice.
- A strip no longer shows at a glance that a job is past its estimate in words: the amber mark says there is
  something to look at.
- In a narrow window the Orchestrator leaves the page its 360 px and takes the rest, which is less than half.
- e2e specs that read the figures on a closed strip read the mark's tip instead.
- Tried in the demo at 1920, 1366 and 1100 px wide, every page; not on the owner's PC.
