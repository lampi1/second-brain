# ADR 0259 · The question card, redesigned: still while open, «Bivio», Esegui as a question

Date: 2026-11-10 · Status: accepted (owner, thread «Rendere chiare le domande degli agenti») · Builds on: ADR 0049
(questions window), ADR 0135 (yes/no questions), ADR 0150 (decision card), ADR 0255 (phone answers)

## Context
The owner (2026-11-10): questions are a core part of the app and they «non spiegano bene la domanda e sono formattate
male», «a volte la modale si modifica da sola mentre è aperta», «le domande con esegui a volte non compaiono bene», and
they must work from the phone. He reviewed proposals A-G and three card designs, picked «3 · Bivio» and asked for all of
it («Sì, tutto»), the Esegui commands too, from Telegram and Remote Control (reserved ones stay on the PC).

## Decision (built in steps; each step adds its section)

### 1. The card stays still while it is open
- The questions window freezes the asking chat's items when a card opens (`lib/askItems.tsx useFrozenItems`,
  `AskItemsProvider`): the card's context, brief, visuals and the turn's commands read that copy (`useAskItems`).
  What the chat writes afterwards shows one notice, «L'agente ha aggiunto qualcosa mentre leggevi · Mostra»; a click
  takes the new items in. What counts as new is the current turn's text, reasoning and attached visuals
  (`lib/askContext.ts turnSignature`), never a tool's status. Tiles and the lane keep reading the live store.
- The answers (Sì / No, write, skip) are one block (`.dc-act`) pinned to the bottom of the window's scrolling body, so a
  long context never pushes them out of sight.

## Consequences
- A card can show a turn a few seconds old; the notice says so and one click updates it.
