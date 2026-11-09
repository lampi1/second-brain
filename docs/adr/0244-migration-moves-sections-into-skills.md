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
- **Move.** When a section becomes a skill (or when a skill the first migration made already holds its text), the
  section's body leaves its file for one pointer line, `→ Spostata nella skill \`<name>\` il <date>.`; the heading
  stays, so links and the file's outline keep working. The skill and the file change in one change with one Undo
  (`brainmodel/jobs.ts migrate`, `brainmodel/migration-move.ts`). A pointer is never a section again.
- **Scripts and queries.** A file of the brain the section names (`.mjs`, `.ps1`, `.sh`, `.py`, `.sql`, `.kql`, …)
  moves into the skill's `scripts/` and the skill's text names it there, only when nothing else in the brain names it.
  Never moved: the brain's managed `scripts/` and `queries/` (their own pages), `ops/`, dot folders, skill folders,
  binary files and files over 256 KB.
- **Never moved.** A section with lines that look like credentials stays whole in its file (the skill has them
  hidden, so the file keeps the only full text). A move the user undid is not made again.
- **Not procedures.** A dated heading, a body that is mostly a table, and in rules or playbooks a code block that only
  shows a file format (yaml, json, markdown) are never sections.
- Each section is found again in its file just before it moves (its stable id), so several sections of one file move
  in the same pass.

## Consequences
- #311 cannot happen again for a moved section: there is nothing left to find. The forget markers (ADR 0180) still
  cover sections kept whole.
- A forgotten skill's text then lives only in the change history (its Undo).
- Role notes (ADR 0242) are not moved by this job: they stay on disk and in `memory_recall`.
