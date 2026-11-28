# ADR 0374 · Scheduled activities: the app watches DevOps, Outlook, Teams and Gmail on a timer, at zero tokens until something matters

Date: 2026-11-28 · Status: accepted (owner, 2026-11-28: «al posto di task che non la guardo mai», «lettura mail di devops»,
«Gmail da subito», «nn aprire nessuna issue risolvi te») · Builds on: ADR 0079, 0093, 0182 (the Task page and its reader),
0086, 0370 (the app's own MCP client), 0265, 0280 (the «Giornale»: zero-token reading + one measured AI pass), 0275 (the
Orchestrator counts as the user); partly supersedes ADR 0079, 0093 and 0182 (the Task page goes) · Respects ADR 0325 (no flows,
no scheduled requests, no routines in the app)

## Context

- Only DevOps had a timer (the Task page, off by default, and the owner never opens it). Outlook and Teams are read only when
  someone asks; nothing watches them.
- ADR 0325 removed the automatic flows and the scheduled requests because each due time cost a whole Orchestrator turn. A new
  timer must not bring that cost back: model tokens may be spent only when something has passed a deterministic filter.
- The app already has the pieces: the Task reader (`src/main/tasks`), its own MCP client for the connectors it manages
  (`src/main/mcp-servers`), and the «Giornale»'s shape (read at zero tokens, one hidden AI pass, cost from the engine's report).
- Gmail is a claude.ai connector: it lives only inside Claude chats, and the app cannot call it by itself.

## Decision

1. **An activity** (`src/shared/activities.ts`): `id`, `name`, `source` (`devops` · `outlook` · `teams` · `gmail`), a
   `schedule` (every 5-720 minutes, optionally ISO week days and a local `HH:MM` window that does not cross midnight), a
   deterministic `filter` (senders, title words, mentions only, unread only, no no-reply), `propose` (the user's own sentence
   of what to propose), `dailyCap` (triage passes per local day, default 20, at most 100) and `enabled`. The word is
   «activity» everywhere (code, tools, page), never «flow», «schedule» as a thing, «routine» or «task».
2. **A run** reads the source at zero tokens (DevOps through the Task reader; Outlook and Teams through the app's MCP client
   `tools/call`), keeps only what is newer than the activity's cursor, and applies the filter. Nothing passes → the run ends,
   **0 tokens**. The cursor moves over everything read, not only what was kept.
3. **Triage.** If something passed: ONE hidden pass on the cheapest model, no tools, at most 15 items of 300 characters
   (`clipForTriage`), data in a fence like the «Giornale» (`src/main/news/summarize.ts`). Tokens and cost come from the
   engine's report. A pass is refused once the day's `dailyCap` is reached: the run is `capped` and the activity says so.
4. **Proposals.** Only if the pass proposes actions, the Orchestrator gets ONE grouped news; it asks the user Sì/No, one at a
   time, and respects the focus (`me.md`). Production, databases and Azure still wait for «Esegui»; sending mail or Teams
   needs the user's ok. An activity never acts by itself.
5. **History.** The last 20 runs per activity (`ActivityRun`): status (`idle` · `quiet` · `proposed` · `capped` · `error`),
   read / kept / proposals, tokens, cost, model, error, who started it (timer or «Esegui ora»).
6. **Gmail** can't be read by the app yet. Until the app has its own Gmail connector (Google sign-in, like the other
   connectors; `ActivitiesState.gmailConnector` says which), a Gmail run reads through the model: the cheapest model, the same
   cap, the same measured cost on the run, `usedModel` true. The reader is a separate module so that the connector replaces it
   without touching the engine (`ActivitySourceReader`).
7. **The Orchestrator's tool** `app_activity`: `list`, `create`, `update`, `enable`, `disable`, `delete`, `run`, `history`, `pause`
   (`ActivityToolArgs`; `pause` takes `paused: boolean`, the global pause). No approval: the Orchestrator counts as the user (ADR 0275). `create` and `update` go through the same
   `validateActivityInput` as the page: a wrong field is an error, never fixed silently.
8. **The page «Attività pianificate»** replaces «Task» in the menu: a row per activity (switch, schedule in words, last run
   with read · kept · proposals · cost, «Esegui ora», edit, delete), the detail with the last 20 runs, a global pause, and
   ready-made examples for DevOps, Outlook and Teams. DevOps becomes an activity; its reader is the old Task reader.
9. **Limits.** It runs only while the app is open and the PC is on. A missed time is not caught up: the next one is
   `lastRun + everyMin`, moved into the window (`nextRunAt`).
10. **The contract** (this record's first commit): shapes and pure rules in `src/shared/activities.ts`, the seven invoke
    channels `activities:state|save|enable|remove|pause|run|history` and the event `activities:changed` in
    `src/shared/contract/activities.ts`. No channel is named after the removed concepts (`test/unit/no-routines.test.ts`).

## Consequences

- The standing rules «never automatic loops or crons» and «mail/Teams tours stay off» are overridden for these activities
  only, by the owner's words above; they stay for everything else. A brain change that states this follows the owner's ok.
- A quiet inbox costs nothing; a busy one costs at most `dailyCap` cheap passes a day per activity, shown on the page.
- The Task page, its QA tab, its reading settings (`TaskReadSettings`) and the «Discuti» button went with the integration. The DevOps
  reader (`TaskService`), the `tasks:*` channels, `tasks.enabled` / `tasks.everyMin` / `tasks.sound`, the morning brief and the feed
  kinds `task` / `task-alert` stay: the DevOps activity runs its own read through the same runner, and the other readers still use
  this data.
- Tests: `test/unit/activities.test.ts` (validation, schedule, filter, cursor, clip); the engine, tool and page parts add
  their own (`docs/tasks/scheduled-activities.md`).
