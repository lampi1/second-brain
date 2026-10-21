# ADR 0108 · The Strategist plans with the user: questions, a short plan to approve, its steps on the strip

Date: 2026-10-21 · Status: accepted (owner, 2026-10-21: «vorrei che lo stratega prima di partire mi proponesse un piano
molto breve e semplice stile claude code […] se scrivo un prompt all'orchestrator spuntando strategist vorrei che
ingaggiasse uno stratega che inizia a farmi domande stile grill-me per capire bene cosa voglio realmente, ad alto
livello e poi generasse gli step e appena li approvo partisse a delegare e nella striscia dello stratega vedere la
progressione degli step»; mockups approved the same day; «ovviamente se ho i popup attivi le domande le voglio in
modale») · Builds on: ADR 0083 (delegation), ADR 0100 (five work roles)

## Context
A message sent with «Strategist» ticked opened a Strategist chat that planned and delegated at once: the user saw
neither what it understood nor the plan before the work started, and its strip showed only its last line.

## Decision
- A Strategist the Orchestrator opens (`app_create_chat`, root, by an agent) carries a plan (`ChatSummary.plan`,
  `shared/strategy.ts`), persisted with the chat. Its first message is the user's request followed by the app's fixed
  `STRATEGY_FLOW` (not the role's instructions: the user's edits to the role never drop it, and no role migration). A
  Strategist the user or a test opens directly has no plan and works as before.
- Asking: one question at a time with the engine's own question tool, 2 to 4 options, the recommended one first, at
  most 5. Each answer becomes an "already clear" line on the strip (the question's header, else the question). With
  "Popup" off the open question shows on the strip itself (collapsed too), not again below; with "Popup" on it opens in
  the questions window as every other question, and the strip keeps only what is clear. «Basta domande» answers the
  open question with "propose the plan now".
- `plan_propose` (chat endpoint, pre-approved, shown only on a chat with a plan): 1 to 8 steps (the flow asks 2 to 6),
  one plain line each with the role that does it, and an optional "finished when". The strip shows «Approva e parti»
  and «Cambia qualcosa» (`chat:plan`); either reaches the Strategist as the user's message («Piano approvato: parti.» /
  «Cambia il piano: …»). `agent_delegate` is refused until the user approved.
- Under way: `agent_delegate` takes an optional `step` per part; a step with started children is under way and is done
  once every one of them reported done (blocked when one reported partial or blocked). `plan_update` moves a step the
  Strategist does itself. Every step done ends the plan. The strip shows the steps as Claude Code's checklist (✓ done, a
  turning ring under way, a dashed ring next), each with its role, its time and a progress bar.

## Consequences
- Two more pre-approved chat tools (`APP_CHAT_TOOLS`): no new permission prompt. Flash and the Orchestrator never see
  them.
- The flow costs the user a few answers before any delegation; «Basta domande» skips the rest.
- Not done: estimates of time and cost on the plan (the mockup showed them; the app has no estimate per step yet).
