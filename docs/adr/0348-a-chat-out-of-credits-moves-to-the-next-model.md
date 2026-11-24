# ADR 0348 · A chat out of credits moves by itself to the next model of its level, with 8 seconds to cancel

Date: 2026-11-24 · Status: accepted (owner, 2026-11-24: «vorrei che fosse facile far ripartire una chat con un altro
motore se finiscono i limiti con uno … che l'app proprio gestisse in autonomia i limiti dei vari abbonamenti»; picked
proposal 3A, automatic with a short undo) · Amends: ADR 0346 (a chat out of credits no longer waits only for the user)
· Builds on: ADR 0347 (several models per level, the pick by room)

## Context

- ADR 0346 made a role chat that hits its provider's limit wait, and go on only when the user changed the role's card.
  The app never moved it by itself.
- ADR 0347 gave each level an ordered list of models across engines and a pick that skips a spent plan.

## Decision

- **The wait follows the level's pick**: `catalog.cardNow` goes through the pick, so once the limit is recorded (the
  credit book marks the pool spent) the card a waiting chat reads is the next model of its level with room. The watch
  (`agents/credit-wait.ts`) runs again right after a turn's limit error (`wiring.ts`), not only on a card change.
- **Announced, then made**: the chat says «Riparto su X (motore) tra 8 secondi, con un riassunto di dove ero» with an
  «Annulla» button (`ChatManager.creditPlan`, `ChatItems.tsx` CreditSwitch). After `GRACE_MS` (8 s) the move is made as
  in ADR 0346: the same engine resumes on the new model; another engine continues in a new chat of the same role from
  the app's hand-off note, the same child of the same parent.
- **«Annulla»** (`chat:creditStay`) keeps the chat waiting (`creditWait.stay`): it moves when the role's levels give
  another model, or when the user writes to it. Writing to the chat during the 8 seconds also stops the move.
- With no other model with room the chat waits as before.

## Consequences

- A delegated chat's new engine must still be one its parent may start; otherwise it stays and says so (ADR 0346).
- The texts that told the user to change the card now say the app moves the chat when it can.
