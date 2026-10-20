# ADR 0083 · Nine fixed roles, direct parent-to-child delegation in visible chats

Date: 2026-10-19 · Status: accepted (owner, issue #89: «un lavoro divino»; the tree design "variant A, thread cards",
the questions rule and "the Orchestrator column is the only way to start work" confirmed by the owner on 2026-10-19)
· Amended by ADR 0085 (2026-10-19 evening: every role has every permission by default and the user narrows it from
its card; the planners launch the writing roles again; §1's default tools and ceilings and §3's "planners launch only
Scout and Judge" no longer hold, the narrowing rules do) · Amended by ADR 0091 (2026-10-20, issue #99: no `independent` field and no model switch; a
review's independence is its clean new session, §9's Judge reviews on any model) · Replaces: the editable agent catalog with Italian presets and routed `legacy-*` profiles (ADR 0077, 0078), the
Orchestrator-only sub-agent launch (`agent_start_subagent`), the brain's agent pointers, playbooks and specialist
notebooks · Builds on: ADR 0006 (app MCP), 0021 (per-chat endpoints), 0068 (Grindhouse), 0082 (agent changes)

## Context
Work was split among agents the user had to compose (a catalog of presets, routed profiles, owner-added pointers in the
brain), sub-agents ran hidden inside an engine's own Task tool, and only the Orchestrator could open a work chat, so a
worker that needed a search or a review either did it itself or asked the Orchestrator, which then read the worker's
text. Permissions of a sub-agent were narrowed against the Orchestrator, not against the chat that asked for it.

## Decision
1. **Nine fixed roles, English names**: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald, Router, Judge,
   Scribe (`shared/roles.ts`). Each has a purpose, tool classes, a permission ceiling, a model tier with a maximum,
   the roles it may launch, default skills and a cartoon character (`shared/characters.ts`). The user edits a role's
   tools, ceiling, tier and model in Brain → Agenti (each change a version, `roles.json` + `role-history.json`); nobody
   adds a role: a missing know-how becomes a skill. Old catalogs (`agents.json`, `agents.v2.json`) are neither read nor
   deleted (a rollback still finds them).
2. **Skills only by launch.** A role chat gets exactly its role's skills plus the ones its launch named; on Claude the
   brain plugin comes without its skills folder and a Skill call outside the list is refused visibly
   (`agents/role-gate.ts`); Codex gets only the runtime skill root; Cursor is told by its instructions (not enforced:
   ACP has no hook). Unverified against the live CLIs: the Claude `ask` rule for Skill and the Agent/Task refusal are
   pinned by fixtures and fakes only; where in doubt the gate denies.
3. **Direct delegation in visible chats** (`agents/delegation.ts`, on each chat's own MCP endpoint, pre-approved):
   - `agent_delegate` starts 1–10 child chats at once, each a role the caller may launch, with a self-contained
     contract (goal, output, done-when criteria, context, optional narrower tools, skills, tier); the child never sees
     the parent's conversation.
   - Permissions only go down: a contract tool beyond the parent's is refused, the child's policy is narrowed by its
     parent's, its folder stays inside the parent's or in a worktree of the parent's repository (`agents/worktrees.ts`),
     and a child's permission request beyond its parent's is refused and said in its chat (`sys.aboveParent`).
   - A root chat the Orchestrator opens runs its own role's tools and ceiling within the user's defaults, never the
     Orchestrator's read-only policy (the Orchestrator plans; the Artisan it starts writes).
   - A role launches only roles that fit within its own tools (`shared/roles.ts` `launchGap`: every class the child
     role needs, the read-only ones aside, must be the parent's): a child needing more could not do its job, so
     `agent_delegate` refuses it and tells the parent to put that part in its report as a ready contract; the
     Orchestrator starts it as a root chat. The planners (Strategist, Router) launch only Scout and Judge (owner,
     2026-10-19: planners stay planners, all work starts from the Orchestrator).
   - Limits are the user's (Impostazioni → Ruoli e deleghe: depth 2, 5 children at once by default); the slots are
     reserved synchronously; a refusal is a line in the parent's chat and a "Limite" pill on its tree.
   - `agent_report` is the child's one result (outcome, summary, output, every criterion with met and evidence; a goal
     the user changed in its chat with `goalChangedByUser` and `newGoal`), delivered to the parent as a message.
   - The engine's own sub-agents are allowed only for a quick read-only search (Claude's Explore); any other type is
     refused: no hidden sub-agents.
