# ADR 0300 · Quote what is on screen: select a text, right click, it is in the prompt field

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «vorrei che nell'orchestrator e in generale ovunque potessi
selezionare il testo e citarlo nella risposta: devo selezionarlo, fare click destro e il testo si copia nel campo del
prompt») · Builds on: ADR 0274 (the Orchestrator's field is the free field), ADR 0297 (a right click on a little
person)

## Context

To answer about one sentence of a long reply the owner had to copy it and paste it in the field, or describe it. He
wants to point at it: select it, right click, and find it quoted where he writes. The app has no context menu, and the
only right click that means something is the one on a little person (ADR 0297).

## Decision

1. A right click on a selected text puts it at the end of a prompt field as markdown quote lines (`> `), with an empty
   line under it where the caret waits; nothing is sent. What was already written stays above; a second quote goes
   under the first. The selection is cleared, so the next right click is a plain one.
2. Which field: the one of the chat the text is in (the Orchestrator's own text, an open work chat's text), the
   Orchestrator's for everything else (a brain page, a panel, a file). The Orchestrator's column opens if it was
   closed, also beside a full screen.
   A text in a dialog that covers the field (an artifact opened large, the first setup) is added without taking the
   keyboard out of the dialog, and a notice says in which field it waits.
3. It is a quote only when the click lands on the selected text (the thing clicked is part of the selection and the
   pointer is on one of its lines, 4 px of slack) and not in a field the user types in, and only when that text was
   already selected when the button went down (where the press itself selects a word, as on macOS, that word is not
   quoted). A selection left somewhere else, or scrolled under another thing, never takes that thing's right click:
   a little person still gets its whack. With a selection under the pointer the quote wins.
4. It works wherever the app lets a text be selected (messages, thoughts, tool output, code, brain pages): what can be
   selected is not widened here. A quote is at most 6000 characters, then `[…]`.
5. Renderer only: one listener on the page (`actions.ts` `startQuote`), the rules in `lib/quote.ts`, the drafts in
   `ChatInput.tsx` `quoteInDraft`. No IPC, no tool, no setting. The quote is plain text of the message: the engines
   read `>` lines as a quote by themselves.

## Consequences

- No menu to choose from: the right click on a selection does one thing. If a «Copia» is ever wanted there, it needs
  a menu and this becomes one of its rows.
- The pages of the internal browsers are not the app's page: a text selected in a site is not quoted.
- An HTML report in the file viewer lives in a shadow tree, where the page's selection may read as empty: it may not
  be quotable (not tried).
- The context-menu key and Shift+F10 do not quote: only the mouse.
- A quoted text is part of the user's message, also where the app compares what the Orchestrator passes on with what
  the user said (ADR 0274): he chose to quote it.
- The user's own bubbles show the `>` lines as written, not as a styled quote.
- Tried in the demo (e2e `quote-selection.spec.ts`), not on a real PC.
