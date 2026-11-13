# ADR 0264 · The app ships how to write a skill, and checks every package

Date: 2026-11-10 · Status: accepted (owner, issue #373: «queste definizioni e scrittura skill debbano stare nell'app
stessa non nel brain dell'utente»; 2026-11-10: «l'harness, le skill e la memoria devono contenere solo quello che
l'agente non può sapere da solo, o per facilitargli la vita e ottimizzare il consumo di token»; «non esagerare,
comunque le skill sono una parte fondamentale dell'app ma ogni skill deve essere ben pensata e ponderata») · Builds
on: ADR 0241 (skill packages), ADR 0257 (skill proposals from Maintenance), ADR 0263 (scripts and queries in skills)

## Context
- How to write a skill lived only in each user's `brain-rules.md`, thin and different per brain; a skill written for
  one symptom did not load for the rest of its area.
- The standards (Agent Skills specification, Anthropic's best practices and skill-creator, Claude Code, Cursor, Codex)
  agree on most of it; where they differ the app must pick one way.

## Decision
- **One app skill, `skill-authoring`** (`brain-template/harness/claude/skills/skill-authoring/`), shipped with the
  other app skills (every brain, new or old, gets it; none is copied into the user's brain). Short on purpose: only
  what a model would otherwise get wrong (extend the skill of the area, a description with what, `Use when` in the
  user's words and `Not for`, the package folders, size, `${CLAUDE_SKILL_DIR}` paths, a trigger check). Its sources,
  read 2026-11-10, and the choices where they disagree are in `references/sources.md`, read only to update it.
- **Checks in code, zero tokens** (`src/shared/skill-lint.ts`): the frontmatter name equals the folder, the
  description says when to use the skill, SKILL.md under 500 lines, every package file SKILL.md names exists.
  Warnings, never a refusal (the errors that block a save stay in `checkMd`). The Skill page shows them on the row
  («N avvisi») and in «Leggi»; `app_skill_write` returns them so the agent fixes them; a unit test keeps every
  shipped skill clean (five descriptions got their `Use when`).
- **Who reads it**: `brain-edit` (step 4), the `app_skill_write` description and the maintenance research's skill
  standard point to it. The template's `brain-rules.md` keeps a pointer and only the user's own choices.

## Consequences
- An existing brain's own generic skill-writing lines are not removed by a migration: their text is the user's and
  differs per brain. `brain-edit` treats them as a duplicate of the app skill (rule 1) the next time it changes a
  skill, or the user asks the Orchestrator to trim them.
- Not tested on a real model: that an agent asked for a skill on one symptom now writes a description for the area.
