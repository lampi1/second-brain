<!-- Work split of the «Attività pianificate» feature (ADR 0374): four parts built in parallel from one contract, and who owns which files. -->
# Scheduled activities: the four parallel parts

The contract is done and fixed: read it first, then build your part. Change it only through the integrator (a part that needs a
different shape asks; it never edits another part's files).

- Decision and rules: `docs/adr/0374-scheduled-activities.md`.
- Shapes and pure rules (validation, `nextRunAt`, filter, cursor, triage clip, templates): `src/shared/activities.ts`.
- IPC: `src/shared/contract/activities.ts` (7 invoke channels) and the event `activities:changed` in `src/shared/contract.ts`.
- Placeholder handlers (answer «not ready»): `src/main/ipc-handlers/activities.ts`, wired in `src/main/index.ts`.
- Names: «activity» everywhere. Never «flow», «routine», «scheduled request» (ADR 0325; `test/unit/no-routines.test.ts`).

## The parts

| Part | Owns (only it edits) | Builds |
|------|----------------------|--------|
| **engine** | `src/main/activities/` except `sources/gmail.ts`; `src/main/ipc-handlers/activities.ts`; the wiring line in `src/main/index.ts`; `test/unit/activities-*.test.ts` | The service: store (activities, cursors, history 20 per activity, pause), the timer (`nextRunAt`, only while the app is open), the run (read → `selectNew` → `clipForTriage` → ONE hidden triage pass on the cheapest model with no tools, pattern `src/main/news/summarize.ts`, cost from the engine's report → daily cap → one grouped news to the Orchestrator), readers `sources/devops.ts` (the Task reader, `src/main/tasks`), `sources/outlook.ts` and `sources/teams.ts` (the app's MCP client, `src/main/mcp-servers`, `tools/call`, zero tokens), the real handlers, the `activities:changed` event. Last, once the page part has landed: removes the Task service, the `tasks:*` channels and the `tasks.*` settings. |
| **tools** | `src/main/appctl/activities.ts`; the `app_activity` entry in `src/main/appctl/tool-catalog.ts`; `test/unit/appctl-activities.test.ts` | The Orchestrator's `app_activity`: `list`, `create`, `update`, `enable`, `disable`, `delete`, `run`, `history` (`ActivityToolArgs`), no approval (ADR 0275), `id` may be the activity's name, arguments through `validateActivityInput`, answers in the user's words, the tool text lists the filter fields and the daily cap. Calls the engine's service through the same handlers as the page (never a second path to a write). Docs of rule 13 (tool catalog, README) go in the same change. |
| **page** | `src/renderer/components/activities/**`; `src/renderer/store/activities.ts`; `src/renderer/lib/activities.ts`; the menu entry and route (`src/renderer/components/Sidebar.tsx`, `src/renderer/lib/app-map.ts`); removes `src/renderer/brain/pages/Task.tsx`, `src/renderer/store/tasks.ts`, `src/renderer/components/TaskReadSettings.tsx` (their uses move over); the e2e spec with a screenshot; README screenshot | The «Attività pianificate» page replacing «Task»: a row per activity (switch, `scheduleText`, last run read · kept · proposals · cost, «Esegui ora», edit, delete), the editor (source, `describeSchedule`, filter, sentence, cap; wrong fields show `validateActivityInput`'s errors), the detail with the last 20 runs, the global pause, the ready-made templates, the Gmail note («costa token a ogni giro finché l'app non ha un suo connettore»). Italian UI. Works on the placeholder handlers (empty state), so it can be built before the engine. |
| **gmail** | `src/main/activities/sources/gmail.ts`; `test/unit/activities-gmail.test.ts` | An `ActivitySourceReader` for `gmail` (`src/shared/activities.ts`). Zero tokens when the app has its own Gmail connector (Google sign-in in Impostazioni → Connettori, like Outlook and Teams, through the app's MCP client); until then the model fallback: the cheapest model reads the mailbox through the claude.ai Gmail connector (one hidden turn, nothing else), returns `ActivityItem`s and `usage` (tokens, cost, model); the engine adds it to the run and counts it against the daily cap. Never throws for an expected failure: returns `error` in the user's words. Exposes whether the connector exists for `ActivitiesState.gmailConnector`. |

## Rules for everyone

1. Shared files (`src/shared/contract.ts`, `src/shared/activities.ts`, the ADR) belong to the integrator; ask for a change.
2. Every file starts with a header comment (what, why, who uses it); unit tests for every module; no load-sensitive tests.
3. The engine takes the readers as `ActivitySourceReader` objects so that the engine, the tools and the page can be tested with fakes
   before the real sources exist.
4. A branch's gate: `npm run check:quick` green, a clean Sentinel, the guard; merge to `main` only when verified (rules 7-9).
5. Nothing is sent, deleted or run on production by an activity: it only proposes (ADR 0374 decision 4).

## Wiring notes: the tools part (`app_activity`)

- `src/main/appctl/activities.ts` exports `activityTools(svc)` and `ActivitiesControl` (`state`, `save`, `enable`, `remove`, `run`,
  `history`: the same shapes as the page's `activities:*` handlers, each may be sync or async). `appctl/tools.ts` already mounts it
  on the Orchestrator's endpoint when `AppControlDeps.activities` is set (the only touch outside the part's files).
- **Integrator, once the engine has landed:** pass the engine's service as `activities` where `news` is passed to `appControlTools`
  (`src/main/index.ts`), mapping `save` ← `activities:save`, `enable` ← `activities:enable`, `remove` ← `activities:remove`, `run` ←
  `activities:run`, `history` ← `activities:history`, `state` ← `activities:state`. No adapter is needed if the service methods keep
  those argument shapes. Until then the tool is simply not offered.
- The global pause has no action in `ActivityToolArgs`: `list` only reports it. Add `pause` to the contract if the Orchestrator
  should flip it too.
- The page's route is unknown to the tool, so `create` does not open the page (the Giornale's tools do via `emitUi`); add it with the
  page's route once it exists.
- The `activities` concept card (`src/shared/concept-guide.ts`) describes the page's behaviour in words; the page part should extend
  its points and sources with the page's files and screenshot.

## Integration status

All four parts are merged on `feat/scheduled-activities` and wired in `src/main/wiring-builders.ts` (`buildActivities`): the
engine's timer starts and stops with the app; readers are DevOps (`devops-me.mjs`, the same runner as `TaskService`), Outlook and
Teams (`mcpReader` through `McpGateway.callServer`, the app's own caller `#app-activities`) and Gmail (`createGmailReader` over the
first MCP server whose id contains «gmail»; none = the visible error «connettore Gmail non collegato»). The triage pass is a hidden
no-tool `haiku` run; a proposal reaches the Orchestrator as one grouped news (`OrchestratorWake.activityNews`, a «stalled» line
tagged `activity`). `app_activity` has the global `pause` action. The Task page is removed; old links (task, oggi, adesso, dafare,
devops) open «Attività pianificate» (`PAGE_ALIAS`).
