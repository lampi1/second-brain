<!-- How the Orchestrator learns the app and changes its configuration for the user; for maintainers of appctl and the renderer's app map. -->
# 0149 — The Orchestrator knows the app and changes its configuration

Date: 2026-10-24

## Context

The owner (2026-10-24): the Orchestrator «non può non sapere come è fatta l'app: deve essere il massimo esperto di ogni
cosa, anche UI e posizione degli elementi, e deve poter modificare ogni cosa richiesta dall'utente», every
configuration. Until now it had `app_state`, `app_screenshot` and `app_ui page`, a page list in a tool description that
had gone stale, and no tool to change a setting: `settings:propose` existed only for the renderer.

## Decision

Three things on the app-control MCP, none of them in the Orchestrator's prompt (they cost tokens only when called, in
line with the token plan, ADR 0089):

1. **`app_guide`** (both mounts, read only). The map is read when asked, from the code that draws the app, never a
   hand-kept description. The renderer answers `window.__sbAppMap()` (`renderer/lib/app-map.ts`): the left rail as it
   is drawn now (groups, pages, shortcuts; a page the work profile hides is absent), every page with shortcut, aliases
   and its subtitle from the dictionary, Memoria's tabs, the Settings sections (`lib/settings-sections.ts`, now the
   page's own source too), the palette's actions with their keys, the «?» help texts (`explain.*`) and the view.
   Main adds the settings schema with each current value, the Guida concepts (`shared/concept-guide.ts`), the active
   routines (read from the flows snapshot) and the caller's own tools. No topic: a short index; a topic: the matching
   entries (Italian word forms meet by their first four letters), at most 15, each capped.
2. **`app_ui` action `outline`** (read only): what is on screen now, one line per heading, tab and control with its
   state, section and position (`window.__sbScreen()`). A chat strip is one line with title and state; the content of
   chats, of the Orchestrator column (except its bar), of the questions window and of the personal Browser page is
   never read (ADR 0083, 0133), nor the value of a text field.
3. **`app_config`** (only the authenticated Orchestrator endpoint): get / set / undo / history over five areas, each
   through the module the app's own page uses: `setting` (every schema key), `view` (theme, density, work profile,
   via `ui:command 'prefs'`, `lib/view-prefs.ts`), `agent` (a role card through the same save as Brain → Agenti,
   undo = the previous version), `connector` (an MCP server on/off and a role's access to it), `later` («Rispondi dopo»).

**Protected settings change at once too** (the owner's pick on 2026-10-24, «Tutto subito»): `ConfigStore.request` takes
`direct` for this caller only, the change is logged as the agent's with its chat id and stays undoable. The old path
(an agent without `direct` gets a proposal card) is unchanged for every other caller. Guards that stay:

- every change needs a message the user typed into this Orchestrator (the renderer's `chat:send`, recorded by
  `appctl/user-words.ts`) in the last 10 minutes, and it must be the Orchestrator's latest message: app news, an
  agent's mail and the Battito card land as user items too, so a chat item alone is no proof, and a turn they woke can
  never change a setting. What remains: content the Orchestrator reads during the user's own turn (a PR body, a page)
  could steer that turn; the Orchestrator's own tools and permission ceiling therefore stay the user's click on its card;
- the outline never reads chat tiles, the Orchestrator column (except its bar), the questions window, the lane of
  waiting requests, notifications, toasts or the personal Browser page;
- secrets, tokens, logins and adding or removing an MCP server stay the user's, in Settings (they hold credentials or
  run commands); production, updates and permissions answered for chats are untouched (ADR 0006, 0074, 0075);
- the renderer applies only the listed view fields with valid values.

A rule line tells the Orchestrator to use these instead of memory, to make the change itself (no work chat) and to start
a routine the user names at once (`app_flow_match`, then `app_flow_start`).

### Routines (amendment, 2026-10-24)

The owner found the Orchestrator sending him to the Routine page to resume a trigger, empty its queue and pause a run,
and saying triggers cannot filter by tag or id. `app_config` area `routine` now makes the Routine page's own calls of
ADR 0155: a trigger on/off (`automation.pause`), every trigger (`control`), the filters (`editFilters`, only the
fields asked, as given), «Svuota coda» with the count the user was told (`clearQueue`, no undo), one run's pause
(`pauseRun`). Same proof of the user's ask as every other change. Approving a new or changed trigger, DevOps write
rights and a prod «Esegui» stay the user's click. `app_guide` shows each routine's trigger state, what it watches, its
filters and queue, and how pauses behave: a paused trigger starts nothing (not even one item); runs already started keep
going but lose its DevOps writes at once; pausing a run lets the step at work finish and starts no new one.

## Consequences

A new page, tab, setting, shortcut or help text reaches the Orchestrator with no extra work. A Settings section must be
added in `lib/settings-sections.ts` (the page renders from it). The outline depends on accessible labels: a control
without one shows by its test id.
