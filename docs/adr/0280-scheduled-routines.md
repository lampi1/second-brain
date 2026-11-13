# ADR 0280 · Scheduled routines: a request the Orchestrator receives at its time

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «voglio che oltre a farle
come pacchetto da lanciare da terminale se ne possa pianificare una tipo il pianificati di Claude direttamente dentro
l'app … enterprise level, facile da usare, senza blocchi di permessi») · Amends: ADR 0179 (terminal-only routines)

## Context

ADR 0179 left the app with no scheduler: a routine is a package, and only the terminal runs it. That stays right for
packages (they write to DevOps and test databases, unattended). But the user also wants what Claude's scheduled tasks
give: write a request once, and have it done every morning. In the app that needs no new executor, because the
Orchestrator already does any request with the agents.

## Decision

1. A **scheduled routine** (`ScheduledTask`, `src/shared/schedules.ts`) is a name, a request in the user's words and a
   rule: `daily` at HH:MM on chosen week days, `every` N minutes (15 minutes to 7 days), `once` at a date, or `manual`.
   At most 50. Times are the PC's local time.
2. At its time the app **hands the request to the Orchestrator** as an app line (`SchedulesService.fire`,
   `src/main/schedules/service.ts`): the same path as a message of the user, so every rule of the Orchestrator holds
   (ADR 0275: it counts as the user; production, database and Azure writes still wait for his yes). The app runs
   nothing else by itself and never launches a routine package: ADR 0179 holds for packages unchanged.
3. The clock is the app's existing one-minute timer (`tick`). The next time is stored **before** the hand-over, so a
   crash cannot repeat a run. A time missed while the app was closed runs **once** at the next start and the line says
   how late it is; missed repeats are not replayed. A paused routine keeps its rule; resuming counts from now (a `once` that already ran stays done). An
   `every` counts from the hand-over, so it may slip by up to a minute per run.
4. The last 20 hand-overs of each routine are kept with their outcome (delivered, or why not: no Orchestrator open).
   State lives in `userData/schedules.json`.
5. The page Routine shows «Pianificate» above the terminal packages (`ScheduledRoutines.tsx`): one row per routine
   with the rule in words, the next run, the last hand-over, a switch, «Esegui ora», edit and delete; three examples
   to start from.
6. The Orchestrator has `app_schedule` (list, create, update, pause, resume, delete, run): no approval, for the same
   reason as point 2. A routine it made is marked «creata dall'Orchestrator», and its line says so
   instead of calling it the user's own request.

## Consequences

- A scheduled routine runs only while the app is open; it costs what the Orchestrator's work on that request costs,
  nothing while it waits.
- The Orchestrator's rules say which is which: a request to do something at a time is `app_schedule`; a package is
  for the terminal.

## Not tried

A real Orchestrator receiving a scheduled request on a real engine: the tests use a fake send and a fake clock.
