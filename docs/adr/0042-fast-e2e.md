# ADR 0042 · Fast e2e: parallel workers, exclusive specs, close without Electron's teardown

Date: 2026-10-13 · Status: accepted

## Context
The e2e suite (166 tests in 57 specs, about 125 app launches) ran with one Playwright worker under the machine-wide
`sb-tests` turn (the brain's `env-lease.mjs`): on 2026-10-13 more than 10 app chats queued 1-2 hours each for it. The
owner (2026-10-13, "non possiamo risolvere sta cosa dei test?") gave a free hand: the full `npm run check` on main well
under 20 minutes, the branch check fast, no assertion weakened.

Measured on this machine (14 logical cores, CPU already at ~100% from the other chats):
- a launch-and-close of the app took 19-29 s, of which **12-22 s after the app had quit**: its own quit took
  12-24 ms ("quit started" → "exit" in its log) and the rest was Electron's teardown after `app.exit(0)`. A bare
  Electron 44 app (one hidden window, a data: URL) takes the same: 27-60 s from `app.exit(0)` to the process gone,
  `process.exit` the same, a SIGKILL of itself 8.6 s. Not the app's to fix (the quit itself is fixed on
  fix/integrazione-1013); no test checks that time but the one in chats.spec, which waits for it by itself.
- from launch to the settled demo: 8-13 s (Electron start to the window 3-6 s, the renderer's first render 3-4 s).
  The demo services start in under 1 s: nothing to cut there.
- every launch was already isolated except two points: each one runs `git status` on the repo it was built from
  (the "Migliora l'app" state), which may take `.git/index.lock`; and `windowShot` falls back to "the window named
  second-brain", another instance's with several running. Ports are 0, profiles and brains are fresh temp folders.

## Decision
- **Two Playwright projects** (`playwright.config.ts`). `parallel`: every spec file not listed, files side by side.
  `exclusive`: the specs in `EXCLUSIVE`, with the reason for each (frame times and fps budgets: map-perf, map-live;
  the quit timed against a budget: chats; hang and reload delays: stability; the real system clipboard read back:
  brain-nav, devops-qa, genui, navigation), one at a time and after the parallel ones. A new spec that times things
  or reads the system clipboard goes in `EXCLUSIVE`; a unit test checks the list.
- **Workers from the machine** (`scripts/e2e.mjs`, `npm run test:e2e`): `SB_E2E_WORKERS` when set, else cores/4 (at
  most 4), half over 60% CPU busy, 1 over 90%, at most one per 0.6 GB of free memory. Plain `npx playwright test`
  still runs one worker.
- **close() returns when the app has quit** (`helpers.ts`): once its log has a new "exit" line (written
  synchronously after the shutdown and the storage flush); the process ends in the background and a relaunch on the
  same profile waits for it (single-instance lock, files). chats.spec still waits for the process itself.
- **The full check in parallel** (`scripts/check.mjs`, `npm run check`): build, then typecheck, lint and unit beside
  the parallel e2e project (one worker less), then the exclusive specs alone (`check:branch` runs no e2e since
  2026-10-15, ADR 0027). The unit tests that start real processes run alone after
  the parallel e2e: beside three Electron instances their deadlines missed (chats/manager, resume and proctree on
  7cb1a39; brain/cursor-ledger, chats/handoff and warm on e87f321, 2026-10-14); no deadline was loosened. A rule finds
  them (`scripts/process-units.mjs`), so a new one is never chased by hand: the file imports `node:child_process`, uses
  a fake engine fixture, builds a `ChatManager`, or imports (for code, at any depth) a src module that imports
  `node:child_process` (38 of 108 files on e87f321); `EXTRA` lists any the rule cannot see. A red step no longer stops the others: one run shows every failure. A filter matching no test fails, as Playwright does.
- **The repo's git**: the app's git reads run with `GIT_OPTIONAL_LOCKS=0` (never the index lock: a chat's commit in
  that folder no longer fails because the app, or an e2e instance, ran `git status`). `windowShot` falls back to the
  window by name only when there is one so named. The "Migliora l'app" state runs its independent git reads together
  (two rounds instead of seven git starts in a row): under the parallel suite the start notice waited over 5 s for
  them, and improve.spec failed on it.
- **No app reused across the tests of a file**: each test keeps its own fresh app; sharing one would change what a
  test starts from. Fixed sleeps stay: the long ones check that nothing happens for a while (no second auto-close, no
  early wake, one delivery), which a wait for an event cannot prove.
- **The `sb-tests` turn**: see Consequences: shared slots for light checks are proposed, not in place.

## Measurements
Same machine, same evening, CPU 56-100% busy from the other chats (numbers under load, not on an idle box).

| | before (main ebb4222, 1 worker, the Regia's run) | after (feat/test-veloci, 3 workers) |
|---|---|---|
| full e2e, wall | 21.0 min (177 tests) | 11.9 min and 13.7 min (two runs; parallel 8.7/9.7 + exclusive 3.1/3.9) |
| per test p50 / p95 | 5.6 s / 17.4 s | 8.8 s / 22.2 s and 10.2 s / 26.7 s |
| sum of test times | 20.0 min | 26.9 min and 30.2 min |
| failures | 4 (navigation, procedure: the clipboard; regia: time zone; settings) | run 1: improve.spec (cause fixed above); run 2: chats.spec, the app's quit took 15.4 s against 12 s, alone in the exclusive project (the quit itself, fixed on fix/integrazione-1013) |

One launch and close of the demo app: 19-29 s before, 5-8 s after (smoke.spec, second-instance.spec: the close no longer waits for the teardown).
Reliability: the 10 slowest files (ui, regia-overlay, stream, paste-images, usability, review, command-asks, questions,
regia, usage) with --repeat-each 2 at 3 workers: 110 of 110 passed, no flaky test, 9.4 min.
Not the same commit: the after runs had 166 tests (main 5fbf718 plus this branch), the before run 177 on a later main
that already had the quit fix; the load of the other chats differed too. Per test, a parallel run is slower (p50
8.8-10.2 s against 5.6 s: the instances share the CPU); the wall time drops by about 1.5-1.8x at 3 workers on a box
already busy. On an idle box the formula gives 3 workers and the gain should be larger: not measured.

## Consequences
- The full check holds the `sb-tests` turn for about 12 minutes on this machine under load, instead of 21 minutes.
- Shared turns: `env-lease.mjs take|wait sb-tests --shared` (up to 3 light checks at once, a full check alone,
  FIFO; the exclusive form unchanged) is written and tested offline (patch and tests in
  `second-brain-app-wt/_proposte/`), not applied: changing the brain's tools is the owner's call (the agent's edit was refused).
- The tests still write the user's real clipboard (Copia in codeblocks, navigation, …), as before.