4. **Questions go to the parent first** (owner, 2026-10-19): an ambiguity of a contract goes to the parent with
   `agent_ask_parent` and comes back with `agent_answer_child`, or `askUser` sends it on. Only a permission, an
   irreversible or external action, a choice that changes the goal, or what the parent cannot answer reaches the user.
5. **Each request is shown once** (`renderer/lib/child-requests.ts` `requestHost`): in the asker's own chat when it is
   open, else in its nearest open ancestor's (the "pause panel", tagged with the child's character and task), else on
   the child's card; the questions window shows it instead while it is on; the Orchestrator never gets an answerable
   panel of another chat, only a status-only "waiting" event.
6. **The Orchestrator sees state, not content**: started, waiting, finished, failed, never a child's text
   (`chats/orchestrator-wake.ts`). The one exception is the user's own words: a message the user types in any work
   chat is quiet news `user-message` (chat, role, parent, time, the text cut at ~300 characters) that rides with the
   next delivery and counts in the held news; the chat's parent gets the same note with its next message. The
   Orchestrator's rules say: check these notes before delegating related work, never undo what the user told a chat.
7. **One place to start work**: the Orchestrator's column. The start dialog ("Nuovo agente"), the role page's launch
   are gone (the sidebar has no "+"); Ctrl+N and the palette give its input the keyboard ("Cosa vuoi fare?"). Cloud agents
   start the same way (`app_create_chat` with `where: "cloud"`).
8. **The tree on screen** (owner's design, variant A): every delegated chat is a thread card under its parent on a
   curved line tinted by its state, with the task, character, role, skills, model, time, its steps, a state pill and
   what it needs; a click expands it in place into its whole chat, "Vai alla chat" opens focus mode. The steps are
   real and cost no token (`renderer/lib/run-steps.ts`): the engine's plan (Claude TodoWrite, Codex plan, Cursor ACP
   plan/todos), else the contract's criteria, plus the recent tool calls folded into readable lines. The parent's
   KidsBar and the sidebar tree fold the same `prefs.treeCollapsed`, kept across restarts.
9. **Improvement loop owned by the app**: the Judge reviews a few finished runs a day on another model (superseded by ADR 0091: in a new session, on any model)
   (`agents/judge-sample.ts`, Settings `delegation.judgeDaily`, only in the stable app); its verdict is the run's
   reviewed evidence. The brain's playbooks, `sync-agents.mjs`, agent pointers and specialist notebooks are retired.

## Consequences
- The user sees every agent at work and can write in any of them; the Orchestrator and the parent learn it, so plans
  do not conflict. A child changes only within its parent's permissions and folder.
- A user's custom agents from the old catalog do not carry over (no conversion code, by the owner's rule): export them
  as packs from the previous stable first.
- The planners stay planners: a Strategist or a Router never launches an Artisan, a Sentinel, a Herald or a Scribe
  (under them they would be narrowed to read-only and change nothing). Their report carries those parts as ready
  contracts and the Orchestrator starts them as root chats, so every change starts from the Orchestrator, as the
  owner wants. A Scout under a planner keeps reading but loses its read-only commands and browser (the planner has
  neither); an Artisan's Scout keeps them (shell and browser include their read-only variants).
- The Orchestrator never reads a delegated chat's content by any path: its items, hand-off, continuation, the
  commands it ran (app_digest) and the Judge's samples (only root runs are sampled).
- Cursor's skill limit is advisory; the Claude skill and sub-agent gates rest on fixtures until a live run confirms
  them.
- Tests: `test/unit/agents/delegation.test.ts`, `role-gate.test.ts`, `judge-sample.test.ts`, `test/unit/chat-tree.test.ts`,
  `run-steps.test.ts`, `orchestrator-wake.test.ts`, `no-leftovers.test.ts`; e2e `delegation-tree.spec.ts` with real
  MCP calls from the fake Claude.
