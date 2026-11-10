# ADR 0255 · Worker Sì/No questions answered from the phone (Telegram and Remote Control)

Date: 2026-11-10 · Status: accepted (owner, issue #370) · Builds on: ADR 0219 (Telegram phone bridge), ADR 0229
(Remote Control), ADR 0239 (relay_question)

## Context
A worker chat asked one Sì/No question (`Sì (consigliato)` / `No`, each with a description) while the owner was away.
Telegram showed only «serve il PC»: the engine puts the question in the request's title and detail too, so the phone
text held it three times plus the descriptions, went over the 600 characters a phone decision may show uncut, and lost
its buttons. The news to the Orchestrator ended with «Remote Control non supporta questa ricevuta», so the Orchestrator
did not use `relay_question` even though it exists for exactly this. The worker waited for the PC.

## Decision
- **One copy of each line** (`chats/phone-port.ts`): the phone text of a question lists title, detail, question and
  options once each.
- **A short form** (`PhoneDecidable.short`, `phone/buttons.ts buttonText`): a simple question whose full text does not
  fit uncut is sent as the question alone with the fixed `Sì` / `No` buttons (the owner accepts changing the format).
  Nothing is ever shown cut with buttons; a text with no short form that does not fit stays «serve il PC». The reserved
  check still reads the full text with descriptions and brief.
- **Typed answer on Telegram** (`buttons.ts textAnswer`): a bare «sì» / «no» (`shared/yes-no.ts yesNoOf`) answers an
  offered question when it is a Telegram reply to that question's message, or, without a reply, when it is the only
  open question, the last message the bot sent (`outbound.ts lastSent`) and the user wrote nothing else since. A plan
  is approved only with its button; a brain-rule permission (ADR 0254) can be answered like its button. Any other text, two open questions, a reply
  to another message, or a question already answered goes to the Orchestrator as before: free text is a clarification,
  never a Yes. The answer goes through the same checks as a button (live request, still simple, not reserved, once).
- **Remote Control** (`chats/orchestrator-wake.ts awayNote`): for a single Sì/No question of an engine's own tool the
  news tells the Orchestrator to use `relay_question {chatId}` when the user is away; for anything else it says the
  request is decided only on the PC (or with Telegram buttons, when shown).
- An answer on one channel closes the others as before: `pending:resolved` edits the Telegram message («Risposta sul
  PC») and a relayed «sì» after it finds no open request.

## Consequences
- The phone message of a long question has no descriptions; the user sees them on the PC panel.
- The chat title still never reaches Telegram (role and neutral label only, ADR 0219 §9), although the issue asked for
  it: the title can name a customer and the filter does not catch names in prose.
