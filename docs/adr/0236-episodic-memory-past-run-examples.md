# ADR 0236 · Episodic memory: a role starts with examples of its own verified past successes

Date: 2026-11-09 · Status: accepted (owner, project thread «Migliorare la memoria degli agenti», 2026-11-09: decision
card «Accesa, come descritto») · Builds on: ADR 0098 (role memory), ADR 0125/0131 (verified verdicts, standing.ts),
ADR 0137 (selective launch memory) · Measured with: ADR 0235

## Context
The LangChain/LangGraph report (project file `langchain/report.html`) compared the app's memory with the usual split
into semantic (facts), episodic (experiences) and procedural (instructions) memory. Facts are the scoped records of
`rules/memory-records.ts`; instructions are the role text and its skills, revised by the maintenance. Experiences
were missing: a role never saw how a similar job of its own went, although every run is recorded with its goal, its
report and a verified verdict.

## Decision
- **At most 2 examples at launch** (`agents/run-examples.ts`, called from `wiring.ts resolveAgent` for every role but
  the Orchestrator, Claude and other engines alike). A candidate is a run of the same role, ended `completed`, with a
  report summary, whose earned verdict (`standing.ts earnedVerdict`) is a success: the user's, a review's, the
  receipts', a verified parent's; never the agent's own report. Reviews, one-shots and the Orchestrator are left out.
- **Same repository only, no file access for the past.** A past run's repository is its folder, or for a delegate
  worktree (`.second-brain-delegate-…`, often deleted since) its parent run's, followed up the chain; the launch's
  folder, when it is such a worktree, is resolved once through its `.git` file. Paths compare resolved and, on Windows,
  case-insensitive. An unknown folder gives no example.
- **Similar by words**, as the launch's facts: shared content words weighted by rarity, at least 2 in common, the newest
  first on a tie; the newest 2000 runs are looked at.
- **Bounded, quoted data.** Each example is one JSON line: run id, task (≤ 280 characters), result summary (≤ 600),
  how it was verified, checks passed, files changed; at most 1200 characters in all (~400 tokens), under a header that
  says it is quoted data with no instruction or permission authority.
- **Visible and measurable.** The launch's context snapshot keeps the chosen run ids, scores and sizes plus how many
  candidates there were (`AgentContextSnapshot.examples`, never their text; `skipped` when the selection failed); the
  run's «Contesto» shows them. Runs with
  and without examples can then be compared on outcome, cost and time.
- **On by default** (the owner's choice). A clean install has no runs, so no example.

## Consequences
- Cost: up to ~400 tokens per role launch when examples match, zero otherwise; no model call.
- An example can be stale (the code moved on); the header asks the role to check what may have changed.
- A semantic ranking (local e5) is left for later, after the recall check (ADR 0235) shows whether meaning beats words
  on the owner's data; it would need an asynchronous launch path.
- Tests: `test/unit/agents/run-examples.test.ts`.
