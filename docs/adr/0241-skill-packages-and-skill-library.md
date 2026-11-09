# ADR 0241 · A skill is a package in .agents/skills, with its own page, history and roles

Date: 2026-11-09 · Status: accepted (owner, issues #361, #362, #363, #364, «risolvi tutte le issue aperte», «vorrei che
anche quelle dell'app stessa fossero visibili ed editabili») · Builds on: ADR 0073 / 0077 (changes with log and
rollback), ADR 0076 (brain Script + Changelog pages) · Changes: ADR 0072 for the app's skills (now visible)

## Context
Davide moves the brain to "skills only": rules shrink to a small fixed core and every "how to" lives in one skill.
A skill was one `SKILL.md`, lived in `.claude/skills` (Claude reads it, Codex does not), had no page of its own, no
history beyond the maintenance log, and was given to roles only from the role's page. He wants to create, change and
call every skill by writing to the Orchestrator, and to see and edit the app's own skills too.

## Decision
- **Package (#361).** A skill is a folder: `SKILL.md` (required; its frontmatter `name` equals the folder) plus
  `scripts/`, `references/` and `assets/`. One copy lives in the brain's `.agents/skills`; `skills/layout.ts` moves an
  old `.claude/skills` there once (identical duplicates dropped, a conflict leaves both and is reported), replaces it
  with a symlink (a junction on Windows), ignores it in git and untracks it. Writers of new skills (research,
  candidates, proposals) write to `.agents/skills`. The Claude plugin, the role launch plugin and Codex get the whole
  package (binary files in `assets/`/`references/` are copied raw); the launch text tells the agent to use
  `${CLAUDE_SKILL_DIR}/scripts/…` so scripts work from any folder. The app's own skills ship as whole packages too.
- **Library (#362).** `skills/library.ts` is the one place that reads and writes skills: brain `.agents/skills`, brain
  `.claude/skills`, the user's `~/.agents` and `~/.claude`, then the app's skills, first name wins. Memoria → Skill is a
  two-pane page: list with search and filters (origin, usage, role, area), and the skill on the right with tabs Leggi,
  File (tree + editor, Ctrl+S), Ruoli and Cronologia, plus «Prova» (writes `/name` in the Orchestrator).
- **App skills are visible and editable.** Editing one copies its whole package into the brain, which then replaces it
  («sostituisce quella dell'app»); «Ripristina originale» removes the copy. Skills in the user's home folders are
  edited and deleted in place; without a brain a new skill goes to `~/.claude/skills`.
- **History (#363).** Every write (page, Orchestrator, maintenance) goes through the ChangeLog with job `user` or the
  writer's job: who, when, before/after per file, Undo while the files still match. The page shows it per skill.
- **Roles (#364).** The Ruoli tab switches the skill on and off for each role (the existing `link`), shows the role's
  defaults (removed only from the role's page) and the usage per role. The Orchestrator loads every skill.
- **Orchestrator tools.** `app_skills`, `app_skill_write`, `app_skill_roles` and `app_skill_undo` give it the same
  powers as the page, without approval (ADR 0077: skill changes apply with log and Undo). Every write is checked
  (name, `SKILL.md` frontmatter, paths inside the folder, no symlinks, a stale edit is refused).

## Consequences
- The brain layout itself is unchanged (no upgrade card); the move to `.agents/skills` happens on first use.
- A history entry keeps text snapshots up to the ChangeLog cap (256 KB); a bigger file cannot be undone from there.
- Batch issues 5-9 (#365-#369) build on this: role notes become skills, rules shrink, migration v2, pruning.
