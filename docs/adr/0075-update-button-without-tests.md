# ADR 0075 · "Aggiorna" in Settings: the latest version at once, without the test suite

Date: 2026-10-19 · Status: accepted (owner, 19/10: "nell'app ci sia un pulsante «aggiorna» in modo che si passi alla
nuova versione ma senza lanciare tutti i test, che si passi subito"; "io lo metterei in impostazioni") · Builds on:
ADR 0007 (stable vs dev), ADR 0020 ("Migliora l'app"), ADR 0074 (`npm run pull`) · Amends: ADR 0027 for this button

## Context
After ADR 0074 a developer could update by asking the Orchestrator, then still had to restart, and a stable copy
needed `npm run promote`, which runs the whole check (e2e included) and test:stable. The owner wants one button.

## Decision
1. **Settings → Aggiornamenti** (`AppUpdateSettings.tsx`): the version in use; on open, `scripts/pull.mjs --check`
   (git fetch only) counts and lists what GitHub's `main` has; **Aggiorna** asks once, then:
   - `pull.mjs` in the code folder: fast-forward only, `npm ci` only when the lockfile changed, build;
   - a dev build run from the clone restarts itself on the new build (`app.relaunch`); a failed build does not restart;
   - a stable copy built from a clone is switched by `release.mjs promote-now`: the same clean `main`, build, copy and
     switch as `promote`, **without** `npm run check` and test:stable, then the restart through the launcher, which
     still falls back to the previous release when the new one does not report ready.
2. Only the user's click starts it (IPC `improve:updateNow`); no agent tool promotes. Demo and tests on the real
   checkout never fetch (`offline`). An installed copy (no code folder) is told to use the new installer.
3. `npm run promote` keeps the full checks for whoever wants them.

## Consequences
- One click from "there is something new" to the new version. A broken main can reach the user's copy: the
  launcher's fallback and `npm run rollback` are the safety net, not the tests.
