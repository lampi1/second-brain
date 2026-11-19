# ADR 0328 · An open card takes what he writes in the Orchestrator's field

Date: 2026-11-19 · Status: accepted (owner, 2026-11-19: «non capisco perché se mi compare una domanda dello stratega ad
esempio e rispondo dal campo dell'orchestrator la domanda non scompare» · 2026-11-12: «da espansa voglio vedere sempre
l'input dell'orchestrator scrivibile, è quello il campo libero» · «se rispondo direttamente all'orchestrator o
all'agente il pannello deve sparire, però … se la risposta che do all'orchestrator è della domanda non di altre robe»)
· Amends: ADR 0274 (written to the Orchestrator, it decides) · Builds on: ADR 0327

## Context

A row opened in the Orchestrator's column has no answer box: its card says «Per rispondere con parole tue scrivi qui
sotto, nel campo dell'Orchestrator» (ADR 0274). What he wrote there went to the Orchestrator as a message, with the list
of the open rows for its engine only; the row closed only if that engine then called `app_resolve_question` with his
words. So the answer waited in the queue while the Orchestrator worked, and after that it depended on a model's choice.

Read on the owner's PC on 2026-11-19 (read-only: the Orchestrator's transcript and the app's log of the day; the app
ran main bbe33dc, with ADR 0327):

- 15 of his messages to the Orchestrator carried the list of open rows; the Orchestrator called
  `app_resolve_question` in 4 of them. No call was refused for his words («bloccato», «non è arrivata»): one failed on
  a request already closed.
- In 4 messages he was answering a row and the Orchestrator did something else: it passed his words with
  `app_send_to_chat` (twice; once also with `app_assign_task`), which a chat does not read while its question is open,
  or it answered him itself and left the row (the message of 19:03 to a Strategist's plan: «vorrei fosse chiaro anche
  lo sdoppiamento della tab cartella l'hai compreso?», read as a question because of how it ends).
- A plan changed that way is proposed again: the same row with a new text, four times in eleven minutes on one chat.

Not known: whether the card was open in each of those cases (the transcript does not say what was on screen).

## Decision

1. **While a row's card is open, the Orchestrator's field is that row's answer box** (`renderer/lib/field-answer.ts`,
   `ChatInput.tsx`, `QuestionsWindow.tsx` publishes the open card in `ui.qwin.card`). His words go straight to the row,
   the same way a click on one of its buttons does, and the row leaves at once: an engine question takes them as the
   answer of each of its questions (`chat:answer`, with the app's note of ADR 0327); a plan takes them as what to
   change, or as the ok when the whole text is an approval (`isPlanApproval`, `chat:plan`). Nothing waits for the
   Orchestrator's engine, which learns of the answer as it does of a click.
2. **The field says so.** A line over it: «Quello che scrivi va a ‹chi chiede›, come risposta. Per scrivere
   all'Orchestrator chiudi la domanda.»; the placeholder names who asks; a toast confirms where the answer went.
3. **Still the Orchestrator's, also with a card open**: a request to explain the question (`asksToExplain`, ADR 0327:
   the Orchestrator explains and the row stays), a «/» command, a message with images, a «Fast» or «Plan» message, and a
   draft another page put in the field («Discuti», «Cambia qualcosa» on a map). With another chat's card open they are
   a message, never the answer to the Orchestrator's own open question.
4. **With no card open nothing changes**: the Orchestrator decides whether his message answers a row (ADR 0274). Two
   things help it there. The note with the open rows now says that what he wants changed or added in one is its answer,
   also when it ends with a question, and that an answer never goes with `app_send_to_chat`. And `app_send_to_chat`
   from the Orchestrator to a chat that waits on its own question, or whose plan waits for his ok, still sends, and its
   result says that the row is still open and how to close it (`waitsOnUser` in `appctl/tools.ts`; not for a delegated
   chat, which its parent answers).

## Consequences

- An answer typed with the card open no longer shows as a bubble in the Orchestrator's chat: it is in the chat that
  asked, and the Orchestrator reads it as quiet news.
- A text typed with a card open that is neither an answer nor a request the app recognises as «explain» reaches the
  chat that asked, as his words with the note of ADR 0327. The line over the field is what tells him where it goes;
  closing the card gives the field back to the Orchestrator.
- «Sì procedi, ma …» on an open plan is a change (the plan comes back revised), as it was in the card's own box before
  ADR 0274: only a whole approval starts a plan.
- With no card open the row still closes only if the Orchestrator passes his words on. The counts above have to be
  taken again after some days of use.
- Untried on a real PC. Tests: `test/unit/field-answer.test.ts`, `test/unit/appctl-waits-on-user.test.ts`,
  `test/e2e/orchestrator-ask-input.spec.ts` (frozen demo, with a screenshot).

## Alternatives

- **Deliver his words to the row whenever exactly one row is open, card closed too.** Refused: he also writes to the
  Orchestrator about other things while a row waits («dammi subito le credenziali adesso», with a plan open, the same
  day), and those words would become an answer.
- **Refuse `app_send_to_chat` to a chat that waits on him.** Refused: the Orchestrator also writes to such a chat for
  other reasons; the message is delivered after the answer and the result says so.
- **Only stronger words in the Orchestrator's role.** Refused: the rule was already there and was not followed in 4
  cases of one day; the open card is a fact the app has, no model needed.
