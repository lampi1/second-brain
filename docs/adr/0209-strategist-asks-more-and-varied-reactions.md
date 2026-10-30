# 0209 — The Strategist asks at least three questions; reactions fit the message; Flash writes the brief

Status: accepted. Raises ADR 0121 (the Strategist really asks) and ADR 0108; amends ADR 0089 (emoji reactions).

2026-10-30.

## Context

The owner (2026-10-30): «spingi di più sulle domande che fa lo stratega prima di scrivere il piano, ne fa pochissime» and
«le reaction più varie, mi mette sempre solo il pollice in su». ADR 0121 let a plan through after one answered question,
and the flow text asked about goal, scope, constraints and "done" only in passing. The reaction rule named 👍 first and
said to use it also when starting on a task, so every engine answered 👍.

## Decision

- `STRATEGY_FLOW` lists the points to cover (goal and why, in and out, constraints, "done" and how it is checked, risks,
  preferences, priority), asks the Strategist to read the code or pages first so each question is concrete, and sets
  3 to 8 questions (`QUESTIONS_MIN`, `QUESTIONS_MAX` in `shared/strategy.ts`).
- The app enforces it: `proposalGate` refuses a first proposal with fewer than three answered questions unless the
  user answered «Basta domande» (`StrategyPlan.enough`, persisted) or the Strategist gives `noQuestionReason` naming
  what the request already settles. Away mode is unchanged (no gate).
- `REACTION_RULE` asks for the emoji that fits the message, with examples per kind (thanks, good news, starting a task,
  confirmation, a joke, looking into it), 👍 only when nothing fits better. The Orchestrator's delegation
  acknowledgement no longer names 👍. The hidden 👍 of `WAKE_RULE` stays: the app hides it.

- «Fanne un lavoro» on Flash (owner, 2026-10-30: «mi aspetto che lo crei bene il prompt per l'Orchestrator», he uses
  Flash also to plan, research and ask advice): the tile sends Flash `BRIEF_ASK` (renderer `lib/lampo.ts`, tagged
  `FLASH_BRIEF_TAG`), Flash writes the Orchestrator's prompt from its whole conversation (goal, context with exact names,
  what to do, constraints, done when, open questions) between markers, and the tile drafts it into the Orchestrator's
  input; the user still sends it. No answer within two minutes, or none usable: the old draft (last question and
  answer). The tagged turn hands Flash's newest open answer over (`flashBriefed`, outcome `handed`), never counts as a
  new question.
- The file viewer's copy icon copies the file itself (owner, 2026-10-30: «ogni file possa essere copiato dal tasto
  copia, solo l'icona»; `main/file-copy.ts`, `app:copyFile`): a text file up to 5 MB as its text, an image as an image,
  anything else as the file (Windows `FileNameW`, macOS file URL, Linux `text/uri-list`), pasteable in a folder or a
  chat. Same path rules as «Mostra nella cartella» (local only, never a network share); an agent's hidden run never
  touches the user's clipboard. «Copia percorso» keeps its own icon.
- One focus look (owner, 2026-10-30: «sistema le outline ovunque»): `styles/focus.css` gives every control one 2px ring
  in `--focus` from the keyboard only, text fields no outline but their border lit with a soft glow (`--focus-glow`),
  never the old double frame; the per-page violet/blue/accent/3px rings were replaced by `--focus`.

## Consequences

More turns before a plan (each question is one round trip); the user can always stop them with «Basta domande».
Tests: `test/unit/agents/strategy.test.ts`, `test/unit/reaction.test.ts`, `test/unit/chats/lampo.test.ts`,
`test/unit/agents/flash-outcomes.test.ts`. «Fanne un lavoro» costs one short Flash turn.
