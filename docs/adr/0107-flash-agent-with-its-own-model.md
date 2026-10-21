# ADR 0107 · «Flash»: the quick lane is an agent with its own model; both columns show theirs

Date: 2026-10-21 · Status: accepted (owner, 2026-10-21: «sia nel lampo che nell'orchestrator vorrei si capisse
chiaramente il modello che stanno usando come per le striscie. E poter scegliere un modello diverso per orechestrator e
uno diverso per lampo. Quindi quasi quasi Lampo deve essere un agente e lo chiamerei flash ma un agente sempre come oggi,
in sola lettura nella colonna dell'orchestrator») · Builds on: ADR 0105 (Lampo), ADR 0106 (Lampo is a "btw")

## Context
Lampo ran on the mid tier's model, chosen once in the renderer, with nowhere to see or change it. The Orchestrator's
model showed only to screen readers, and its card's model on the Agenti page was ignored at start.

## Decision
- Lampo is renamed «Flash» and gets a catalog entry (`FLASH_ID`, scope `background` like Pulse): a card on the Agenti
  page with its character, engine, model (null = the mid tier's), effort and instructions. It is never a role: not
  delegated (`roleId: 'flash'` is refused), no launches, no run; its owner stays a plain one named Flash.
- Read only stays fixed: whatever a card holds, Flash's tools are read and web with the plan ceiling (the catalog
  rewrites them on every save), and ChatManager starts it under `LAMPO_FRAME` and `LAMPO_POLICY` with the card's
  instructions after the frame.
- Flash follows its card before each of the user's questions (`ChatManager.flashFollow`): another model is changed in
  place (and its effort), other instructions go again with the next message, another engine opens a new Flash on it
  (the old one is archived first, its answers kept; if the new one cannot open, the old one comes back and answers; the
  Orchestrator's conversation goes again with the question, ADR 0106). One move at a time; mid-turn nothing changes. A
  card on an engine that is off leaves Flash on the engine it runs on.
- The Orchestrator starts on its card's model when the card is on its engine; otherwise on the session's (the
  Orchestrator settings), as before.
- Both columns show a model chip in their header (`ModelChip`: the engine's mark, model and effort, like a strip's
  facts line). A click lists the engine's models: the choice is saved on that agent's card when the card is on that
  engine (else only the open chat changes) and applied to the open chat.
- An existing «Lampo» chat is shown as Flash after the update (title rewritten on load); no data is moved.

## Consequences
- The user picks a fast model for Flash and a strong one for the Orchestrator, and sees both at a glance.
- Changing Flash's engine starts a new Flash chat: its earlier answers stay in the closed one.
