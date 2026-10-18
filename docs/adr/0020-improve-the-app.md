# ADR 0020 · "Migliora l'app": a section and a Regia to change the app, one "Promuovi" button, a clear start notice

Date: 2026-10-12 · Status: accepted

## Context
The user: "Le modifiche che voglio fare all'app voglio farle da una sezione apposita con una regia apposita, in realtà
voglio che un punto forte del mio prodotto sia proprio la possibilità che gli utenti se lo migliorino e customizzino come
vogliono. Vorrei anche in quella sezione avere un chiaro pulsante promuovi che riavvia l'app con l'ultima versione
testata e approvata." The same night a promoted release was marked bad by the launcher (ADR 0007) and nobody was told:
the app simply opened on the previous version.

## Decision
- **A section, "Migliora l'app"** (page `migliora`; sidebar bottom item, top-bar button, `G U`). Nothing in it is
  specific to one user: it works on whatever folder holds the app's code. The top bar was full: the button says
  "Migliora" (icon only below 1360 px) and the brand shows only its mark, name and version in its tooltip (the user,
  2026-10-12). The code folder is set in Impostazioni › "Migliora l'app", apart from the read-only "App" group.
- **Its own Regia**: a chat with `appRegia: true` in the chat space `app` (never `isRegia`, so the work Regia, its
  routing and its layer are unchanged). It gets its own app-control mount, `/mcp/improve`: the same tools as `/mcp/app`
  but it sees, writes to and creates only chats of space `app` (started in the code folder), plus `app_improve_state`
  (read-only). No tool promotes, restarts or merges main by itself: the Regia merges with git, the user promotes.
  Chats of space `app` stay off the work grid, the corsie and the work Regia's questions: they show in the section.
- **Stages, derived from git** (no new state to keep in sync): *In lavoro* = commits not in main and no green check;
  *Testata* = `npm run check` passed on the branch tip (`scripts/check-pass.mjs`, first and last step of `check`: only a commit that was HEAD, clean, from start to end; records the sha in
  `<git-common-dir>/sb-checks.json`, only on a clean tree); *Approvata* = merged into main (the user chose "automatico se
  il check è verde": the app's Regia merges green branches itself); *Promossa* = contained in the release in use.
- **"Promuovi"** runs `node <repo>/scripts/release.mjs promote` (the ADR 0007 path: check, test:stable, copy, switch
  `current.json`) with a clean environment (no `SB_*`, no `ELECTRON_RUN_AS_NODE`), streams its steps, and on success
  restarts through `%LOCALAPPDATA%/second-brain/launch.cmd` at once (the user chose "riavvia subito": chats resume by
  themselves). It is on only in a stable run, with the code folder on a clean main ahead of the release in use; when off,
  the reason is shown in one line. The code folder: the setting "Cartella del codice dell'app", else `repo` in the
  running release's `release.json` (written by `promote` from now on).
- **The start notice**: at start the app compares what runs with `current.json` (`bad`) and the launcher's
  `launch-result.json`: "Partita la versione nuova X", or "La versione nuova X non è partita (reason): l'app è tornata a
  Y". `improve-seen.json` in userData remembers what was told, so each outcome is announced once; the user closes it.

## Consequences
- Improving the app is a product feature, not a developer path: section, Regia, button and notice work for any user.
- One more MCP mount; its scope (chats, requests, runs, feed, logs, maximize; new chats only in the code folder or its
  worktrees) is enforced in `appctl/tools.ts` and covered by unit tests. It separates the two Regie, it is not an
  authentication boundary: like `/mcp/app`, the mount takes any local call with the right Host (security review
  2026-10-12; a per-start token on both mounts is a follow-up for the user to decide). Mail between chats (send_to_chat,
  inbox.mjs) goes by title across both spaces, as before: it is labelled and never an ok.
- Git runs with `core.fsmonitor=false`: a chat could set it in the code folder's `.git/config` and the app would run it.
- A promotion still needs `npm run check` green; a broken release still falls back by itself, and now says so.

Update 2026-10-13: the button "Promuovi" is now "Aggiorna" (the user: "il tasto promuovi dovrebbe semplicemente essere
aggiorna"), with "Aggiornamento in corso…", "Aggiorna e riavvia" and the stage "In uso" (was "Promossa"). Only the
words the user sees changed: the code, `npm run promote`, the stage ids and this ADR's history keep "promote".

> Chat-space behavior below is historical: [ADR 0071](0071-all-workers-in-grindhouse.md) removes the app partition. All workers live in the Grindhouse; source-code launch checks remain.
