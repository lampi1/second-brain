# ADR 0325 · Routines leave the app

Date: 2026-11-19 · Status: accepted (owner, issue #450: «The app should have nothing to do with routines», and the
thread «Togliere le routine dall'app»: «Tutti e due: la parte dentro l'app e anche il motore da terminale
packages/routine-runtime. Il motore lo spostiamo nel mio brain, che da ora ne è il proprietario. Però
packages/routine-runtime toglilo solo quando ti confermo che la copia nel brain funziona … La parte dentro l'app puoi
toglierla subito, ma lascia intatte le cartelle dei giri già fatti»; on scheduled requests he chose «Togli anche
quelle») · Supersedes: ADR 0281 (scheduled requests) and what ADR 0179 left of the routine section in the app
(package authoring, export, run reading); ADRs 0155, 0156, 0165, 0175 and 0176 for their app side

## Context

After ADR 0179 the app no longer ran a routine: the terminal CLI of `packages/routine-runtime` did. The app still
had a Routine page (saved packages, their secrets, the run folders read on demand, the archive of the old in-app
runs), six Orchestrator tools to write, save, export and read packages (`app_routine_*`), a rule about them in every
Orchestrator session, and, since ADR 0281, scheduled requests on the same page (`app_schedule`).

The owner wants routines out of the app: the engine is his own tool, kept in his brain, not a function of a public
app. His routines run today with the package in this repository, so that part waits.

## Decision

1. **The app has no routine section.** Removed: the Routine page and its components, the `routines:*` channels, the
   main-process stores behind them (`src/main/routines`, `src/main/flows`), the Orchestrator tools
   `app_routine_export`, `app_routine_status`, `app_routine_capabilities`, `app_routine_connectors`,
   `app_routine_save`, `app_routine_packages`, the routine rule of the Orchestrator's role, the Guida concept, the
   README lines, the page's mockups and tests.
2. **No scheduled requests either.** Removed: the service, the `schedules:*` channels, the tool `app_schedule` and
   its rule in the Orchestrator's role. A request that repeats is the user's to ask, or the work of whatever he runs
   outside the app.
3. **Nothing on disk is deleted or rewritten.** The app no longer reads or writes `userData/routines`,
   `userData/routine-runs`, `userData/flows`, `routine-site-credentials.json` and `schedules.json`; they stay where
   they are, and so do the run folders of the terminal engine (it owns them and still reads them).
4. **Old routine chats stay in `chats.json`, unread.** The records the old in-app executor left there (marked
   `routineArchived`, `routine` or `routinePackage`, and the chats started under them) are set aside when the file is
   read and written back unchanged at every save (`ChatStore`, `retiredIds`). The app never loads them: no tile, no
   engine session, no cost row, and their old runs are not handed to the Orchestrator at start.
5. **What went with it**, because only routines used it: the `routineTest` flag of an MCP server, the sealed context
   mode and its package digest (`AgentContext.mode` is always `scoped`), `browserWrite` in a delegation's result, the
   site-login vault of the routine browser, the `SB_ROUTINE_*` branches of the engine sessions.
6. **The terminal engine stays for now.** `packages/routine-runtime`, its tests, its guide (`docs/routines/`) and the
   shared types it imports (`src/shared/flows.ts`, `flow-automation.ts`, `flow-connector.ts`,
   `flow-reconciliation.ts`) are untouched, and `src/main/log.ts` and `src/main/rules/storage.ts` still take `mask` and
   `fs-util` from it. They leave this repository in a second step, only after the owner confirms that the copy in his
   brain works; that step brings the two helpers into `src/main`.

## Consequences

- A user who had scheduled requests loses them without a notice in the app: after the update nothing starts at their
  time. `schedules.json` keeps their text.
- A package saved on the Routine page is still a folder under `userData/routines/<id>/`; `routine run <folder>`
  runs it as before. The app no longer exports a zip or fills secrets.
- Site passwords typed for routines stay encrypted in the profile and can no longer be read from the app.
- A link to the old page (`flussi`) opens nothing; the shortcut `G U` is free.
- Until step 6 is done the repository still builds and tests the engine.

## Alternatives

- **Keep scheduled requests as a page of their own.** They did not use the engine and were built and proposed that
  way first; the owner chose to remove them too.
- **Delete the old routine chats from `chats.json`.** Refused: the owner asked that nothing of the past runs be
  touched, and a rewrite of his chat file to drop records is not ours to decide.
- **Keep hiding guards for routine chats across the chat manager.** About forty conditions in ten files for records
  the app must never show: one pass in the store does the same with less code.
