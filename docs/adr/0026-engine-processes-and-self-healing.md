# ADR 0026 · Engine processes in Job Objects, idle release, orphan sweep; the app heals itself

Date: 2026-10-13 · Status: accepted

## Context
The stable warn log (48 h): "session did not exit, killing" 57, "cursor did not exit, killing" 25, "tree kill did not
land, retrying" 5, "killing CLI processes still alive at quit" 4, "mcp port 4319 unavailable, using a random port" 2.
On 13/10 the PC was at 100 % CPU with 26 claude.exe, 87 node, 105 conhost, 46 bash and about 90 crashed taskkill.exe,
each one with a Windows error dialog and the VS JIT debugger. The user: "voglio risolvere definitivamente i processi
appesi". The main window had no handling for a renderer crash or hang.

Causes found:
- `claude.exe` needs 3-5 s to exit after its stdin closes, even when idle (measured: 4.3-4.7 s with and without MCP
  servers). The grace was 3 s, so almost every clean close ended in a kill.
- At quit every engine is killed first and then closed, so the grace timer logged "did not exit" for engines that
  were already being killed.
- 'close' waits for the pipes. A leftover that inherited the engine's stdout keeps them open after the engine
  exited. The grace then "killed" a dead pid, and the retry logged "tree kill did not land".
- The crashing taskkill.exe have claude.exe as their parent. The Claude CLI kills its own Bash/tool children with
  `taskkill /PID x /T /F`. libuv lets the CLI's children break away from its job silently, so they run with no job:
  no crash-dialog suppression, and nothing kills them when the app dies.
- The MCP fallback was only a log line.

## Decision
- **One Job Object per engine** (`chats/jobguard.ts`). Node has no Job Object API. One hidden PowerShell helper
  (C# via Add-Type, compiled once into `<userData>/jobguard/`, then only loaded) holds the jobs. Each engine joins its
  own job as soon as it is spawned. The flags: kill-on-close, explicit breakaway allowed, no silent breakaway, and
  die-on-unhandled-exception. The engine's later children are born inside the job, orphans included. Nested jobs
  decide breakaway by the innermost job, which is ours. A crashing taskkill inside the job just ends, without a dialog.
  - Killing an engine (grace over, Stop on a stuck boot, quit) is `TerminateJobObject`: the whole tree in
    milliseconds, without taskkill and without a retry.
  - A clean exit reaps from the job's member list (pid, parent, image). Only tools die; Excel, a browser and what
    they started stay. Then the job is released, so the user's programs outlive the app.
  - The helper is a normal child of the app, so libuv kills it with the app, on quit or crash. Every job not
    released then dies with its handle.
  - Jobs are named by our own ids, not pids, because a kept engine's job outlives its pid.
  - No helper (not Windows, Add-Type blocked, tests) means the taskkill and process-list paths as before.
- **Grace 10 s** (`CLOSE_GRACE_MS`). An engine already being killed gets no grace. An engine that exited while a
  leftover holds its pipes gets its pipes closed, not a kill.
- **Idle release.** Setting `engineIdleMin` (default 30, 0 = never): a chat idle that long, with no question, queue,
  background task or hand-off, ends its engine like a ✕. It stays on the grid as idle, and its next message resumes
  it (`ensureSession`, the existing resume path). Regie are never released.
- **Orphan sweep** (`chats/sweep.ts`), with zero tokens. Every 15 min (and 2 min after the start) one process list.
  Engines seen running are remembered in `<userData>/engines.json` with their real creation time and app run. The
  tools still descending from an ended engine are killed once its chat is no longer open in this run, or always when
  the engine belonged to an earlier run. Kills use TerminateProcess. The sweep logs one line with the counts per
  process name (claude, node, conhost, bash, cmd, git, taskkill…).
- **Main window self-healing** (`window.ts guardRenderer`). A renderer crash reloads the page. A hang longer than
  15 s kills the renderer, which then reloads the same way. At most 3 reloads a minute. Chats, CLIs and MCP live in
  main and are untouched.
- **Health** (`main/health.ts`). `app_state.health` and `AppInfo.health` report: MCP port wanted and bound, whether
  it fell back, renderer crashes/hangs/reloads, engines killed by force, and the guard's state. A fallen-back MCP
  port shows one closable banner (`HealthBanner.tsx`), never a toast.

## Consequences
- An app crash now also ends what the chats' engines started (as a quit already did), apart from what an engine
  started before it joined its job. The helper is ready ~1 s after start, while claude.exe needs seconds before its
  first child. The sweep catches the rest.
- One extra hidden powershell.exe while the app runs. Its first start compiles for 8-13 s on a loaded box.
- e2e and unit runs start no helper unless a test asks for it (`SB_JOBGUARD=1`). The sweeper does not run under
  `SB_TEST`.
