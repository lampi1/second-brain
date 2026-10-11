# ADR 0007 · Developing the app from the app: stable release + dev instance, promotion with green tests

Date: 2026-10-11 · Status: accepted

## Context
The user: "sarebbe possibile lavorare all'app direttamente dall'app?" From phase 1 on, the app is developed by chats
running inside it. The chats must never kill or modify the instance they run in.

## Decision
- **Stable** = a frozen release outside the repo: `%LOCALAPPDATA%/second-brain/releases/<version>-<sha>/` (only
  `out/` + `package.json`: main, preload and renderer are fully bundled) run by a shared Electron runtime in
  `%LOCALAPPDATA%/second-brain/electron/<electron version>/`. `current.json` names the active and the previous release.
  The user starts it from a Start-menu/desktop shortcut (`launch.cmd`), with userData `%APPDATA%/second-brain`, MCP 4319.
- **Dev** = the repo (`npm run dev`), userData `%APPDATA%/second-brain-dev`, MCP port 4329: its own config, chats,
  logs; it can be started, tested, read and killed freely by chats.
- **Promotion** (`Promuovi a stabile` in the stable app, the user's click): runs `npm run check` in the repo; only if green
  it builds, copies the release, switches `current.json`, restarts the stable app; if the new release fails to show its
  window within 30 s (health check) the launcher starts the previous one. `Torna alla versione precedente` = one click.
- **Guard rails for chats run by the stable app** (session-only settings passed with `--settings`, never written into
  the user's settings files): deny `Bash`/`PowerShell` commands that stop Electron or the app (`taskkill`, `Stop-Process`,
  `kill` on electron), and deny Edit/Write under the releases folder; the app-control MCP has no promote/kill tool.

## Consequences
- A broken dev build never takes down the cockpit the user is working in; a bad promotion rolls back by itself.
