# ADR 0134 · Yes/no questions only, «Ci penso dopo», and a recap that unblocks everything

Date: 2026-10-23 · Status: accepted (owner, 2026-10-23: «vorrei che l'orchestrator e in generale sempre io avessi solo
domande con risposta sì no o campo di testo per altro. Anche opzione ci penso dopo dove semplicemente poi
l'orchestrator quando gli chiedo un recap dei lavori in corso me la ripropone … io devo fare il meno possibile, nella
domanda si deve capire cosa è stato fatto, screen ecc»; «vorrei poter sbloccare tutte le cose in corso semplicemente
chiedendo un recap all'orchestrator e non guardare le varie chat degli agenti») · Builds on: ADR 0017
(app_resolve_question), 0049 (the questions window), 0083 (questions go to the parent first), 0108/0121 (the
Strategist's questions and plan)

## Context
Agents asked with any options they liked (two to four choices, multi-select, long labels), so each answer meant
reading and comparing. What the question was about often sat in the chat above it. «Rispondi dopo» set a question
aside only until the window came back, and nothing brought it back on purpose; to unblock the work the user had to
look at each chat.

## Decision
- **One shape.** Every role frame (`roleFrame`, so the Orchestrator and every role) carries `QUESTION_RULE`
  (`shared/yes-no.ts`): one yes/no question per call, exactly the options «Sì» and «No» (the recommended one marked
  «(consigliato)»), the question first saying in one or two sentences what was done and how it is known (a screenshot
  path, the file, the output: the app already shows image paths as thumbnails, `ask-image.ts`), so the user never
  opens the chat to understand. A choice between options becomes a yes/no question on the recommended one. The
  Strategist's clarifying questions follow it too (`STRATEGY_FLOW`); its plan keeps «Approva e parti / Cambia
  qualcosa», which is already a yes/no.
- **The engines' question gates.** A Claude `AskUserQuestion` (`chats/claude.ts`) or a Cursor `cursor/ask_question`
  (`chats/acp.ts`) that is not yes/no (`yesNoShape`: two options, a yes and a no in Italian, English or German, single
  choice) goes back to the agent with `YESNO_REFUSAL` (how to ask) instead of reaching the user. At most
  `YESNO_RETRIES` (2) in a row per chat: the next one is shown as it is, so a chat that cannot comply never stays
  stuck. Off in the test suites (their fake CLIs ask with free options) unless `SB_YESNO=1`; `SB_YESNO=0` turns it off.
  Codex questions get the rule only (no gate).
- **The panel.** Unchanged in shape: the options, «Altro…» for his own words, and the set-aside button, now called
  «Ci penso dopo». A yes/no question's «No» card has the refusal's tone.
- **The recap unblocks.** A new Orchestrator tool, `app_unblock` (only on an Orchestrator's own authenticated mount,
  and only within 10 minutes of a message the user wrote to it, like `app_update_code`), opens the questions window
  with everything that waits for the user from every chat: questions, permissions, commands, Strategist plans, and the
  ones set aside with «Ci penso dopo» (`ui:command` `unblock` → `lib/later.ts openQueue`). It answers nothing. The
  Orchestrator's rules say: on a recap, one `app_digest`, a line per job, how many things wait, then `app_unblock`.

## Consequences
- The user answers with one key or click; the question tells what happened, with its evidence.
- An agent that asks the old way loses one turn's question and asks again; the cost is a short tool result.
- A question set aside is still pending in its chat (the agent waits); it comes back on the next recap or Ctrl+J.
