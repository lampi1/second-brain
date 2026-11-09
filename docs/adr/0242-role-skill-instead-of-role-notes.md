# ADR 0242 · A role's know-how is its role skill; what it learns is a lesson the user approves

Date: 2026-11-09 · Status: accepted (owner, issue #365, «risolvi tutte le issue aperte») · Builds on: ADR 0241 (skill
packages and library), ADR 0129 (what is worth saving) · Changes: ADR 0150 (role memory facts written without cards)

## Context
Davide decided "no more notes": what a role knows goes into its role skill (always read at start) or into the skill of
the task; outside skills only `now.md`, the journal, `ideas.md` and `ai-errors.md` remain. His brain held about 1,700
role notes; in a sample of 130, 55% were procedures, 28% noise and 16% facts. The notes were selected and injected at
every launch (`rules/launch-memory.ts`), and agent_report `remember` / `memory_propose` wrote new ones without asking.

## Decision
- **Role skill.** Each role has a skill named `ruolo-<id>` in the brain's `.agents/skills` (a normal library skill:
  visible, editable, with history). Its body is read in full at every start of the role, the Orchestrator's too, as
  quoted know-how with no permission authority (`skills/lessons.ts roleSkillText`, `agents/pack/flows.ts runtime`).
- **No notes at launch.** The launch no longer selects role notes; the run's context snapshot says no memory was
  loaded. `memory_recall` stays for the scoped archive on demand.
- **Lessons.** agent_report `remember` (up to 3 lines) and `memory_propose` no longer write a note: each line becomes
  a lesson for a skill, the role skill by default or the task skill named by `memory_propose`'s new `skill` field. The
  worth check (ADR 0129) still refuses case-specific lines. Lessons wait in `userData/skill-lessons.json`; the same
  line for the same skill is never asked twice, open ones are capped at 200.
- **Approval.** Each lesson is a card in Memoria → Proposte (source `memory`, group skill, ask `lesson`). Approving
  appends `- <line>` to the skill's «## Lezioni» section through the skill library (creating the role skill when
  missing; an app skill becomes a brain copy): one change with its Undo in the skill's History. Rejecting keeps it
  decided. A lesson card is never applied by itself.

## Consequences
- The existing role notes stay on disk and in `memory_recall`, but no longer reach a launch; moving the useful ones
  into skills is the migration's job (#367).
- A skill in the user's home folders cannot take a lesson (ADR 0241: only the user's own click changes those).
