# ADR 0173 · The working line shows what the chat really does

Status: accepted (2026-10-27, owner: «al posto delle frasi divertenti finchè pensa si può mettere quello che sta
realmente facendo?»). Supersedes the working-line jokes of the levels rework (PR #181, #182) and point 7 of ADR 0132
(the phrases of the day).

## Context

While a chat worked, its line under the transcript (and a collapsed strip before its first readable step) showed a dev
joke picked by the task's kind of work, changing every 5 s; once a day the lightest model rewrote those jokes. The owner
wants the line to say what the agent is doing instead. The app already reads the current step from the transcript at
zero tokens for the collapsed strips and the delegation cards (lib/run-steps.ts, ADR 0102), the same for every engine.

## Decision

1. `lib/typing-line.ts` `liveLine(items, what)` gives the line: the tool or command running now ("Lancia `npm test`",
   "Modifica login.ts", "Delega «…» (Artisan)"), else the engine's plan item in progress (Claude's TodoWrite, Codex's
   plan, Cursor's ACP plan and todos), else a plain «sta pensando…» / «sta lavorando…»; «sta scrivendo…» while the
   reply streams. A finished tool is not shown as "now" (its row is right above in the transcript).
2. `Typing` (components/ChatItems.tsx) takes the chat's items instead of a topic; the Orchestrator, Flash, every work
   chat and the collapsed strips (StripActivity.tsx keeps its last action and silence clock) use it.
3. The jokes (`i18n/areas/typing.*.ts`) and the phrases of the day (`main/daily-phrases.ts`, `phrases:today`,
   `phrases:changed`, `store/daily-phrases.ts`) are removed: no daily one-shot request any more. The `phrases` one-shot
   purpose stays in `ONE_SHOT_PURPOSES` so older runs in `agent-runs.json` still read.

## Consequences

- Zero tokens; the line changes when the transcript does, not on a timer.
- A leftover `userData/daily-phrases.json` is no longer read.
- Tests: `test/unit/typing-line.test.ts`, `test/unit/strip-status.test.ts`; e2e `test/e2e/stream.spec.ts` keeps its
  `typing-*` / `data-what` hooks.
