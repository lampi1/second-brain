# 0181 — Fatto e standup removed

2026-10-29. Accepted. Supersedes the Fatto parts of ADR 0041 (addendum), ADR 0079 and issue #160.

## Context

The owner (2026-10-29): "la sezione fatto e standup è inutile non la guardo mai rimuovila … pulizia profonda di quella
parte non lasciare refusi". The page listed the macro tasks by day with their cost and a stand-up box; the Task page
ended with a second stand-up box read from the brain's day tool.

## Decision

The page and every stand-up text are gone from the app:

- the page `fatto` (brain/pages/Fatto.tsx, its styles in worklog.css, the sidebar entry, `G F`, its command-palette
  icon, its place in the work profiles), the stand-up boxes of Fatto and Task (pages/day.tsx), the QA section's «Copia
  per lo stand-up» and the helpers only they used (lib/text.ts stand-up sentences and DevOps links, lib/qa.ts
  qaStandup, lib/done-log.ts, the day report and brief shapes in brain/types.ts);
- the IPC `runs:macro` and shared/macro-tasks.ts (nothing else read them);
- `/api/day` is no longer proxied by the app (the brain's own day.mjs and brain-site stay: the end-of-day report in
  `routines.md` still uses them);
- the concept guide's "Task e Fatto" becomes "Task" (id `tasks`); the morning block's "lavori finiti" row opens the Log.

Old links (`fatto`, `fatto/<day>`, `diario`) open the Log, the app's record of what was done.

## Consequences

No token or permission change. The run store keeps every run: the Log, the agent cards and the estimates read it as
before.
