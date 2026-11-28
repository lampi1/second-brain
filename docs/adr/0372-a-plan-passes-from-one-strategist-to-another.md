# ADR 0372 · A plan passes from one Strategist to another, and widens on the way

Date: 2026-11-28 · Status: accepted (owner, 2026-11-28: «i piani potessero essere ripresi da strateghi diversi se l'utente lo
chiede all'orchestrator: un piano deve facilmente passare da uno stratega all'altro, essere ampliato e modificato») ·
Builds on: ADR 0363 (the Plan)

## Context

- A plan stayed with the chat it was born in: «Riprendi» went back there, and a new Strategist started only when that chat
  was gone. Moving a job to another Strategist meant closing the first one and hoping.
- A change made by the Orchestrator to the steps of a live plan reached the Strategist only if it read the plan again.
- Steps added to a finished plan with no chat left it «finished» over work to do.

## Decision

1. **`plans` action `handoff`** (`Plans.handoff`), the Orchestrator's only, when the user asks: `plan`, `text` (what to change
   or add), `to` (an open Strategist chat, not delegated, with no job of its own under way; empty = a new one), `cwd`.
2. **One active Strategist.** The old chat lets go first (`ChatManager.planRelease`): a card that waited is answered, its copy
   of the plan is marked `handed`, what it and its delegated chats have at work is interrupted, nothing is closed. A handed
   copy owns no plan, and `plan_propose`, `plan_update`, delegation and «Riprendi» are refused on it, after a restart too.
3. **Nothing is lost.** Every step keeps its id, state, proof, chats and dependencies; answers and doubts go along; the old
   chat is in the plan's `past`. The new Strategist is told it takes the plan over, reads it, keeps what started
   (`plan_propose` with `revise: true`), may change and add the steps to do, and proposes again: nothing starts before the
   user's ok.
4. **A failure leaves a plan to resume.** If the new Strategist cannot start after the old one let go, the plan is stopped
   with all its steps and «Riprendi» opens a new one.
5. **Changes reach the Strategist.** When the Orchestrator or the user changes a plan that has a chat, the chat is told with
   its next message (no turn of its own). An edit that gives an ended plan work again opens it.

## Consequences

- A chat that had only an empty plan record of its own (it was still asking) leaves it behind as an idea with no chat.
- Steps under way in the old chat's delegated chats stay «in corso» with their live status: the new Strategist decides what to
  start again.
- Tests: `test/unit/agents/plan-chats.test.ts` («a plan passes from one Strategist to another») and
  `test/unit/plans/service.test.ts` («widening and failing hand-overs»).
