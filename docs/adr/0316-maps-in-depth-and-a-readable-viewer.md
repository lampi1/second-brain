# ADR 0316 · Maps in depth, key files in the viewer, and code read as in an editor

Date: 2026-11-15 · Status: superseded by ADR 0363 (the plans replace the maps) · it was: accepted (owner, thread «Capire come esplorare il codice dei progetti», 2026-11-15: «non
vorrei vedere codice, vorrei capire bene come è strutturato senza vederlo e la mappa al momento non è perfetta in
questo, troppi pochi dettagli», «vorrei un link al file chiave … che lo apre nel viewer»; he picked «Tutti e tre» on the
three kinds of detail shown in a draft; then «al momento non posso vedere i file esterni all'app e il codice vorrei
fosse formattato bene leggibilissimo come dal miglior ide») · Amends: ADR 0271 (one level of parts), ADR 0307 ·
Amended by: ADR 0322 (proofs, links and the steps in the panel; its width)

## Decision

1. **More levels.** A part may hold parts of its own (`parent` = a system, an external system or another part), down to
   `MAP_LIMITS.depth` = 4 levels inside the top. The drawing enters a part with pieces the same way it enters a system
   (`levelOf` lifts every link to the boxes shown on the level, the outside ones as context). Removing a piece removes
   everything inside it. A hand-edited file with a loop or a too deep chain loses those parents when read.
2. **More substance.** Each element may carry `rules` (what it applies), `keeps` (what it keeps and where), `why` (the
   decisions behind it) and `keyFiles` (path relative to the map's root + what is there). The side panel shows them in
   sections, with «Quanto è grande»: files and lines under the element's evidence, counted by main without a token
   (`projectmap/size.ts`, bounded: 3000 files, 40 MB, generated and hidden folders skipped, cached for a minute). Every
   key file, a stop's file and an evidence file open in the app's viewer.
3. **Paths.** A map may carry up to 12 `paths`: a question told in 2-12 stops, each on an element with what happens
   there and maybe a file. The side lists them; a path walked lights its boxes with their stop numbers, dims the rest
   and moves the view to the level of each stop (Avanti / Indietro, ← →). «Chiedi un percorso» drafts the question for
   the Orchestrator, whose `app_project_map brief` with `question` starts a Scout that answers it with
   `project_map_update paths`. Stops on a removed piece go; a path left with one stop goes.
4. **Files outside the app.** A relative path in a message (`air_mcp\tools.py`) is looked for in the chat's folder,
   then in the folders of the chats it delegated, the project maps' roots, every other chat's folder (latest first), the
   brain, and one level above each (`file-roots.ts`, at most 60). The first folder where it is a file wins. The viewer
   already opened any local file by its absolute path (SPEC 22), so nothing new becomes readable.
5. **Code as in an editor.** In the viewer, code uses a coding font at 13 px, tabs of 4, a token palette of its own for
   dark and light (functions, types, parameters, properties, decorators and punctuation told apart) and a thin indent
   guide at every level (`brain/lib/indent-guides.ts`).

## Consequences

- The Scout's brief asks for nesting, substance and 3-6 paths; how good those texts are on a real project is untested.
- The demo's orders part holds three pieces with their substance and the last version has two paths; its e2e enters
  the part and walks a path.
- No defect marks were added to the boxes (the owner rejected AI-written ones, ADR 0276).
