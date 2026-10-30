# 0209 — The Strategist asks at least three questions; reactions fit the message

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

## Consequences

More turns before a plan (each question is one round trip); the user can always stop them with «Basta domande».
Tests: `test/unit/agents/strategy.test.ts`, `test/unit/reaction.test.ts`.
