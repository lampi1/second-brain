# ADR 0269 · Questions live in the Orchestrator; it speaks for the user

Date: 2026-11-12 · Status: accepted (owner, 2026-11-12: «le domande come tooltip nell'orchestrator non come modale così
invadente, sempre espandibile», «meno domande e più spiegazioni», «non voglio mai domande o comandi nei singoli agenti»,
«l'orchestrator deve poter fare il ruolo dell'utente come se l'avesse scritto l'utente quando scrive agli agenti, questo
è fondamentale», «anche nell'app le spiegazioni le voglio come messaggio semplice»; mockups approved with «ok mergia
tutto su main») · Supersedes: the always-on questions window of ADR 0049 / 0135 · Builds on: ADR 0150, 0259, 0083 · Amended by: ADR 0274, ADR 0275

## Context
- Every question, permission, command and plan opened a modal window over the page.
- The app itself asked «"X" è fermo: … L'hai fatto tu?» (`chats/user-action.ts`, #358) for every user step an agent
  reported, decisions included. Its card read the Orchestrator's last message, so it mixed two unrelated contexts.
- The Orchestrator's messages to agents were labelled «non vale come suo ok», so every trivial question reached the
  user.

## Decision
- **No window.** `QuestionsWindow.tsx` `OrchestratorAsks`: every open request is one row at the bottom of the
  Orchestrator's column (who asks, the question, Sì / No on the row for a single yes/no question, ▾). A click opens the
  same card in place (RequestPanel `window`, PlanApproval, WorkApproval). Ctrl+J, «Rispondi» elsewhere and the recap
  (`app_unblock`) open the named row there. «Ci penso dopo» keeps the row, dimmed.
- **Nothing to answer in an agent's chat.** Its tile keeps one line «mandata all'Orchestrator · Vai»; its shell blocks
  have no Esegui (`CodeBlock` `RunHereCtx`), only «Esegui dall'Orchestrator». The input stays (owner, 2026-11-10).
- **No «L'hai fatto?».** A reported user step (VPN, login, a command) is a plain note in the Orchestrator's chat
  (sys `userStep`): what to do, the command with Esegui when there is one. Its run resumes the work (#371 unchanged);
  else the user writes «fatto» and the Orchestrator reassigns the chat. The worker is held meanwhile (`userStepAt`).
- **A decision is not a user step.** `userAction` kind decision goes to whoever owns the work (its parent, else the
  Orchestrator) as «[decisione da prendere · chat «X»]»: it decides as the user would and asks only what is his alone.
- **The Orchestrator speaks for the user.** Its own authenticated tools (`app_create_chat`, `app_assign_task`,
  `app_send_to_chat`, `app_continue_chat`) start with `ORCHESTRATOR_USER_LABEL`: the message counts as the user's, ok
  included. `app_resolve_question` answers a work chat's Sì/No question for him (`ChatManager.answerForUser`, policy
  «orchestrator-for-user», a line in the worker's chat). Any other caller keeps `AGENT_LABEL`.
- **What stays his alone:** production, database writes, Azure/cloud, permissions or settings, messages to people
  (`shared/away.ts` `userOnlyText`, read over the whole request and its brief); permissions, commands, MCP forms, a Strategist's interview, the Orchestrator's own
  questions and delegated chats' questions are never answered for him.
- **Every agent hears it once:** `DECISION_FLOW_RULE` opens with «Explain what you did and go on; ask only a choice
  that changes the user's goal or cannot be undone». The Orchestrator frame stays under 16,000 characters.
- **Phone and Remote Control:** the user step note goes to Telegram as a plain message (`phone-port.ts`); questions
  keep their Sì / No buttons and the relay (ADR 0239) is unchanged. From Remote Control the Orchestrator can answer
  for the user.

## Consequences
- The Orchestrator can now say «sì» for the user on non-reserved questions: a wrong guess costs a turn of rework, never
  a production action. The worker's transcript says who answered.
- Old e2e specs of the questions window (questions*.spec.ts) describe the modal; they are not a merge gate (rules §7).
