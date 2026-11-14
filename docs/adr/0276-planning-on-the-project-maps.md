# ADR 0276 · Planning on the project maps: the Strategist proposes a map, the app keeps it live

Date: 2026-11-13 · Status: accepted (owner, thread of 2026-11-13: «vorrei che si potesse modificare in corso d'opera
aggiungere pezzi insomma fosse la base per la pianificazione»; «solo l'orchestrator può fare modifiche alla mappa e mi
piace che rimanga la chat dell'orchestrator a destra, l'orchestrator deve sempre sapere dove è l'utente e che mappa sta
visualizzando ma in generale ogni punto dell'app»; «lo stratega deve proporre le mappe non più i piani come oggi e ogni
riquadro un agente o N agenti»; «se uso la plan mode … voglio che si utilizzino le mappe, per task su cui non uso la
plan mode invece no»; «il sync automatico deve essere invisibile per l'utente e consumare pochi token»; «le mappe già
fatte devono funzionare bene») · Builds on: ADR 0271 (project maps), ADR 0108 (the Strategist's plan), ADR 0275 · Amended by: ADR 0307 (opened by the user the map starts full screen)

## Context

The project maps showed what a project is and where it stands, never what will be done. A new box meant a whole redraw
by a Scout; the Strategist's plan was a list of steps on its strip, unrelated to the drawing; a status stayed current
only if agents remembered to call `project_map_update`; a message the Orchestrator sent to an agent at work left no
trace on the map; and the Orchestrator learned what the user had on screen only by asking for the screen outline.

## Decision

1. **A piece that does not exist yet is `planned`** («previsto», drawn dashed): a fifth status, never stale. An
   element may carry `plan` (the Strategist chat that added it) and `addedAt` (drawn «nuovo» for an hour). Maps saved
   before this read as they did: both fields are optional and no status changes meaning.
2. **Only the Orchestrator changes a map by hand, from the talk with the user**: `app_project_map edit` takes ops
   (`add`, `set`, `remove`, `link`, `unlink`; `shared/project-map.ts applyEdit`, checked as a whole drawing) and makes
   one version; `undo` brings the version before back as a new one. There is no editing on the drawing itself.
3. **In Plan mode the Strategist proposes the map.** `plan_propose` takes `map` (the project; `add` and `links` = the
   pieces that do not exist yet) and an `on` per step (the element it works on; an element may hold several steps and
   agents). A project with no map gets one made of the touched pieces only. A second proposal takes the first one's
   unstarted pieces back; a plan dropped before the user's ok takes all of them. The approval is the one of ADR 0108
   («Approva e parti», also from the map). Work started without Plan mode draws nothing.
4. **A piece found on the way joins the plan with no new approval** (owner: «lo aggiunge e va avanti»):
   `plan_update add` appends one step (up to 16 in all), on an existing element or on a new `piece`; the drawing marks
   it «nuovo».
5. **The map follows the plan without tokens.** The steps are read from the plan each time the map is shown (the
   view's `works` and `plans`), never copied into the map file. On every `chat:updated` of a chat whose plan is drawn
   (`projectmap/service.ts syncPlan`) the chats delegated for a step are bound to its element, and the element's status
   follows its steps: one under way → `work`, all done → `ok` (owner: green when the agent says done, no mandatory
   Sentinel), one blocked → `blocked`. A version is saved only when a status really changes. An element with a step
   under way never reads «da verificare». Agents are no longer asked to report on planned work.
6. **A change sent to an agent at work shows on the map until the agent takes it.** `app_send_to_chat` gains `now`
   (interrupt the current step first: a change of course; without it the message waits for the next step: an
   addition). The Orchestrator chooses from the user's sentence. The map shows the change on the agent's card with
   «inviata» and then «ricevuta» at the end of the turn it waited behind.
7. **The Orchestrator is told where the user is.** The renderer sends one line with each message to the Orchestrator
   (`renderer/lib/where.ts`: page and place inside it, open window, project map with level and selected box, enlarged
   chat); main adds it to the engine's text only when it changed since last told, and for a phone message says he is
   not at the PC. Never in the user's bubble; no tool call.
8. **The map opens beside the Orchestrator's column**, not over it: «Mappe» and `app_project_map open` go to the
   Mappa → Progetti page (full screen stays a button on the drawing).
9. Agents and the Orchestrator read the map as text (`mapText`: now with each element's works and the plans drawn on
   it); the drawing is for the user.

## Consequences

- The Strategist's flow text grows by two sentences; no new tool (two tools gain fields), no new role text.
- A plan with no `map` works as before (the step list on the strip): work that is not on a project.
- Statuses moved by a plan are the plan's word («the agent said done»), not a verification.
- Not done: steps reordered by drag, dependencies between steps drawn as arrows, estimates on planned pieces.
