<!-- Decision record for the brain's Script and Changelog sections: where scripts live, who changes them, how changes are logged, and why no classifier picks them. -->
# ADR 0076: The brain's scripts and its changelog, two sections under Brain

Date: 2026-10-19 · Status: accepted (owner, 19/10: "una sezione dedicata agli script, tutti gli script creati e
riutilizzabili provati che funzionano, piena libertà all'orchestratore per modificarli, aggiungerne, correggerli o
eliminarli … i cambiamenti finiscono nel changelog del brain che farei una sezione a parte … voglio rendere il brain più
visibile in assoluto all'utente") · Builds on: ADR 0072 (a fresh brain starts empty), ADR 0068 (hybrid brain search)

## Decision
1. **Scripts live in the brain**, in `scripts/`, flat, one file each (`.mjs .js .cjs .ts .py .sh .ps1 .rb .sql .cmd
   .bat`). What a script is for sits in its header comment: `@title`, `@description`, `@usage`, `@tags`, `@tested
   <date> ok|failed: <what was run>` (`src/main/brain/scripts.ts`). A hand-written script without a header still shows.
2. **The Orchestrator has full freedom over them, without an approval card** (unlike agent changes, ADR 0073: the owner
   asked for it in so many words). Its app endpoint gets `brain_script_save` (add, edit, `fix`), `brain_script_delete`
   and `brain_changelog_add` (`src/main/brain/scripts-tools.ts`, mounted by `appctl/tools.ts` for the unified
   Orchestrator only). What keeps it safe: a save needs a test result (`tested { ok, note }`); a line that looks like a
   credential is refused (`procedures.ts` `maskSecrets`); a delete moves the file to `scripts/.deleted/`; every change is
   a changelog line the user sees. Nothing in the app runs a script: the workers run them with their own permissions.
3. **Every chat can read them**: `brain_scripts` on each chat's own endpoint lists or finds scripts by words, so a worker
   reuses one before writing a new one. Workers do not write scripts into the brain; they hand them to the Orchestrator.
4. **The changelog is a Markdown file in the brain**, `changelog.md`, newest first, one line per change:
   `- 2026-10-19 10:52 · script · added · scripts/x.mjs · Orchestrator · why` (`src/main/brain/changelog.ts`). Plain
   text the user can read and edit; the app writes it only through the tools above.
5. **Two pages under Brain, always visible whatever the role**: Script (cards in a grid, open in place with usage, code
   with credentials masked, Copia, Apri il file, Discutine) and Changelog (one card per day, a timeline of changes, filters
   by kind), both in the Dashboard's look (`src/renderer/brain/pages/Script.tsx`, `Changelog.tsx`). Data: `/api/scripts`,
   `/api/script`, `/api/changelog`, answered by main; the brain watcher emits `scripts:changed`.
6. **Clean install (ADR 0072)**: no `scripts/` and no `changelog.md` until the first save; both pages show an empty state.

## No classifier to pick scripts (for now)
The agent classifier (ADR 0074) ranks agents from confirmed runs, with thresholds calibrated under approval. Scripts
are a different problem: few, each describing itself in one line, with no history of "this script was the right pick".
A word search over title, description, usage and tags (`findScripts`) plus the model reading the few hits is enough and
costs nothing; a classifier would need labelled outcomes the app does not have. Revisit when a brain holds more than about
50 scripts or when agents keep missing a fitting one: then add the scripts' headers to the hybrid index (by meaning) before
any classifier. This threshold is our estimate, not a measurement.

## Consequences
- The hybrid search does not index scripts (ADR 0068: notes only, scripts may hold tokens); `brain_scripts` is the way in.
- Two app instances writing the changelog at the same moment can interleave lines (one writer per process, no lock).
- Tests: `test/unit/brain/scripts.test.ts`; e2e `test/e2e/brain-scripts.spec.ts` (demo data, `scripts-demo.ts`).
