# ADR 0115 · Fatto lists the work the user asked for, with what it cost in all

Date: 2026-10-22 · Status: accepted (owner, issue #160) · Builds on: ADR 0101 (one money format)

## Decision
- A macro task is a top-level run (no parent in the store: the Orchestrator's, the user's, the app's own) together with
  the follow-ups of the same task (same `taskId`); one-shot runs are not tasks (`shared/macro-tasks.ts`).
- Its cost is its own plus every descendant's: delegated children, grandchildren, independent reviews, reworks and
  continuations; unknown («n/d») as soon as one part is unknown; a running task shows its cost «finora».
- Its outcome is the latest run in the root's own chat, not a child's.
- The Fatto page reads them from main (`runs:macro`, every five seconds while open): one card per day with the day's
  total, and the stand-up box built from the same rows. Zero tokens, no transcript scan, no Azure DevOps read.
