# ADR 0268 · A brief maps an engine's own option labels to Sì / No

Date: 2026-11-10 · Status: accepted (owner, issue #378: «The user's answer on the Orchestrator panel reaches the worker
in a form its tools accept as a real human reply») · Builds on: ADR 0135 (yes/no questions only), ADR 0150 (the brief)

## Context
- A tool in a worker chat can record approval only from its own picker labels. The real case was a Claude Code
  project tool that asks "Approve Plan" / "Request Changes".
- The yes/no gate refused those labels. A Sì / No question did not match them. A relayed «approvo» arrived as an
  agent message. The user never types in a worker chat. So the worker stayed blocked.

## Decision
- **Declaring the labels:** the brief (`show_ui` brief, target next-ask) takes `yesOption` / `noOption`, the engine's own
  labels (≤60). A question with exactly those two labels counts as a yes/no question (`shared/yes-no.ts` `mappedYesNo`):
  one single-choice question, short.
- **What the user sees:** the card shows the options as Sì and No (`asYesNo`), so the Orchestrator panel, the phone
  and relays work unchanged.
  - A «(consigliato)» mark on an engine label is matched without it and carried to Sì or No, so the recommendation,
    the night mode and the phone keep working. The engine always gets the bare label.
  - The reserved check (`phoneQuestionReserved`: production, merges, secrets) reads `yesOption` / `noOption` too.
- **The brief can come second:** a two-option question that arrives before its brief waits the same BRIEF_GRACE_MS
  as a yes/no one, then is checked again.
- **What the engine gets back:**
  - Claude: AskUserQuestion's answers carry the engine's label for the user's Sì / No (`engineLabel`). A typed answer
    stays as typed.
  - ACP (Cursor `cursor/ask_question`): Sì / No select the mapped option ids.
- **Across the runtime broker:** the map crosses it as its own callback (`briefOptions`). A failing lookup only means
  no map.
- **Where the agent learns it:** only `YESNO_REFUSAL`, the message a refused question gets, and the brief's shape error
  say how. The role frame does not grow.

## Consequences
- A tool that reads its own picker answer gets "Approve Plan" when the user taps Sì, on the PC panel or the phone.
- Not covered: a tool that accepts only a typed message from a person in its own chat (a `UserPromptSubmit` hook
  that checks the origin). The app still never types into a worker chat in the user's name.
