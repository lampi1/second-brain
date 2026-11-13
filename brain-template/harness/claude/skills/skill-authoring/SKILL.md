---
name: skill-authoring
description: How to write or change a skill so it loads when it should and teaches only what a model cannot know by itself. Use before creating a skill, changing its SKILL.md or description, adding scripts/, references/ or assets/ to a package, or splitting or merging skills (brain-edit, app_skill_write, maintenance proposals). Not for using a skill or for the brain's other files.
---
<!-- Shipped skill (the app's, not the user's brain). Sources and where they disagree: references/sources.md. -->

# Writing a skill

A skill is worth its tokens only for what a capable model cannot know by itself ({{OWNER}}'s systems, names, tested
commands, decisions, the steps that went wrong before) or for a procedure that saves a lot of work every time. General
advice a model already follows does not go in a skill. Newer models need less: write the least that makes the task
come out right.

## Before writing
1. Find the skill that already covers the area (the Skill page, `app_skills`, or the brain's `.agents/skills/`).
   Extend it: a new topic is a section of the closest skill. A new skill only for a new area.
2. Name the area, not the case: a skill born from one symptom («the export times out») covers the whole area
   («exports: timeouts, missing rows, wrong format»).

## The frontmatter
- `name`: the folder name, lowercase letters, digits and single hyphens, at most 64 characters, never containing
  `claude` or `anthropic`. Brain skills keep only `name`, `description` and, if needed, `metadata` (other engines ignore
  Claude-only keys).
- `description` (at most 1024 characters, third person) is how a model decides to load the skill. Write: what it
  does, `Use when` with the words {{OWNER}} really asks with (Italian and English, the area's related questions too),
  and `Not for` the near misses another skill covers. Key use first: long lists get truncated.

## The body
- A procedure: steps, exact commands, where things are, how to check the result. Every line is something a future
  task would otherwise get wrong. No task results, one-off ids, dates or paths in a user folder.
- Exact commands for fragile steps (production, migrations); a short direction where many ways work. One default,
  not a menu of options. The same word for the same thing throughout.
- SKILL.md stays short (well under 500 lines). The rest goes in the package, each file linked from SKILL.md with
  when to read it, one level deep:
  - `scripts/`: code to run (say "run", not "read"); it handles its own errors.
  - `references/`: long docs read only when needed; a table of contents on top past 100 lines.
  - `assets/`: templates and data used in the output; saved queries in `assets/queries/`.
- Refer to package files as `${CLAUDE_SKILL_DIR}/scripts/<file>`, with forward slashes, so they work from any folder.

## After writing
- The app checks every save (`app_skill_write` returns `warnings`, the Skill page shows them): fix each one.
- Read the description against 3 real requests that must load the skill and 2 near misses that must not. If one
  picks wrong, change the description, not the body.
- Report in one line what changed and why, in {{OWNER}}'s words when they asked.
