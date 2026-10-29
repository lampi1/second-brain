# ADR 0156 · A routine travels as one package: steps, cited files, rules, skills, roles, scripts and memory

Date: 2026-10-24 · Status: partly superseded by ADR 0179 (app-execution portions); accepted (owner, 2026-10-24: «quando esporto la routine come si porta dietro i prompt e rule
e memoria degli agenti?», after finding that «Esporta JSON» did not; his original ask for routines was "exportable to
cloud agents" with the same results) · Builds on: ADR 0088 (shareable brain zip), ADR 0155 (routine runner, portable
definition with pinned scripts) · Amends: ADR 0088 (a routine package may carry the memory of the roles it uses)

## Context
The portable export (ADR 0155, `flows/portable.ts`) carries a routine's definition: steps, roles, models, typed params
and the pinned scripts/queries. A step's instructions, though, point into the brain by path (`rules/air-dev-qa.md`,
`brain-v2/reviews/`), its role runs with the brain's rules, its skills and its own memory, and none of that was in the
file. On another PC, or in a cloud agent, the same routine found none of it and behaved differently.

## Decision
1. **«Esporta pacchetto»** (Routine page, open routine; `RoutinePackage.tsx`, IPC `flows:packagePreview` and
   `flows:packageExport`, `agents/pack/routine-share.ts`) first shows what the zip will hold, then saves it after the
   guard scan the shared brain uses. The zip:
   - `routine.json` (the portable JSON, unchanged), `ROUTINE.md` (its steps in words), `routine-package.json` (the
     manifest), `AGENTS.md` (how a cloud agent runs it: steps in order, each as its role's subagent, cited paths relative
     to the folder, a role reads its memory first, a prod step is shown and never run), `CLAUDE.md`, `README.md`;
   - the brain files the steps cite: every path-like token in the description, step titles, instructions, evidence and
     args (URLs dropped, a leading brain folder name dropped, a folder = its text files four levels down, at most 120);
     private paths (me.md, now.md, the journal, memory/, agents/, dot folders, credential-like names) never; a cited path
     that does not exist is listed as missing before saving;
   - the brain's rules (`packRules`, as the shared brain), the roles the agent steps use as subagents for each tool
     (`roleFiles`), the skills those roles declare or link plus the ones the steps name (`/name`, `` `name` ``, or a
     hyphenated name), read from wherever they load (brain, home, the app's copy), hooks dropped, and each role's own
     know-how as a skill named after it;
   - the pinned scripts and queries as files at `scripts/` and `queries/` (a redacted one is left out: its hash no longer
     matches);
   - `agents/<role>/memory.md` of those roles, unless the user unticks «Includi la memoria degli agenti». This is the one
     place memory leaves the brain: it is what the role learned, and without it the routine does not give the same
     results. The guard scan still blocks the zip on any deny-listed value.
   «JSON» and «Markdown» stay, as the definition only.
2. **Import** (`FlowImport.tsx` takes a `.zip`; IPC `flows:packageInspect`, `flows:packageImport`) lists what the package
   would write: each cited file, rule, skill and script with its content and whether the brain has it (new, the same,
   different, or a skill already loaded from outside the brain, which is never written). New cited files, skills and
   scripts are ticked; another rule of the exporter's brain and a file that differs from the user's are written only if
   ticked. The zip is untrusted, so what it may write is narrow:
   - a cited file or rule only as a plain note (`.md`, `.txt`, `.json`, `.yaml`, `.csv`), never in `scripts/`,
     `queries/`, `tools/`, `ops/`, `harness/`, a dot folder, a private path, `read-only-tools.md` (what read-only roles
     may run), `TOOLS.md`, `brain.json` or a JSON at the brain root;
   - a script or query only at `scripts/` or `queries/` and only when its text matches the routine's sha256 pin;
   - a skill only whole, never one named like a role (current, retired or Flash), only into the brain (real paths: a
     skill folder that links out of the brain counts as outside);
   - every path through `brainPath` (no link on the way), never over a folder, at most 256 KB a file (the Log's undo
     copy limit; bigger files are not offered).
   Each picked item is one brain change log entry (job `user`) so the Log lists it and «Annulla» puts the old text back;
   a change log write is all or none (a failed write puts back the files it already wrote). The routine becomes a new
   draft after the writes (as any import, never active). With «Aggiungi la memoria degli agenti» each memory line
   becomes a proposed fact of that role (`writeAgentMemory`, worth gate included), reviewed in Memoria. The confirm
   call carries the digest the preview showed: a changed zip is refused.
3. The Orchestrator's guide (`appctl/guide.ts`) says what both buttons do; both stay the user's clicks.

## Consequences
- A role's instructions are not imported: the roles are fixed (ADR 0125) and the same in every app of a version.
- A role's own know-how travels for cloud agents but is not written by an import (it belongs to that role's versions).
- Path detection is textual: a path written without a slash or a known extension is not found; the preview lists what
  was found and what is missing, so the user can fix the step text.
