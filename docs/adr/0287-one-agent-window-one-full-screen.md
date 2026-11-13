# ADR 0287 · One agent window, one full screen, a quiet top bar

Date: 2026-11-13 · Status: accepted, partly amended by ADR 0292 (the strip's row, the details row behind the ⓘ) ADR 0298 (the week on the top bar) and ADR 0301 (the maps button back on the Orchestrator's head) (owner, thread of 2026-11-13: «possiamo fare tutto molto meglio e molto più pulito,
specialmente l'affiancamento con il browser, poi il full screen deve essere veramente full screen sia per browser che
per chat e ci sono molte info e cose che si possono rimuovere che fanno solo rumore e confusione»; «rivedi anche le card
degli agenti devono essere perfette»; «UI dei pannelli delle domande dell'orchestrator pulitissima»; the proposals of
`v1-analisi/ui.html` approved as a whole) · Builds on: ADR 0068 (the strips), ADR 0269 and 0274 (the questions in the
Orchestrator), ADR 0211 (the role card's back)

## Context

A strip in the Grindhouse carried two rows of facts, a help mark, a close cross, a globe that opened its browsers as
separate tiles beside the chat with a colour to pair them, and two different ways to make it large: «maximize» (the
tile inside the page, with the sidebar, the top bar and the Orchestrator still around it) and «focus mode» (another
layout again). The top bar held some fifteen controls of the same weight. The Agenti page opened with three
paragraphs before the first card, and a card held boxes inside the box.

## Decision

1. **A strip is one line**: the character, the name, what the agent is doing now, its state. Stop, full screen and
   the menu appear under the pointer. The model, the costs, the estimate and the links are one row inside the opened
   strip. No help mark and no close cross on a strip: closing is in the menu and on Ctrl+W.
2. **An agent's chat and its browser are one window with three views**, «Chat», «Affiancati», «Browser»
   (`prefs.agentView`), with a line to drag between the two (`prefs.agentSplit`, 25% to 75%, a double click resets
   it) and one tab per page above the browser. An owned browser is never a row of its own; the one exception is a tab
   that needs the user under a closed strip. The old `prefs.browserOpen` is read once (open → «Affiancati») and
   `prefs.pairSplit` is dropped.
3. **There is one full screen and it covers the whole app** (`components/FullScreen.tsx`): F11 and Ctrl+Shift+F are
   the same mode, for a chat and for a browser, with the same three views. It replaces the page instead of lying over
   it, so no native browser view is left drawing under it. Ctrl+R shows the Orchestrator as a column beside it, and a
   new question opens that column by itself; Esc closes the column first, then the full screen. `app_ui maximize`
   leads to the same mode and never moves the keyboard.
4. **The top bar keeps what is used every minute**: back and forward, the maps, the search, the usage (today and the
   5-hour window; the week only from 70%), «Da rispondere», «Ferma tutto», the bell. An engine's mark shows only while
   it is signed out and the maintenance only while it runs. Everything else (new browser, run the maintenance,
   credentials, engines, language, shortcuts, all the settings) is one menu under the gear.
5. **A question in the Orchestrator is a plain row**: no coloured side stripe, no key hints in its foot.
6. **A role card's front is one surface**: the origin only when the user changed the role, the status only while it
   works or is on trial, engine, model and skills as one line of text, level, performance and the four numbers
   divided by hairlines, the "?" marks only under the pointer or the keyboard focus. The front gives the card its
   height and the longer back scrolls inside it. On the page the cards come first: the count is in the header with the
   explanation behind its "?", the pointer to Proposte shows only while a proposal waits, and the nightly review
   switch is one row under the grid.

## Consequences

- The strip's testids for the removed controls are gone (`chat-x-*`, `chat-help-*`, `topbar-more`, `topbar-lang`,
  `nav-recent`, `orchestrator-help`, `orchestrator-maint`); `chat-browser-*` is now the «Affiancati» view button.
- `FocusView.tsx`, `LangSwitch.tsx` and the strips' action row are removed, with their texts.
- The Guida cards «La Grindhouse», «Le deleghe tra ruoli» and «Costi e limiti di utilizzo» describe the new layout.
- The e2e specs that click the removed controls need the new ids; e2e is not a merge gate (rule 7), so they are
  listed for the next full run on main.
