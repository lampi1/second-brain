# ADR 0344 · A worker's question goes up one level at a time; the Strategist's open doubts block its plan

Date: 2026-11-23 · Status: accepted (owner, 2026-11-23: «le domande dei sotto agenti comunque devono arrivare allo
stratega prima e poi eventualmente lo stratega chiede all' orchestrator e poi l'orchestrator chiede a noi. deve esserci
sempre il passaggio in modo che l'utente riceva solo domande a cui nessuno sa rispondere o nessuno può decidere.») ·
Amends: ADR 0083 (`agent_ask_parent`), 0108, 0269, 0274, 0275, 0327 · Supersedes in part: ADR 0121 and 0209 (the minimum
of questions)

## Context

- A worker's own question tool went straight to the user's panel: the app asked the parent only when the worker chose
  `agent_ask_parent`, and `askUser` there went straight to him too. He got questions the parent could answer.
- `proposalGate` counted answers: three, whatever the request left open. A Strategist with no doubt had to invent some,
  one with five could stop at three.

## Decision

### The ladder

- **Order**: worker → the chat that started it (its Strategist) → the Orchestrator → the user. A root chat the
  Orchestrator started asks the Orchestrator. A chat the user opened himself asks him, as before.
- **One gate for every engine**: `exposeRequest` (`chats/manager-sink.ts`), after the existing gates, calls `ladderHeld`
  (`chats/manager-ladder.ts`). It holds only the native question tools (`isNativeQuestion`: Claude `AskUserQuestion`,
  Codex and Cursor `AskQuestion`, the app's `ask_user`). Permissions, commands, MCP forms, Cursor plans and the
  Strategist's plan approval are never held.
- **The level is woken** with the question and the call that answers it. The answer (`agent_answer_child`,
  `app_resolve_question`: `answer` + `why`, the source) goes into the engine's still-open request; with no request open
  (`agent_ask_parent`, a restart) it goes as a message. The app's card of it, once the user's, is answered from the phone,
  by relay and in words like an engine's own (`isUserQuestion`). `askUser` is one level up, never the panel.
- **Never hangs**: a level closed, in error, out of turns, already reported, or silent for 10 minutes
  (`LADDER_SILENT_MS`) is skipped, and the record says why.
- **Never an agent's**: `ladderReserved` refuses an agent's answer about production, a database, Azure, permissions, the
  goal, colleagues, QA, customers or what cannot be undone; it is a floor of words, the rest is the level's judgement
  (`ANSWER_RULE`). An agent's answer says in its text that it is not the user's consent, and is not recorded as his.
- **Asked once** (ADR 0327): the same question, in either shape, is the same record; the Orchestrator asking a held
  question as its own sends that one to the user, with its own words.
- **Night mode** answers first, as before (ADR 0191); switched on later, it settles the app's cards in his row too. An
  answer of its own that does not arrive leaves the card in his row, and is not tried again.
  **A restart** keeps every open question: its level is woken again, or the app shows its own card; the engine asking it
  again takes its place.
- **Who answered and why**: `ChatSummary.questions` (`LadderQuestion`: `level`, `holder`, `trail`, `answered`), which the
  map reads, and the lines `ladderAsked`, `ladderPassed`, `ladderAnswered` in the worker's chat.
- **A held question is never «ti aspetta»**: `heldOnly` / `heldBy` (`shared/question-ladder.ts`) are the one reading. The
  maps, the recap, the sidebar, the card, the bench and the tile name the holder; the user's counts skip it until it is his.

### The open doubts

- No minimum. `StrategyPlan.doubts` (`shared/plan-doubts.ts`) lists every real doubt, open or closed `by` the user, code
  or brain, with its answer and source. A first `plan_propose` must pass the list (`[]` = nothing open).
- **One open doubt blocks approval**: the proposal is stored and not shown, and `planPropose` and `planDecide` refuse it
  for the PC, the phone, typed words and night mode alike, as do `planStart` and the work map's `approve`, `keep` and
  `start`. A doubt found on a proposed plan takes it back to revising.
- `by: 'user'` only with what the app recorded (his interview answer, his own words); asked in the doubt's own words, his
  answer closes it by itself. An open doubt cannot leave the list. A damaged saved list is one open doubt.
- «Basta domande» still ends the interview: what is left is closed `by: 'choice'` with the reason, declared as the
  Strategist's. Night mode allows the same; otherwise it is refused.
- The Strategist's role and flow text: only real doubts, options with risks, a better way proposed once, alone to the end
  after the approval. This widens no permission. A saved role still holding the old shipped text gets the new one.

## Alternatives rejected

- **A rule in the prompts only**: the fault that started this was a worker ignoring exactly such a rule.
- **Denying the engine's question and telling the worker to use `agent_ask_parent`**: a turn lost per question, and the
  worker that does not comply is stuck.

## Limits

- The engines' own timeouts on a question held for minutes are not the app's: Claude's and Codex's requests have none on
  the app's side; a request its engine withdraws is closed, or goes on as a message.
- `ask_user` (OpenCode, Cursor, Antigravity over ACP) ends the turn: the answer is the next message, not a tool result.
- OpenAI-compatible API chats ask no questions (`api.ts`).
- ADR 0275 stays: at the user's level the Orchestrator may still answer for him what is not reserved, and decide a
  permission or a plan as him. That is his recorded choice, outside the ladder. Two things are narrower than there: a
  Strategist's interview it answers is recorded as the Orchestrator's (`orchestrator-for-user`: no clarified answer, no
  doubt closed as his), and a delegated chat's question takes only his own words (`words`).
