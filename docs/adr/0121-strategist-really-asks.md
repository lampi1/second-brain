# ADR 0121 · The Strategist really asks: a question before the plan, the plan's approval in the questions window

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «quando è ingaggiato lo stratega vorrei che facesse veramente
qualche domanda, almeno quella di approvazione del piano tramite il popup se sono attivati i popup, rimostrando gli step
del piano nella domanda con una bella UI») · Builds on: ADR 0108 (the Strategist plans with the user), ADR 0049 (the
questions window)

## Context
ADR 0108 gave a Strategist the Orchestrator opens a flow (questions, `plan_propose`, the user's ok, then delegation),
but the asking lived only in the prompt: a Strategist could go straight to `plan_propose` without a single question.
And with "Popup" on, its questions opened in the questions window while the plan to approve stayed on its strip, where
a user who answers in the window does not look.

## Decision
- **It asks, enforced by the app.** The fixed flow (`STRATEGY_FLOW`) asks for at least one real question whenever the
  request leaves anything open. The plan counts the questions the user answered while it asked (`StrategyPlan.asked`,
  «Basta domande» included). A first `plan_propose` with none asked is refused (`proposalGate`) unless it carries
  `noQuestionReason`, one line on why the request leaves nothing open. A proposal after «Cambia qualcosa» needs none.
  Still at most 5 questions and «Basta domande» (ADR 0108).
- **No delegation before the ok, enforced by the app.** `agent_delegate` and `agent_assign_task` from a chat with a plan
  not yet approved are refused (`delegationGate`) with what to do next for the phase it is in: finish the questions and
  propose, end the turn and wait, or propose the changed plan.
- **The plan's approval in the questions window.** With "Popup" on, a plan in phase `proposed` is one more card of the
  questions window (`lib/plan-ask.ts`, `PlanApproval.tsx`), in the order it came with the other requests: the kind, a
  lead, «Approvi questo piano?», the steps as a numbered list (number, title, the role that does it, its short `detail`
  when the Strategist gave one), when it counts as finished, what is already clear, «Approva e parti» (Enter on the card)
  and «Cambia qualcosa» (a box for what to change, sent to the Strategist as today). The strip keeps its steps and
  points to the window, without its own buttons. With "Popup" off nothing changes: the strip asks, as in ADR 0108.
- **One source, no double prompt.** The card is derived in the renderer from `ChatSummary.plan`; main makes no request
  for it. Both places answer through `chat:plan` with the plan's `at`, the phase moves and both views follow.
  «Rispondi dopo» (Esc) puts it off like any other request.
- `plan_propose` steps take an optional `detail` (one line, at most 200 characters), kept with the plan.

## Consequences
- A Strategist that skips the questions pays one refused call and must say why; the user sees at least one question in
  the common case.
- The plan card is not a `PendingRequest`: the top bar's «Da rispondere» counter and the global layer (ADR 0035) do not
  count it. The chat itself still shows as waiting.
