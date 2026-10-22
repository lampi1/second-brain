# ADR 0099 · Tokens and speed of the orchestration: fewer model round trips, warm engines, quiet results

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «risparmio di token come priorità, non cambiando modelli:
inefficienze del meccanismo di orchestrazione e messaggistica»; «la velocità di risposta non è la stessa di Claude Code»)
· Builds on: ADR 0025, 0031, 0083, 0087, 0089, 0090

## Context
An audit of the flow (2026-10-20) measured the fixed context of each call and traced the path from Enter to the first
token. Findings in the code: every request to the Orchestrator started with a `task_estimate` tool call (one more model
round trip and context re-read for a pure figure); the warm engine of ADR 0025 never served a role chat (it was taken
only by a chat without a tool policy, and every role has one since ADR 0085), so every delegated job paid the measured
13-22 s cold start; a clean `agent_report` and every child's result woke their reader at once, one turn each (median
~0.18 $ per Orchestrator wake, zero-token-audit round 3); the Orchestrator listed 24 browser tools it is told not to
use (~4 200 tokens per call) and Scout/Judge six delegation tools they cannot use (~1 500); an idle Orchestrator was
compacted only on the next day, on an expired cache (ADR 0031: ~2.10 $ for a cold resume past 100k).

## Decision
- The app computes the estimate and appends it to the user's own message to the Orchestrator
  (`[app estimate · path …] why`, `shared/task-estimate.ts estimateLine`); the rule says to act on it and to call
  `task_estimate` only when the line is missing or to re-plan for a role. The chat view and a transcript re-read hide it.
- The warm pool keeps up to two engines in the folder of the last new chat, each launched like the chat it waits for
  (plain, or a role's tools, ceiling, skills plugin and context window, keyed by a digest); after a role chat starts,
  one launched like it waits for the next. The open Orchestrator's engine resumes ahead of the first message after a
  restart (a resume, no message, no tokens).
- A root chat's clean result (done, every criterion met, no question) is quiet news: the user reads it in the chat; the
  Orchestrator gets its summary with its next turn. A child's result waits up to 60 s for its siblings', and the parent
  reads the batch in one turn. A chat the app itself started (a sampled review) never wakes the Orchestrator when done.
- Lighter prefix: no browser tools and no `brain_script_add` on the Orchestrator; no delegation tools for a role that
  launches nobody; no `agent_report` for a root chat nobody asked to report; compact JSON in app-tool results; the
  screenshot hint once per chat; the roles' preamble no longer makes Claude re-read AGENTS.md / CLAUDE.md.
- A product brain's rules hooks for UserPromptSubmit, PreToolUse and PostToolUse are answered by the Claude session in
  process (`hook_callback`, `rules/runtime.ts runHook`, the code the node runner ran): two node processes per tool call
  (0.2-2 s each on Windows, never measured by the start-up bench, which turned hooks off) are gone. Stop stays a
  process in the plugin's hooks.json: its local brain commit runs synchronous git, which must not block the app.
- `read_page` of a page the chat read before (same URL and filter) returns only the new or changed lines with their
  parents and the counts of the rest (`browser/delta.ts`); `full: true` returns the whole tree. Refs of elements that
  still exist are stable, so an unchanged element prints the same line.
- A Sentinel's first message carries a review pack gathered with git (`agents/review-pack.ts`: branch, base, commits,
  changed and untracked files, the diff up to 12 000 characters, else how to read it per file) instead of the 5-15 git
  calls each reviewer made to rediscover it. Only the repository's facts: the review stays independent (ADR 0091).
- A role with every tool class (the default) gets Claude's sub-agent tool, so the read-only Explore searches ADR
  0083/0090 allow exist at last and return a summary instead of whole search results in the role's own context; the
  role gate still refuses every other sub-agent, and a narrowed role never gets it (its tools are not bound by --tools).
- `app_digest since:"last"` answers in full after the Orchestrator's context began again.
- An Orchestrator quiet for most of an hour with 60k+ of context compacts while its cache is warm
  (`continuity.ts orchestratorWarmDue`, setting `orchestratorDayCompact`).

## Consequences
- Estimated (not measured: no transcripts were available to the audit) 175-370 $/week less on the owner's measured week;
  the next step is to measure: cache read vs creation on the first call of a new session, per chat kind.
- A clean result no longer interrupts the Orchestrator: it learns it at its next turn, and "N novità in attesa" shows it.
- Not done here: Claude Code's MCP tool search (its setting name was not verified on the bundled engine), `now.md` written by the app.

## After the review (2026-10-20)
- Claude starts a sub-agent without a permission request, so the role gate never saw it: a role chat with the sub-agent
  tool gets the gate's rule as an in-process PreToolUse hook (`role-gate.ts SubagentGate`, Explore only).
- A waiting engine launched for a role lists tools as that role's root chat would (no delegation tools for a role that
  launches nobody, no `agent_ask_parent`, its browser access and managed servers); a delegated chat starts cold (until ADR 0126: now it takes an engine launched as a child under the same role chain).
- Child results still waiting for their siblings when the app quits are kept on the parent and sent after the start.
- A clean report keeps its own slot in the Orchestrator's news: a later error of the same chat never hides it.

## Amended (issue #123, 2026-10-21)
- A clean result was quiet even when the user waited for it: he asked the Orchestrator «che devo fare oggi?», it opened
  a Scout and ended its turn, and the Scout's answer reached him only when he wrote again; read while the Scout still
  ran, the Orchestrator said «non ha ancora finito», and the turn end then woke it a second time.
- The owner chose (2026-10-21) a notice, not a turn: «mi basta la notifica nella chat dell'orchestrator, non aggiungere
  un passaggio, manteniamo il risparmio». A root chat the Orchestrator opens (or assigns again) during a turn the user's
  own message started is one the user waits for (`ChatManager` `userWaits`; a turn the app's news or mail started is
  not). Its clean result stays quiet news, and the app adds its own notice in the Orchestrator's chat (sys
  `resultReady`: role, title, the summary, Apri): no model turn, no token. A result that is not clean still goes as a
  message, as before.
- Every root result is held until the reporting chat's turn ends, or its engine stops: the report and the turn end are
  one news, said once, and never while the chat still shows as running.
- A row of «N novità in attesa» the user opens is read (owner: «nelle novità clicco e mi porta alla chat … poi non
  fosse più in attesa»): its chat comes on screen, its news leaves the list (IPC `orchestrator:heldSeen`) and stays only
  as quiet news that never wakes the Orchestrator; a later event of that chat is news again. What the user writes in
  Lampo is never news.
