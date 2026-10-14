# ADR 0044 · The questions window is one centered modal, no waiting strip, answers in any order

Date: 2026-10-14 · Status: accepted · Amends: ADR 0035 (the waiting strip), ADR 0019/the questions window's
"not modal while the user types" placement

## Context
The user, 14/10: "basta la modale centrale non anche quella in alto a sx che se clicco mi apre la modale centrale",
"il widget delle domande in coda fa schifo non serve c'è già in alto il «da rispondere» che va benissimo quello",
"voglio poter rispondere dopo a una domanda ma rispondere subito a un altro, ora mi sembra che posso rispondere solo in
sequenza partendo dalla prima". The questions window, when it showed while the keyboard was in a field (the Regia's
input, most of the time), had no backdrop and sat on the half of the screen away from that field, beside the Regia
widget: top left with the Regia open. A click turned it into the centered modal: two looks of one popup. The layer's
strip ("N richieste da rispondere") repeated the top bar's counter. The window always showed the oldest request first;
the others were names on "Poi:", not clickable.

## Decision
- **One look: the centered modal.** The questions window always has its backdrop and sits in the middle. The typing
  guard is unchanged (a request waits as the pill while the user types; once they stop it shows and takes the keyboard
  only if no field has it): when the field keeps the keyboard, a note in the window says so, and a click anywhere on it
  or on the backdrop (or Ctrl+J) gives the card the keyboard. The backdrop never closes it.
- **No waiting strip.** The global layer shows request cards and event toasts only (`OverlayModel.strip` is gone);
  what waits is counted by the top bar ("Da rispondere N" while "Rispondi dopo" is on, else "Prossima cosa per te N").
  The chime on every new request stays.
- **Any order.** Under the card, "Altre in attesa:" lists every other waiting request as a button (chat and what it
  asks); a click shows that one now, with the keyboard, the rest stay. After an answer the window goes back to the
  oldest still waiting. "Rispondi dopo" / Esc are unchanged (everything waits in "Da rispondere"); the top bar's
  counter (or Ctrl+J) opens the window, and from there any request is one click away.

## Consequences
- Testids `layer-strip` and the window's `data-free` are gone; `qwin-pick` is new. e2e: `questions.spec.ts` (centered
  while typing, any order), `answer-later.spec.ts` (no strip, pick another), `layer.spec.ts` (no strip after Esc).
- `answer-later.spec.ts` gets 120 s: two app launches took 47 s alone and timed out under the parallel e2e (also on main).
