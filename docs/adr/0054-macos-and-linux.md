# ADR 0054 · macOS and Linux beside Windows, in stages

Date: 2026-10-15 · Status: accepted (stages 1-4 done; stage 5: CI workflow written, no run yet) · Builds on: ADR 0007 (stable vs dev), ADR 0010
(embedded Claude engine), ADR 0026 (engine processes)

## Context
The app was written for Windows only. An inventory of the code (2026-10-15) found 68 places tied to it, in five
groups: folders (`%APPDATA%`, `%LOCALAPPDATA%`, `path.win32` checks), the engine package (only
`@anthropic-ai/claude-agent-sdk-win32-x64`, a plain dependency, so `npm ci` failed on any other OS), processes (the
job guard compiles C# through PowerShell `Add-Type`, `taskkill /T`, the process list through `Get-CimInstance`, the
restart waiter and the user's commands in PowerShell), start and release (`launch.cmd` + `launch.vbs`, `.lnk`
shortcuts with an AppUserModelId) and look (the `.ico` icon, no native menu, which macOS needs for Copy/Paste and Quit).
Nobody on the team has a Mac.

## Decision
Port in five stages, one commit each, Windows behaviour unchanged at every stage (only new `process.platform`
branches). Install model on macOS and Linux = the Windows one: a release folder, a launcher script, a shortcut; no
installer package and no new dependency (installers belong to the "install in 5 minutes" work).

1. **It installs everywhere** (this commit). `src/main/platform.ts` is the one place that knows the per-OS folders and
   the engine package:
   - the shared folder (releases, launchers, Cursor ledger, sync config): Windows `%LOCALAPPDATA%/second-brain`
     (unchanged), macOS `~/Library/Application Support/second-brain-shared` (Application Support is also Electron's
     appData and `second-brain` there is the stable userData: the releases must not live inside it), Linux
     `$XDG_DATA_HOME/second-brain` (default `~/.local/share`);
   - userData stays Electron's `appData` (`%APPDATA%`, `~/Library/Application Support`, `$XDG_CONFIG_HOME`); the
     scripts that run without the build (`release.mjs`, `doctor.mjs`, `logs.mjs`) carry the same rule inline;
   - the Claude engine: the six official packages (`darwin|linux|win32` × `x64|arm64`, same version) are
     `optionalDependencies`; npm installs only the one whose `os`/`cpu` match. Same publisher and version as the one
     already used (published 2026-09-25), so no new dependency in the ADR 0010 sense; the release copies `claude` (or
     `claude.exe`) and makes it executable.
2. **Paths**: `open-path.ts`, `ask-image.ts`, `peek-file.ts` check paths with the host's rules (`path.win32` only on
   Windows; UNC and junction checks stay Windows-only; case folded on Windows and macOS, kept on Linux); the renderer
   finds `/Users/…`, `/home/…`, `/tmp/…` paths in a question beside `C:\…` (only under usual roots, so an API route
   is never a file); the Cursor CLI found under `~/.local/share/cursor-agent/versions/<v>/node` (its own node, like
   `node.exe` on Windows) and `agent`/`cursor-agent` on PATH. The Cursor layout on macOS/Linux follows its installer
   script and is still to be tried on a real machine (stage 5).
3. **Processes**: on macOS/Linux each engine starts as its own process group (`detached`), and a tree is killed with
   `kill(-pgid)`; the process list comes from `ps`; the job guard and the quit reaper are no-ops there (the group is the
   guard); the restart waiter is a `/bin/sh` loop; the user's commands run in `$SHELL -lc` (zsh/bash) instead of
   PowerShell. The Windows path keeps the job guard; its silent fallback when `Add-Type` is blocked (Constrained
   Language Mode, audit 2026-10-15) is a logged warning (`job guard unavailable`, `jobguard.ts`, landed
   on main with the quit work). Done so far (`platform.ts` `ownProcessGroup`,
   `restartWaiter`, `userShell`, `etimeSeconds`): the process list reads `ps -o etime` (macOS's BSD ps has no
   `etimes`). A group leader does not get the terminal's Ctrl+C in `npm run dev`; if the app dies without its quit,
   the engines see their stdin close and should exit by themselves, as on Windows before the job guard (to verify in
   stage 5, with what they started).
4. **Start and look**: `launch.sh` beside `launch.cmd`; Linux writes `~/.local/share/applications/second-brain.desktop`;
   macOS starts `Electron.app/Contents/MacOS/Electron` and gets a small `.command` launcher; a native app menu on macOS
   (roles: app, edit, window); PNG/ICNS icons; `setAppUserModelId` only on Windows. A macOS app started from Finder
   or the Dock gets a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so the CLIs in `~/.local/bin` or Homebrew are
   not found: the launcher passes the login shell's PATH. Done: `release.mjs` writes `launch.sh` (login-shell PATH,
   then `release.mjs launch` in the background) and, on macOS, `second-brain.command`; the shared runtime's binary is
   `Electron.app/Contents/MacOS/Electron` on macOS, copied with its symlinks kept; the stable app writes
   `~/Desktop/second-brain.command` (macOS) or `~/.local/share/applications/second-brain.desktop` (Linux);
   `app-menu.ts` holds the macOS menu; the window and Dock use `icon.png`. Not done: an ICNS icon, which only an app
   bundle of our own would show in the Finder (left to the install work, with signing).
5. **Proof without a Mac**: macOS and Linux run on GitHub Actions (`.github/workflows/ci.yml`, matrix windows /
   ubuntu / macos: setup, typecheck, unit, e2e under xvfb on Linux). The workflow starts when the user pushes to
   GitHub; until a macOS run is green, the README says macOS is "not yet tried". The workflow uses GitHub's own
   actions (checkout, setup-node, upload-artifact) by major tag, read-only token; pin them to commit SHAs when the repo
   gets a GitHub remote. A local Linux try in WSL was planned and dropped (2026-10-15): the WSL VM timed out
   twice on the dev machine, and the user chose CI as the only proof.

Rejected:
- electron-builder / installers now: a large dependency tree, and macOS needs an Apple signature (99 $/year) to open
  without a warning; left to the install work.
- one shared JS module for the folders imported by both main and scripts: `release.mjs` is copied next to the
  launcher and runs alone, so it cannot import from the build; three inline lines are cheaper.
- renting a cloud Mac: costs per hour and needs the user's account; CI gives the same signal for the code paths.

## Consequences
- `npm ci` works on macOS and Linux from stage 1; the app starts there only after stage 3 (engines) and 4 (launcher).
- The brain's own scripts that read `%LOCALAPPDATA%/second-brain` (Cursor hook, ops tools) are outside this repo and
  keep working on Windows; on other OSes they must use the same rule (noted for the brain template).
- Each stage adds unit tests that pass a `platform` argument, so the macOS/Linux branches are tested on Windows too.
