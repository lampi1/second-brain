# ADR 0078 · Agent first: the profile decides, the table only fills a missing model

Date: 2026-10-19 · Status: accepted · Replaces the routing parts of ADR 0032, 0047, 0051 and 0066 (issues #70, #72,
#73, #80; #71 rides along)

## Context
The vision is agent-first: "model choice and behaviour live in the agent's profile, not in global switches"
(`docs/VISION.md`). The old model routing table (task kind / area → engine, model, effort; ADR 0032, priced and voted
per work in ADR 0047, a row per kind in ADR 0051) still decided next to the profile: a chat started with `agentId`
whose profile differed from the table row was refused with "override senza motivo" unless the caller gave a reason
(ADR 0066). Without `agentId` the classifier was never asked and every chat became Generale. The legacy profiles
imported once from the table had no "when to use" and no instructions, so the classifier could hardly tell them
apart. The app wrote every routing outcome as unknown, so no kind ever reached the 20 known outcomes the loop needs,
and a row's reason "nessun dato ancora" never changed. Workers never started catalog agents. When no agent fitted,
the Orchestrator could not create one after the user approved it in a panel, and one failed `agent_create` used up the
user's message. Agents had no per-agent context limit.

## Decision
- **The agent's profile decides.** `app_create_chat` with `agentId` routes through `routeAgent` (brain/routing.ts):
  the profile's engine, model and effort as they are, source `agent`, never `override`, never exploration, never the
  API switch of a writing row. A profile with no model takes the matching row's model (same engine only) and, if the
  profile names no effort, that row's effort: a default, never an override (`route.agent.modelFrom`: profile, table,
  engine). The profile's own `max` effort is the user's choice and needs no reason. A caller may not name a different
  harness, model or effort with `agentId`; `catalog.resolve` accepts a model only where the profile names none.
- **Without `agentId` the classifier chooses.** Unless the caller names harness, model or effort, the app runs the
  local classifier ($0, no model call) on title and prompt; the first candidate at or above the threshold in force
  that is active, routable and may start now (engine on and trusted, cross-engine rule) runs the chat
  (`chosenBy: classifier`, with its score, threshold and channel). Otherwise the chat is Generale, routed by the table
  as before, and its route records the best score it saw (`chosenBy: fallback`), so the Classifiers tab can show
  recent agent-choice scores from `ChatSummary.route.agent` (plus each run's `routing` snapshot).
- **The table stays, as defaults.** It gives Generale its engine, model and effort and fills models; its editor, hard
  rules, locks, exploration and the brain's loop (ADR 0032/0047) are unchanged for those chats. The "override needs a
  reason" rule now applies only to agentless chats.
- **The table learns from the app (#72).** An agent run's verdict that counts (the user's, a reviewed one, the
  Orchestrator's opinion; never a self-report) is written as a known outcome of its chat's ledger line
  (`outcome: { known: true, success, partial?, source: agent-user | agent-review | agent-orchestrator, runId, at }`,
  with the last measured actuals). Later measured lines of the same id carry it, so the next turn never undoes it. A
  row's reason is refreshed at every routing from the ledger's counts of its kind ("16 chat, 10 con esito, 70%
  riuscite"), dropping a stale "nessun dato ancora"; an agent's route shows its active version's results ("12 run, 9 con
  esito, 78% riuscite"). The brain's own `routing-loop.mjs` still writes `why` once: that script lives in the brain,
  outside this repo; the app no longer shows that text alone.
- **Improve agents, not tables.** The Orchestrator proposes model, effort, instructions, `whenToUse` and `maxContext`
  changes with `agent_update` (a proposal the user approves; an accepted behavioural change runs as a trial).
- **Workers start catalog sub-agents.** `agent_start_subagent` on each chat's own endpoint: the caller is the chat
  the token names; it needs an open agent run; the child is created by the worker's Orchestrator's own
  `app_create_chat` (same checks) with `parentRunId` = the worker's run, answers to that Orchestrator and is told to
  send its result to the worker; at most 3 open children per run (reserved before the chat is created), 2 levels deep;
  the child profile's tools, MCP servers and ceiling must fit inside the worker's effective policy, and its folder is
  the worker's or one of its git worktrees (security review, 2026-10-19). `agent_children` /
  `agent_child_feedback` already list and judge them. The Orchestrator's role and every work chat's first prompt say
  the path exists.
- **Legacy profiles get guidance.** Imports carry a "when to use" and short instructions from their row's kind and
  area; profiles imported before (untouched since) are completed once, as a new version by the migration.
- **Creating a missing agent (#73).** The user's answer in a question panel (chat:answer, sender-checked UI) is
  recorded like a typed message and can approve one creation; an answer that says no never does. `requestItemId` is
  optional: by default the most recent fresh (30 min), unused approval of the caller's chat. A call the catalog
  refuses gives the approval back. The tool description lists the valid presets, categories, symbols, tones, tool
  classes and ceilings, and the errors name the valid values.
- **"Contesto massimo" (#80).** `AgentDraft.maxContext` (tokens, 100k–1M, null = the app setting) is a behaviour field
  (a change is a new version). The catalog resolves it with the agent; the chat keeps it (`agentMaxContext` in
  chats.json) and starts its engine with it as the compaction window instead of the setting; such a chat never adopts
  a pre-warmed engine. Only Claude engines apply it (`AgentModelChoice.maxContext`); the editor says so for others.
  `agent_update` takes it in `patch`; `agent_learn_propose` takes `maxContext` + evidence and queues the same proposal.
- **Local stores (#71).** `writeLocal` retries the rename on EPERM/EACCES/EBUSY (5 tries, 20–100 ms), logs a warning
  after a retry that worked and throws only when every try failed.

## Consequences
- An agent's chat is never refused for disagreeing with the table; the table no longer silently wins over the agent.
- Without `agentId`, which agent runs depends on the classifier's threshold (Agenti → Classificatori, ADR 0174): a
  wrong match is visible in the route's reason and score.
- Known outcomes start to accumulate from the app's own verdicts; the brain's loop can reach its 20 per kind.
- A worker can spend tokens on a catalog agent without asking the Orchestrator, bounded by the limits above and by
  the same engine and cross-engine policy as the Orchestrator. The child's permissions are its own profile's (as when
  the Orchestrator starts it), never wider than the Orchestrator's.
- No new dependency.
