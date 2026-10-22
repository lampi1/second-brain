# ADR 0077 · Agents and skills only: a self-maintaining Brain section

Date: 2026-10-19 · Status: accepted · Replaces the approval parts of ADR 0073 for skills, agents and lessons (issues
#84, #81)

## Context
The app had three overlapping ideas of "how a job is done": procedures (the Procedure page reading runbooks and
routines from the brain), the skills of the CLIs (the Skill page, which also edited CLI agent files) and each agent's
own pack skill with a `learned-rules.md` filled from corrections, every change queued for the user's approval (ADR
0073). The owner (2026-10-19): only two concepts remain, agents and skills; the brain keeps itself in order; approval
stays only where a mistake reaches the outside world. The Dashboard mixed statistics with the brain map; the agent
cards carried "Avvia" and "Dettagli" (#81).

## Decision
- **Two concepts.** An agent is who works (engine, model, permissions, role); a skill is how a job is done
  (`SKILL.md`, in the brain's `.claude/skills` or `.agents/skills`, or the user's own folders). Procedures are gone
  from the UI, the code, the MCP tools and the docs; old `procedure` links open the Skill page.
- **Agents declare skills** (`knowhow.linked`); the declared skills are preloaded into the agent's run (flows.ts
  runtime instructions), with the agent's own memory and the shared memory.
- **Brain section** in the menu: Agenti, Skill, Regole, Memoria, Classificatori, Mappa (G A, G S, G L, G Y, G K, G B),
  always shown whatever the role. Skill: cards with who uses each skill, the tools it calls, link toggles, the editor,
  the migration report and the maintenance log. Regole: the brain's rules and how they load (always / when relevant /
  not loaded). Memoria: knowledge (customers, environments, people, references), what happened (open threads,
  journal, the logged errors with the rule each produced, moved from the Dashboard) and one memory per agent
  (`agents/<id>/memory.md`, written by the product memory CLI `agent` command; `memory/shared.md` for what several
  agents knew). Classificatori (read only): the routing table (kind → model, effort, why) with per row the chats it
  decided, the verified success rate and the average cost, its history, the outcomes per kind and who chose the model,
  the agent suggested now versus the agent used, and quality by week; a value without data says "nessun dato ancora",
  never zero. Mappa: the graph agent → skills → rules → memory, and the brain's notes map moved from the Dashboard.
  The Dashboard keeps statistics only.
- **Maintenance jobs, no approval.** `repeated-task` (a skill from work repeated across runs), `merge-skills`
  (duplicate skills merged, links moved), `corrections` (each lesson goes to the agent's role, the job's skill or a
  rule: no more `learned-rules.md`), `merge-memory` (a line in several agents' memories goes once to the shared one)
  and the one-time `migration` (runbook and routines sections → skills linked to the right agents, original files
  untouched, credential-looking lines masked, a report). They run six hourly and with "Esegui ora". Every change is a
  logged `BrainChange` (what, why, evidence) with "Annulla", which restores the files and the agent version as they
  were; a change that something newer touched can no longer be undone and says so.
- **Approval stays** only for production actions, permissions / settings / hooks (an agent's `maxContext` proposal is
  a setting and stays under approval), and texts for colleagues or external systems.
- *Superseded by ADR 0125 (2026-10-22): there is no agent export / import any more; the roles are fixed and the whole
  brain is shared instead (ADR 0088).*
- **Export / import.** A pack carries the profile, the declared skills, a generated `TOOLS.md` (tool classes, MCP
  servers, permission ceiling, each skill's allowed tools and scripts) and the brain's rules (topic files and
  `rules/*.md`; never AGENTS.md, CLAUDE.md, me.md, memory, journal or state). Import installs shared skills into the
  brain (keeping the user's copy on a name clash) and the missing rules, all tracked for rollback.
- **Agent card (#81).** No "Avvia" and no "Dettagli" on the cards: a click flips the card in 3D to its details and
  skills, a second click or Esc flips it back; the hidden face is inert; with reduced motion the faces fade. Starting
  an agent happens on its own page.

## Consequences
- The old Procedure page, its IPC and API, the learned-rules approval cards and the CLI agent editing on the Skill
  page are removed; their tests were rewritten (`test/e2e/brain-model.spec.ts`, `skills.spec.ts`).
- Changes made by the jobs are visible after the fact rather than before: the log and "Annulla" are the safety net.
- The "Regole imparate" page (Miglioramento, ADR 0030) is not removed here; the menu clean-up decides it.
