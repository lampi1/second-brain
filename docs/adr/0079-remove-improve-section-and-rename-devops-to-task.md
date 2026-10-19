# ADR 0079 · "Migliora l'app" removed; DevOps renamed Task; Fatto becomes a log

Date: 2026-10-19 · Status: accepted · Supersedes the section of ADR 0020; amends ADR 0016, 0029, 0045

## Context
The owner (issue #82, part 2): remove the "Migliora l'app" / "Personalizza l'app" section completely: page, entry
points, chat preset, `/mcp/improve`, texts, docs, tests. Since ADR 0071 its chats already lived in the Grindhouse with
every other chat, and the unified Orchestrator (ADR 0068) creates the app-code chats itself, so the section had become a
second entry to the same work. Updating stays: «Aggiorna» in Settings → Aggiornamenti (ADR 0075), the Orchestrator's
`app_update_code` (ADR 0074), `npm run promote` / `npm run rollback` from a terminal (ADR 0007).

The owner (issue #85): rename DevOps to "Task" everywhere (settings keys with the stored values migrated, IPC, MCP,
docs, tests); the import stays automatic as today; "Fatto" becomes an ordered log, newest first, grouped by day, with
who, when and a link; the look matches Agenti and Guida.

## Decision
**"Migliora l'app" is gone.**
- Removed: the page `migliora` (`G U`), its top-bar "…" entry, the command-palette and sidebar entries, the
  `appRegia` chat preset, the `/mcp/improve` mount with `app_improve_state` and `app_improve_evidence`, the proposal
  panel and its IPC (`improve:*`, `proposal:*`), the branch stages and the legacy in-app promotion (it was already hard
  off behind the staged updater). An old `chats.json` with `appRegia` or `space` loads as before: `migrateOrchestrator`
  turns that Regia into a normal chat of the Orchestrator and drops `space`.
- Moved, not removed: what «Aggiorna» and the Orchestrator need now lives in `src/main/update/`. `source.ts`
  (`AppSourceService`: main's tip as the candidate, `pull()` for `app_update_code`, `sourceCheck()` / `updateNow()` for
  the Settings button, `release.mjs promote-now` and the restart on a stable copy, `inRepo()` for the routing area App)
  and `launch.ts` (how the last start went, told once). IPC `source:get`, `source:check`, `source:updateNow`,
  `source:dismissLaunch`, event `source:state`. The start notice's marker is `launch-seen.json` (an old
  `improve-seen.json` is read once and removed); the test variables are `SB_UPDATE_REPO`, `SB_UPDATE_STABLE`.
- The staged updater's panels (prepared package, recovery) show in Settings → Aggiornamenti, and only when the
  installation has that updater, a package or a problem: a clean install shows no machinery.
- `app_update_code` stays on the Orchestrator's token mount only, and only right after the user asked (ADR 0074).

**DevOps is Task.**
- Page id `task` (old links `devops`, `oggi`, `adesso`, `dafare` open it; `G O` unchanged), menu label "Task"
  ("Tasks" in English), IPC `tasks:get`, `tasks:refresh`, `tasks:markRead`, event `tasks:state`, settings
  `tasks.enabled` / `tasks.everyMin` / `tasks.sound`, feed kinds and mutes `task` / `task-alert`, main module
  `src/main/tasks/`, its cache `tasks.json`, the `app_ui` page value and the `app_digest` field.
- Migration, once and silent: `config.json`'s `devops` block and the `mute.devops` / `mute.devops-alert` keys load as
  the new keys and the file is written once with only the new names (a `tasks` block already there wins); `devops.json`
  is renamed to `tasks.json` at the first start; saved role pages and home page `devops` become `task`.
- Kept with their Azure names, because they describe Azure DevOps records and tools, not the section: the record types
  (`DevopsItem`, `DevopsPr`, …), the brain script `devops-me.mjs` (renaming it would break every existing brain), the
  `DayReport.devops` flag, the "Apri in DevOps" links and the texts about the Azure read ("DevOps non letto").
- The page takes Agenti's language: `catalog-head` (title, subtitle, Aggiorna ora), the `catalog-filters` toolbar for the
  automatic read, its interval and the sound, number cards as `catalog-card`s with the entrance animation (off under
  reduced motion), sections as the same gradient cards, empty states as Agenti's intro box. Its sections and their
  test ids are unchanged ("non cambiarla troppo", 2026-10-12).

**Fatto is a log.** `brain/lib/done-log.ts` turns each day report (PRs, work items, the diary's `fatto` / `verificato`
/ `decisione` lines, Claude and Cursor chats) and the app's chats (a turn that ended well, or work completed) into
entries with what, who, when and a link, newest first; a report chat that is also an app chat is listed once, with its
agent's name and an in-app link. Who: "Tu" for the user's PRs, work items and diary lines; the agent or the engine for a
chat. Three days by default, "Mostra altri giorni" adds three (each day loads on its own: a past day's first read can
take up to 40 s). `day.mjs` now gives PRs and work items a `time` (Rome). The filter that hid the app's own work
(`lib/appwork.ts`, made for "Migliora l'app") is removed: that work has no other place now. Lessons and frictions stay
in the diary file, not in the log.

## Consequences
- One way to change the app: ask the Orchestrator; one way to update it: «Aggiorna» (or `npm run pull` / `promote`).
- A user who muted the DevOps alerts keeps them muted; the automatic read keeps its interval and sound.
- Fatto no longer has the day's diary table or the topic grid; the technical report stays folded in each day's card.
