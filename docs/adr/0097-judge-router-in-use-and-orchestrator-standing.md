# ADR 0097 · The Judge's samples run in the user's own app; the Orchestrator points to Router and Judge and levels up by its decisions

Date: 2026-10-20 · Status: accepted (owner, issue #112) · Amends: ADR 0083 §9 ("only in the stable app") and the
agent standing of `agents/standing.ts` (issue #81)

## Context
Issue #112: after days of use Judge and Router had never run, the daily Judge sampling (`delegation.judgeDaily = 3`)
had never fired, and the Orchestrator stayed Lv 1.
- **Sampling.** `wiring.ts` started the 30-minute timer only when `releaseId()` was set, i.e. in a stable copy started
  by `release.mjs` (SB_RELEASE). The user's own app built from a clone (`npm start`, «Aggiorna» on a dev build,
  ADR 0075) or installed with the installer is not a release, so it never sampled anything, and nothing was logged.
  The first tick also came only 30 minutes after the start, and a run whose chat was gone or delegated used up one of
  the day's picks without another being tried.
- **Router and Judge.** No rule of the Orchestrator named them: it only learnt scout, herald, artisan, sentinel and
  strategist from the "stay free" rule.
- **Orchestrator level.** A level counts ended runs; the Orchestrator's chat is permanent and never is a run
  (ChatManager starts no run for it), so it had no runs, no metrics entry and no level.

## Decision
1. **Sampling gate** (`judgeSamplingOn`): on in any real profile; off in the test suites (`SB_TEST`) and in an agent's
   own run of the app (`SB_HIDDEN=1`, AGENTS.md), which must not spend the user's tokens by itself; `SB_JUDGE_SAMPLE=1`
   / `0` forces it. The demo never reaches it (demo wiring). The first tick runs 3 minutes after the start, then every
   30 minutes. Each tick that starts reviews logs `judge samples started`; a skip logs `judge sample skipped` with its
   reason (off, daily cap, engine refused, nothing to review with the counts) once per change of reason; the start logs
   whether sampling is scheduled or off and why. A candidate whose chat is gone or is a delegated child's is passed
   over and the next one tried. The cost guard stays `delegation.judgeDaily` (0 = off).
2. **One fixed Orchestrator rule** (`ORCHESTRATOR_RULES`): a message with several independent requests goes to one
   Router chat; finished work that needs an independent verdict goes to a Judge chat.
3. **The Orchestrator's decisions are its runs** (`standing.ts orchestratorDecision`): every ended root run it opened
   (`startedBy: 'orchestrator'`, not a one-shot, no parent run) counts once for the Orchestrator's level and is rated
   with that run's own verdict (same trust and recency weights). The run still counts for its own role. Nothing new is
   stored: it is derived from `agent-runs.json`. `withStandings` adds an entry without metrics for an agent that has a
   standing but no run of its own, so the Orchestrator's card shows its level; the "?" on the level says so.

## Consequences
- Up to `judgeDaily` Judge chats a day («Revisione · …») appear in the user's app, also a dev build; a developer who
  does not want them sets the limit to 0 or `SB_JUDGE_SAMPLE=0`.
- The Orchestrator's level is the number of jobs it started; its performance is how those jobs went. A bad plan shows
  as failed jobs; a good split of a request into several chats earns several decisions.
- Rolled-up runs (pruned past `RUNS_MAX` = 5000) carry no `startedBy`, so they leave the Orchestrator's count; the
  agent's own count keeps them. Accepted: the store keeps thousands of runs before it prunes.
- The demo has no Orchestrator runs any more: its level comes from the other roles' demo runs.
