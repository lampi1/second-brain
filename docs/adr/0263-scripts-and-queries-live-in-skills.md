# ADR 0263 · Scripts and queries live in their skills; the old folders move there by themselves

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: «mi aspettavo che script e query sparissero dalle tab di memoria
dato che sono sempre legati alle skill e che la visualizzazione delle skill dell'app avesse una UI che mostrasse script e
query legati alle skill. Cioè come da documentazione delle skill»; and «Include an automatic, idempotent migration: move
each existing brain-level scripts/ and queries/ file into the skill that uses it (scripts/ or assets/queries/), list the
unmatched ones for the user to assign, and keep a backup») · Changes: ADR 0076 (brain scripts in `scripts/`), ADR 0096
(the auto-save of Esegui runs), ADR 0122 (the Memoria «Script & Query» tab), ADR 0124 (saved queries in `queries/`)

## Context
- The Agent Skills format (agentskills.io/specification) packages a skill as SKILL.md plus optional `scripts/`,
  `references/` and `assets/`. The app kept scripts and queries apart, in the brain's `scripts/` and `queries/`, with a
  Memoria tab of their own, although each one exists for a task a skill describes.

## Decision
- **Where they live**: a script in `<skill>/scripts/<file>`, a saved query in `<skill>/assets/queries/<file>` (a query
  is data the skill's task reruns). `brain/scripts.ts` and `brain/queries.ts` read every skill's folders (brain, the
  user's, the app's: `SkillLibrary.located()`) plus what is still in the old folders (`skill: null`). Ids are
  `<skill>/<file>`; a bare file name still finds the one script of that name.
- **Writers**: `brain_script_save` (Orchestrator) and `brain_script_add` / `brain_query_add` (work chats) take a `skill`
  (a brain skill; an app skill or one of the user's own is refused); a work chat's default is its role's own skill
  (`ruolo-<id>`) when the brain has it. A write or delete is one change of the brain's change log (the skill's
  history, with Annulla); the brain changelog line stays. The auto-save of a reusable Esegui run (ADR 0096) goes in the
  chat's role skill, and is skipped when the role has none; a script removed from a skill is not added back.
- **The move** (`skills/assets.ts`, run by `SkillLibrary.ready()` once per brain per launch): each file in the brain's
  `scripts/` (not `.deleted/`) and `queries/` moves into the one brain skill whose text files (SKILL.md, references…)
  name it (`scripts/<file>`, `queries/<file>` or the bare file name), with those paths rewritten to
  `${CLAUDE_SKILL_DIR}/scripts/<file>` or `${CLAUDE_SKILL_DIR}/assets/queries/<file>`, as one change (job `migration`,
  Annulla puts everything back), after a copy in `<userData>/backups/scripts-queries/<stamp>/`. The same bytes already
  in that skill only leave the old folder (when no other skill names the file). No skill, several skills, another file
  of that name in the skill, a file over the history's limit or not UTF-8 text (a UTF-16 script would come out garbled):
  it stays and is listed. A script keeps its file mode. Idempotent: a moved file is no longer in the old folder, and a
  move the user undid is never done again by itself (listed, «hai annullato lo spostamento»; a marker in
  `ops/state/migration-kept/` keeps it past the change log's last 400 entries). References written `scripts\x.ps1`
  are found and rewritten too; names compare without case off Linux. Writes and deletes touch only brain skills, never
  through a `scripts/` or `assets/` that links out of the skill; an auto-save is skipped for a script removed from that
  same skill, or whose add the user undid. Known limits: Annulla puts a script back without its executable bit, and
  several moves into one skill are undone newest first (each rewrites its SKILL.md).
- **UI**: the «Script & Query» tab is gone; its links (`memoria/script/<skill>/<file>`, G T) open the Skill tab on the
  skill. A skill's «Leggi» shows «Nel pacchetto» by group (Script with title, description, language and last test;
  Query with language; Riferimenti; Asset); a row opens the file in «File». The Skill page lists what the move left
  («N script e query non sono in una skill»): the user picks a brain skill and «Sposta» moves it (`skills:assign`, job
  `user`, the same backup and Annulla).

## Consequences
- Agents find scripts as before (`brain_scripts`, now with the skill and the absolute path); a skill shared or copied
  carries its scripts and queries.
- The brain upgrade (ADR 0116) still writes a query or script it finds in a note to `queries/` / `scripts/`; the next
  launch moves it if one skill names it, else it waits on the Skill page.
- A plain chat (no role) no longer gets its Esegui runs saved as scripts.
