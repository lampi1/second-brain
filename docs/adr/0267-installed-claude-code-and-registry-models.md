# ADR 0267 · The installed Claude Code runs by default; every menu adds the registry's models

Date: 2026-11-10 · Status: accepted (owner, issue #374 and its 2026-11-10 comment: «secondo me non ha senso che usiamo
l'sdk dell'app») · Amends: ADR 0256 (live model lists), ADR 0010 (the embedded Claude engine)

## Context
- A model out today did not show up or run. The Claude Code embedded through the Agent SDK (2.1.283 on 2026-11-10)
  did not know `claude-fable-5-2`; the Claude Code installed on the owner's PC (2.1.322) did. `discoverClaude` took the
  embedded binary before PATH, so chats, the model probe and login all ran the older one.
- ADR 0256 used the brain's `harness/models.json` rows only when an engine had no live list. A model a live list
  missed could not be picked even after someone added its row.

## Decision
- **Installed first** (`src/main/chats/discovery.mjs discoverClaude`): an explicit override (SB_CLAUDE_PATH or the
  caller's) → the installed Claude Code (PATH, then `~/.local/bin` and the other known folders of `findCli`) → the app's
  own copy (a release's SB_ENGINE_CLAUDE, else the embedded SDK binary), marked `fallback`.
- **Windows:** a `claude.exe` wins (native installer, WinGet). An npm install's `claude.cmd` shim cannot be spawned
  without a shell: Node refuses `.cmd` since CVE-2024-27980, and the chat arguments are not shell-safe. Its package's
  `cli.js` runs instead with the user's own `node`, the way `packages/routine-runtime` already does. Chats, status,
  the probe, login and `npm run doctor` all use it. It never runs as Electron as Node, because
  `ELECTRON_RUN_AS_NODE` would reach every child of Claude Code (an `npx electron .` in a chat would open no window).
  A shim without `cli.js`, or with no `node`, counts as not installed.
- Chats (`claude.ts`), the model probe (`model-probe.ts`), status and login (`main/cli.ts`) and `npm run doctor` all
  use this one resolver, so the picker lists what the binary that runs the chat can run.
- **The fallback says so:**
  - a warning in the Log page, once per path;
  - a notice in Settings › Engines › Claude (`CliStatus.fallback`): «Claude Code non trovato sul PC (o non si avvia):
    uso la versione inclusa nell'app (version), che può non conoscere i modelli nuovi»;
  - the same line once per chat and app run in a chat that starts on it.
- **An installed Claude Code that fails to start** (spawn throws or emits an error) is set aside for this app run. The chat's error
  says to retry, and the next start takes the app's copy.
- **Versions in Settings:** every CLI engine (Claude, Codex, Cursor, OpenCode, catalog engines) shows the version and
  path in use when its row is open.
- **Registry rows are added** (`engines/sessions.ts withApiModels`): every engine's menu shows its live list, then the
  claude-* models of the Anthropic Models API (Claude only, ADR 0256), then the rows of `models.json` for that engine
  that neither names, marked `registry` («dal registro» in the picker).
  - The live row wins a duplicate. Ids are compared as `live-cost.ts` does: lower case, without a `[parameters]`
    suffix (Cursor) or a date suffix (`-20261001`).
  - A list made only of registry rows keeps `at: 0`. A live list keeps its own time.

## Consequences
- A new model works on the day the user's Claude Code knows it, without an app update. A model the CLI does not list
  yet can be picked from its registry row; if the CLI cannot run it, the CLI refuses it, as before.
- Users without Claude Code installed keep working on the app's copy and are told why new models may be missing.
- Not checked in this container, to be done on a real PC: a chat on `claude-fable-5-2` through the installed 2.1.322
  answering, and the fallback notice with Claude Code hidden from PATH.
- An installed Claude Code that starts but breaks later (not at spawn) is not switched; the chat shows its error.
- The Settings notice reads the status checked at app start: a switch during the run shows there after «Verifica
  accesso», and in the chat at once.
