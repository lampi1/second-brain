# ADR 0271 · Project maps: a project drawn in place of its code, kept current by its agents

Date: 2026-11-12 · Status: accepted (owner, issue #385 and the thread of 2026-11-12: «a me serve qualcosa da vedere al
posto del codice, una mappa … la struttura di un progetto nei vari sistemi, connessione, utenti … e l'avanzamento di
ogni agente con un colpo d'occhio»; «entrare dentro un sistema e vedere anche altri sistemi»; «sia tutto sempre
aggiornato, navigabile dall'inizio alla fine e riconsultabile chiedendolo all'Orchestrator»)

## Context

Issue #385 asked for a live panel of a theme's state beside the chat. Three list and tree mockups were rejected; the
owner picked a C4-style drawing: people, the user's systems, the external systems they talk to, environments and
documents, with the links between them, a status on each box and arrow, a zoom into a system's parts, and the agents at
work shown on the boxes they work on.

## Decision

1. **The map lives in the brain**, one folder per project: `projects/<project>/map.json` (the current version) and
   `history.jsonl` (every version, whole, with who saved it and why; the first line and the last 399 are kept). Shared
   types, checks and the layout are pure (`src/shared/project-map.ts`); the files are `src/main/projectmap/store.ts`.
2. **An agent draws it, the app never guesses it.** `project_map_save` (every chat's own endpoint) takes the whole
   drawing: elements (`person`, `system`, `external`, `env`, `doc`, `part` with a parent system), links with a label,
   a status per element and link (`ok`, `work`, `blocked`, `unknown`), who must act when blocked (`user`, `agent`,
   `other`) and the evidence files each element was read from. Each save is a version. The Orchestrator gets a Scout to
   draw or redraw one: `app_project_map brief` returns the task, `app_create_chat` starts it (read-only).
3. **It stays current in three ways, without tokens where it can.**
   - The agents at work call `project_map_update` (`working_on` = their elements, `changes` = new statuses, confirmed now).
   - The app watches every chat's edits (`chat:item` tool rows, diff paths): an edit of a file under an element's
     evidence binds the chat to that element and marks the element changed.
   - A status shows «da verificare» when its files changed after it was confirmed, or when a `work` / `blocked` status
     went unconfirmed for 2 hours (`shownStatus`).
   The bindings and the edit times live in `userData/project-map.json` (`src/main/projectmap/service.ts`).
4. **Mappa → Progetti** (`src/renderer/components/project-map/ProjectMapView.tsx`): one level at a time, laid out in
   rows (people on top, environments and documents at the bottom, at most 4 boxes a row); a click on a system opens its
   parts with the outside elements they talk to around them; breadcrumbs go back. The agents column lists the bound
   chats (waiting for the user first) with their steps, current step and question; a card lights its boxes and opens its
   chat. A slider plays the history from the first version. `projectmap:changed` reloads it live.
5. **The Orchestrator reaches it** with `app_project_map`: `list`, `read` (the map as text with statuses and agents, to
   answer «a che punto è X»), `open` (the page on that project or zoomed into one element), `brief`, `correct` (the
   user's correction, kept in the map and shown to every later drawing).
6. The Orchestrator does not see the chat-endpoint map tools (it has `app_project_map`); Flash sees only
   `project_map_read` (it has nothing to draw or update).
7. The brain is the user's folder: a file that is not a map reads as no map and never hides the others; a map's name
   is its folder's. Parts are one level deep (a part sits in a system); a link's id is never an element's. A redraw
   keeps the map's root unless the agent passes one: a chat in a worktree or a subfolder does not move it. A delegated
   chat in an isolated worktree of the project's checkout (a sibling `.second-brain-*` folder, under a parent chat
   working in the project) counts as working in the project.

## Consequences

- A project the user never had drawn has no map: the page says to ask the Orchestrator.
- How current a status is depends on the agents calling `project_map_update`; what the app sees for free (edits, chat
  state, questions, steps) is always current, and a status it cannot vouch for reads «da verificare», never a guess.
- No new role text: the tool descriptions carry the guidance (the Orchestrator's role is at its size budget).
