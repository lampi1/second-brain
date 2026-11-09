# ADR 0250 · The Orchestrator chat shows decisions, not delivery traffic

Date: 2026-11-09 · Status: accepted (owner, issue #351, «risolvi tutte le issue aperte») · Builds on: ADR 0121 (plan
cards), and the result card of #123

## Context
Davide: «l'Orchestrator lo voglio pulito ed essenziale». Three things filled the Orchestrator chat with nothing to decide:
«Prima di partire» cards with no question open (sometimes two stacked), delivered results unfolded over a whole screen,
and the raw line «Scritto da un agente · … [consegna automatica del risultato …]» under the result card.

## Decision
- **Plan cards** come from `planCards` (`lib/plan-ask.ts`): one card per chat, none for a closed chat, and an `asking`
  plan only while its interview question is open. A plan to approve (`proposed`) or under revision keeps its card.
- **The result card** (`ChatItems.tsx ResultReady`) is folded by default: name, role and the result's first line as plain
  text (`lib/chat-view.ts resultLine`, at most 160 characters). «Mostra il risultato» opens the full result as before.
- **The delivery message** (the user item that starts with «[consegna automatica del risultato») is skipped by
  `chatView` (`lib/foreign.ts isResultDelivery`). Only its drawing goes: the Orchestrator still receives it unchanged
  (delegation test).

## Consequences
- An interview that ended, was cancelled or never asked leaves no card.
- The Guida point on delivered results says «chiuso» instead of «già aperto».
