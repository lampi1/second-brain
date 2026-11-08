# Stable vs dev, and how an agent verifies a change

Moved from `AGENTS.md` (ADR 0198).

## Stable vs dev (ADR 0007)

The user's cockpit is a frozen release in `%LOCALAPPDATA%/second-brain/releases/` started by
`%LOCALAPPDATA%/second-brain/launch.cmd` (userData `second-brain`, MCP 4319). Anything run from this repo is the dev
instance (userData `second-brain-dev`, MCP 4329; `npm run doctor -- --dev`, `npm run logs -- --dev`).
Chats may start, test and kill the dev instance; never the stable one. Updating the stable copy is the user's:
"Aggiorna" in Settings → Aggiornamenti (main's tip, without the test suite, ADR 0075, 0079) or `npm run promote` (needs
a clean tree and a green `npm run check`) from a terminal; `npm run rollback` from a terminal; never by agents.

## How an agent verifies a change by itself

1. While working, only the targeted tests; the branch's gate = `npm run check:quick` green + the e2e specs of the part
   it touches, under the e2e lock; the full `npm run check` runs once on main after a batch of merges. Lock, reruns
   and timeouts: `docs/agents/rules.md` §7.
2. A visible change: see it in the dev app (`SB_HIDDEN=1 npm run dev`, `app_screenshot`).
3. If something fails at runtime, `npm run logs -- --level warn --since 15m`, then `npm run doctor`.

A new or changed e2e spec runs on its branch, under the e2e lock, before the merge; name it in the hand-off, so the
Orchestrator knows which branch to look at if main's full run goes red. On main, a failure of a test listed in `test/e2e/known-red.json` is a
«rosso noto» and does not fail the check; any other failure is a «nuovo rosso» (ADR 0198).
