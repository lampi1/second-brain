# ADR 0113 · A delegated chat that ends without agent_report is closed by the app

Date: 2026-10-21 · Status: accepted (owner, issue #152) · Builds on: ADR 0083 (delegation), ADR 0108 (Strategist plan)

## Context
A Scout called `agent_report` by its short name, got "No such tool" and ended. Its Strategist waited forever: the child
strip said «fermo», the counters said «1 in corso», the Strategist never woke up and nobody told the user.

## Decision
- A delegated child owes its result while it is open and has none. When its turn ends clean and idle with nothing that
  would bring the result (no question or permission, no answer from its parent awaited after `agent_ask_parent`, no own
  child or background task, no person it says it waits for, no plan waiting for the user), the app tells it once, as
  an app message, to call `mcp__second-brain__agent_report`.
- The next such end, or an engine that stops with an error, closes the delegation: a result `blocked` with
  `noReport: true`, the child's last answer as output and every criterion not met, delivered to the parent like a
  report (the parent wakes and can finish, retry or ask). Its run ends.
- The tree shows it as «finita senza report». Every counter of children uses one source (`chat-tree.ts kidCounts`):
  a stopped child (`fermo`, an error, a refused permission) counts as «ferma», never as running.
