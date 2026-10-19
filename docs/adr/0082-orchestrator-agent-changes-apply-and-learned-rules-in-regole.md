# ADR 0082 · The Orchestrator changes agents by itself; learned rules live on the Regole page

Date: 2026-10-19 · Status: accepted (owner, issue #84 leftovers: "agent and skill definition changes apply directly,
with a log and rollback"; issue #76: texts that describe old behaviour) · Amends: ADR 0077 (the `maxContext` line),
ADR 0078 (`agent_update` as "a proposal the user approves"), ADR 0073 (the agent approval queue), ADR 0030 (the
Miglioramento page)

## Context
ADR 0077 made skills and maintenance jobs apply without approval, but agent definition changes from the Orchestrator
(`agent_update`, `agent_rollback`, `agent_archive`, `agent_restore`, `agent_propose`, `agent_learn_propose`) still
waited in the Agenti "Da approvare" inbox, and an agent's `maxContext` was called a setting. The learned rules of the
improvement loop had their own brain page ("Regole imparate" / Miglioramento) beside Regole.

## Decision
1. **Agent definition changes apply at once**, as a new trial version (ADR 0078's trial still runs and can be kept or
   reverted), with a feed event carrying **Annulla** and a record in the Brain section's change log (job
   `orchestrator`, kind `agent`), whose undo restores the previous version or status. Profile fields that apply
   directly: instructions, model, effort, `maxContext`, when-to-use / manifest. `maxContext` is part of the profile,
   not a setting. Archive and restore apply directly too.
2. **Approval stays** only for: production actions; permissions, settings and hooks; an agent's tools / MCP servers
   and `permissionCeiling` (tool permission ceilings); `engine` (another provider's account and spend, governed by
   Settings → Motori, so a setting); texts for colleagues or external systems. A change touching any of these is
   queued with `waitsForUser` naming the fields (`USER_ONLY_FIELDS`, `userOnlyChanges` in main/agents/authoring.ts).
   A change of name or look only is queued as well: it is the user's identity for the agent.
3. New agents (`agent_suggest`, `agent_create`) still need the user's yes; the lifecycle queue (trial keep/revert,
   probation, lifecycle suggestions) stays where it is.
4. **Regole imparate is a section of Regole** (LearnedRules.tsx inside RulesPage.tsx), hidden when the loop is off or
   has no rules. The page id `miglioramento` is an alias of `regole` (PAGE_ALIAS, the Ctrl+K action aliases), so old
   links, shortcuts and saved tabs land on Regole.
5. **Words** (issue #76): user-visible texts say Orchestrator (not Regia), routing by agent (not by kind or area),
   effort and model in the agent profile (not per chat). Code identifiers stay where renaming is risky: `regia*`
   modules, IPC and i18n keys, the brain template's `regia` mailbox, the `/regia` Cursor command and file names, and
   the `Regia` data area keys of older logs; the hooks recognise both titles.

## Consequences
- An Orchestrator can now change an agent's profile without a click; the log, the feed's Annulla and the trial are the
  safety net. Every write of `AgentAuthoring.call()` checks the authenticated Orchestrator itself. A work chat's
  `agent_learn_propose` (its own endpoint) takes no `maxContext`, only lessons for its own open run's agent (role or
  skill, never a rule for every agent), and they wait until the Orchestrator accepts them with the user
  (`agent_lessons_waiting`); a lesson that grants permissions is refused. A name, look or category change waits for the
  user even when it comes with a behavioural change (security review, 2026-10-19).
- The Agenti "Da approvare" inbox shows only new agents, lifecycle decisions and changes to tools, permissions or engine.
- ADRs and the CHANGELOG history keep the old words.
