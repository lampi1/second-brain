# ADR 0274 · The user answers in his own words; the Orchestrator's column has no answer box

Date: 2026-11-12 · Status: accepted (owner, 2026-11-12: «quando espando la domanda spesso non riesco a scrollarla fino
in fondo» · «da espansa voglio vedere sempre l'input dell'orchestrator scrivibile, è quello il campo libero, non serve
metterlo anche nel pannello delle domande» · «vorrei ci fosse anche un X per chiudere la domanda che equivale a rispondo
dopo» · «se rispondo direttamente all'orchestrator o all'agente il pannello deve sparire, però … se la risposta che do
all'orchestrator è della domanda non di altre robe» · «l'utente parla sempre e solo con l'orchestrator») · Amends:
ADR 0269

## Context
- An opened row (a long plan above all) took the column: the card was cut at the bottom and the Orchestrator's input
  went out of sight. A proposed plan was also drawn twice (StrategyPanel above the messages and its row).
- Every card had its own «Scrivi una risposta…» box, while the user talks to the Orchestrator's input.
- A message typed in a chat that waits on its own question was queued until the question was answered: the row stayed.

## Decision
- **Layout** (`styles/qwin.css`): the rows shrink and scroll; an open card scrolls to its end; the messages keep 48 px;
  the input is always in sight. The proposed plan is only its row (`OrchestratorTile.tsx`).
- **No box in the column for what the Orchestrator can pass on** (`lib/write-via-orchestrator.ts`, `DecisionCard.tsx`,
  `QuestionsWindow.tsx` AskCard): a plan or an engine question (not a Strategist's interview) says «write in the
  Orchestrator's field»; T focuses that field. Work proposals, commands, MCP forms and the app's own steps keep their box.
- **✕ on a row = «Ci penso dopo»** (`QuestionsWindow.tsx` AskRow, `lib/later.ts`).
- **Written in the asking chat, it is the answer** (`ChatInput.tsx`, `shared/answer-in-words.ts`): an engine question
  (never a permission, a command, an MCP form) takes the text as the answer of each of its questions. The Orchestrator's
  own question too: the engine waits on it anyway. Typed words there (not an option label) also count as the user's last
  message (`answer`, `userSaid`), so the Orchestrator can pass them on as below.
- **Written to the Orchestrator, it decides** (`ChatManager.openAsksHint`, `app_resolve_question` `words`): the user's
  PC message to the Orchestrator carries, for the engine only and marked as data, the open plans and engine questions
  (at most 5). If the message answers one, the Orchestrator names it and quotes his words; else the rows stay.
  `ChatManager.answerWithUserWords` checks the quote occurs in his last PC message (`userSaid`), written after the
  question, and passes his **whole message** (an excerpt never turns his «non …» into a yes). Recorded as policy
  «orchestrator-user-words» with a line in the chat. Refused for the Orchestrator's own question, a Strategist's
  interview, and what is his alone (`phoneQuestionReserved`, `userOnlyText`): those keep their click. A plan gets his
  whole message as its change, or the ok only when all of it is an approval and it is the only plan waiting.
- **Phone and Remote Control unchanged**: a Telegram message or the app's own note clears `userSaid` and gets no hint
  (its text decides nothing, ADR 0239/0255); from Remote Control the Orchestrator keeps app_resolve_question's Sì/No path.

## Consequences
- The Orchestrator frame stays as it was: the instruction rides in the hint and in the tool description.
- A wrong pick by the Orchestrator can only pass the user's own whole message, after the question, never on what is his
  alone; never an ok he did not write.
- The old e2e specs of the questions window (panels, questions, questions-yesno, review C3) were already red on main
  since ADR 0269 (no window): they fail before the free-answer steps.
