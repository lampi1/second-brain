# ADR 0330 · The maps follow their chats: a box says what its pieces say, a step that is ok is «fatto»

Date: 2026-11-20 · Status: accepted (owner, issue #456, 2026-11-20: «a chat was working on a map element but the map
still showed it as "planned" … maps update themselves»; «for a step the ok status should read "fatto": "funziona" only
fits systems»; «the parent status should be derived from its children: all done = fatto, any in progress = in corso,
any blocked = bloccato») · Amends: ADR 0271 (who keeps a status current), ADR 0276 (a plan's step on a box with pieces
inside), ADR 0322 (the words of a status), ADR 0326 (what the progress reads)

## Context

A status on a project map changed only when somebody wrote it: an agent with `project_map_update`, the Orchestrator
with an edit, or the app for the steps of a Strategist's plan (ADR 0276). A work chat the Orchestrator started for a
phase wrote nothing, so the phase stayed «previsto» while the chat worked on it, with no moving dot; the Orchestrator
had to set two boxes to «in lavorazione» by hand. The app already holds everything needed: the chat's state, its open
requests, its sub-chats, its report.

Two more things read wrong. A phase or a step that was done read «funziona», a word for a system. And a box with pieces
inside kept a status of its own, written apart from theirs: on the owner's maps a phase read done over steps still
open, and another read «previsto» over a step that was stuck.

## Decision

1. **A chat linked to a piece moves it, with no tokens** (`src/main/projectmap/follow.ts`, `service.ts`).
   - Linked on purpose: the chat said so (`project_map_update` `working_on`), or the Orchestrator linked it: `map`
     `{ project, on }` on `app_create_chat` and `app_assign_task` (left out on an assignment, the chat stays on its
     pieces: a project's work conversation goes on), or `app_project_map` `link` for a chat already there
     (`elements: []` unlinks). A chat the app bound only because it edited a piece's file moves nothing: that piece
     reads «da verificare», as before.
   - What a chat says (`sayOf`): at work (it runs, or a chat it delegated does) · on it (between two turns, or a
     partial report) · waits for the user (an open request of its own or of a chat it delegated, or its last answer
     says so) · failed · reported blocked · done (it reported done; a chat with no report to give is done when the app
     closed it after a turn that ended well) · nothing (never started, stopped by the user, closed by hand).
   - What is saved, one version by «app» per real change: «in lavorazione» when the work starts, «bloccato» on a
     blocked report, done when every chat on the piece is done. Only when what the chats say moved since the last
     time: a status an agent or the Orchestrator set by hand after it stays.
   - What is only shown, and saves nothing: stuck on the user («Tu») while a chat waits for him, stuck on the agent
     while every chat on the piece stands on an error. A question does not write a version. While a chat runs the app
     vouches for the piece: it never falls to «da verificare».
   - When the Orchestrator starts a chat, unlinked, in the folder of a map that tells a plan still open, the answer
     carries one line that says how to link it.
2. **A box with pieces inside says what they say together** (`src/shared/project-map-status.ts`), at every depth: one
   stuck = stuck (on the user when one of them is) · one under way = under way · one to verify = to verify · all done
   = done · some done and some still to start = under way · none started = planned. Its own saved status is never
   read; every save writes it from its pieces (`settle`), so the file tells what the drawing shows. A status sent for
   a box is ignored: it goes on the pieces.
3. **A status meant for a box** (a chat linked to it, a plan's step on it) lands on what holds one (`spread`). Under
   way saves nothing, since which piece is under way is not known: the live view marks the box `busy` and it reads
   under way while the work lasts (a field of the view only, never saved, dropped when read from a file). Done turns
   its pieces under way to done, and its steps not started too: a finished phase has finished steps; the parts of a
   system that nobody worked on keep what they say. Stuck turns its pieces under way to stuck, else its first step
   still open. A piece a chat is linked to directly is left to that chat.
4. **The words.** `ok` reads «fatto» on a phase or a step and «funziona» on everything else: on the boxes, in the
   panel, in the legend (both words on a mixed level), in the history lines the app writes and in the text the
   Orchestrator and the agents read.
5. **The progress reads only the pieces with nothing inside** (ADR 0326): a group is stuck or under way by its
   pieces, and «bloccato» and «tocca a te» list the pieces themselves, not the boxes around them.

## Consequences

- Maps saved before read right at once: nothing is migrated, the roll-up is computed when the map is shown or read.
- A map drawn with systems and parts in place of phases and steps (the owner's «Air su Linux») gets the roll-up, and
  still reads «funziona» on its parts: the word follows the kind. A redraw as phases and steps changes it.
- A plan's step on a system with parts no longer writes «in lavorazione» on the system: it shows it while the step is
  under way, and at the end only the parts that were under way turn done.
- A version per start and per end of a linked chat: the history grows with the work, not with its questions.
- The Orchestrator has to link the chat: the app cannot know which piece a new chat is for. The parameter sits on the
  two tools it already uses to start work, and the hint reminds it where a plan is open.
- Not done: no link from a chat's title or prompt by guessing; the waiting count of the projects list still reads the
  saved statuses; nobody tried it on a real PC with real chats.

## Tests

`test/unit/project-map-status.test.ts` (the roll-up, the owner's phase saved done over open steps, «da verificare» up
the boxes, a busy box, the words, the saved file, a status meant for a box, the progress), `test/unit/projectmap-follow.test.ts`
(what a chat says in each state, what the chats on a piece say together, start → wait → done → a new assignment, an
error and a blocked report, a chat linked to a box, a sub-chat at work, `working_on`, a chat bound by a file, unlink,
the Orchestrator's link and hint).
