# ADR 0244 · The migration moves a section into its skill, it no longer copies it

Date: 2026-11-09 · Status: accepted (owner, issue #367, «risolvi tutte le issue aperte»; closes #311) · Builds on: ADR
0077 (procedures become skills), ADR 0241 (skill packages), ADR 0243 (topic files no longer loaded)

## Context
The migration turned each runbook / routines section into a skill but left the section in its file. In Davide's brain
58 of 63 skills were copies of sections still there, the brain lint flagged them as duplicates, and a skill forgotten
with an approved «dimentica» came back at a later pass because its source was still found (#311, third time). Some
fragments that are not procedures became skills too: dated diary entries in a runbook, an incident table, a format
example of the agent standard.

## Decision
- **Move.** When a section becomes a skill (or when a skill the first migration made still holds its exact text), the
  section's body leaves its file for one pointer line, `→ Spostata nella skill \`<name>\` il <date>.`; the heading
  stays, so links and the file's outline keep working. Only the section's lines change: the rest of the file keeps its
  bytes and line endings. A pointer is never a section again (`brainmodel/jobs.ts migrate`, `brainmodel/migration-move.ts`).
- **One change per file.** Every move out of one file in a pass (its skills, their scripts, the file with its pointers)
  is one change with one Undo, so undoing never needs the later moves of the same file undone first. A section that
  stays whole is its own change, as before.
- **Scripts and queries.** A file of the brain the section names (`.mjs`, `.ps1`, `.sh`, `.py`, `.sql`, `.kql`, …)
  moves into the skill's `scripts/` and the skill names it as `${CLAUDE_SKILL_DIR}/scripts/<name>` (ADR 0241), only
  when no other text of the brain and no role's text names it. Never moved: the brain's managed `scripts/` and
  `queries/` (their own pages), `ops/`, dot folders, skill folders, binary or non-UTF-8 files, files over 256 KB, a
  script that finds files next to itself (`./`, `$PSScriptRoot`, `__dirname`, `import.meta`, `%~dp0`, …), and any
  script when the brain is too big to read whole (4000 text files).
- **Stays whole.** A section stays in its file, the skill being a copy: when it has lines that look like credentials
  (the skill has them hidden, so the file keeps the only full text); when its file is not plain UTF-8 (an Undo could not
  give the same bytes back); when it has no heading of its own (a numbered file with no title: its frontmatter); when
  the user edited the skill since the first migration; and in a pass the app started by itself (only a pass the user
  starts moves files).
- **An Undo is a decision.** Undoing a move writes `ops/state/migration-kept/<hash>.json` in the brain at once; the next
  passes neither move that section nor recreate its skill, also after the bounded change log dropped the change.
  Deleting the marker allows it again.
- **Not procedures.** A dated heading, a body that is mostly a table, and in rules or playbooks a code block that only
  shows a file format (yaml, json, markdown) are never sections.
- Each section is found again in its file's pending text just before it moves (its stable id, parsed as the file's own
  kind of source, unique), so several sections of one file move in the same pass.

## Consequences
- #311 cannot happen again for a moved section: there is nothing left to find. The forget markers (ADR 0180) still
  cover sections kept whole.
- A forgotten skill's text then lives only in the change history (its Undo).
- Role notes (ADR 0242) are not moved by this job: they stay on disk and in `memory_recall`.
