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
  - On quit the helper closes every job not released (`closeall`), then, right before `app.exit`, takes `quit
    <app pid>`: it starts a booster, answers and ends. The booster raises every thread of the app's process and of
    its descendants (Chromium's GPU, network and renderer processes) to time-critical, new threads on each pass,
    until the app's process is gone. Windows ends a process only once each thread has run, and the app's exit waits
    for its Chromium children; at normal and background priority (Chromium's pool threads: 4) on a busy CPU that
    took 20-130 s after our code had ended (2026-10-15, the quit e2e under parallel suites; 20 CPU spinners on 14
    cores: 20-130 s, 4 of 6 runs over 30 s). Raising the process's priority class does not lift them; raising only
    the app's own threads left 12-30 s (the children); raising the whole tree: 5-6 s, 6 of 6. The booster starts in
    the high class so its own start takes seconds, not tens. Without the helper the exit stays as slow as the CPU
    makes it. Only processes of the app's own executable started after it count as its tree: a program the user
    opened from the app (an editor, Excel) is its child too and would keep time-critical threads for good. The
    booster holds the app's process handle, so a reused pid never becomes its root.
  - The booster is its own process (`CreateProcess` with no inherited handles, out of libuv's job), not the helper:
    the helper inherits the app's handles, and while it lived the app's exit hung in Node's "wait for the debugger
    to disconnect" under the e2e's `--inspect` (until the boost's cap, then 120 s). It loads the helper's compiled
    assembly file, so no assembly file = no boost. The helper's script carries the C# source once: its
    `-EncodedCommand` must stay under Windows' 32767-character command line.
  - The booster's limits on the user's work PC (review, 2026-10-15):
    - Time-critical (15), not highest: highest is +2 on the app's normal class (10), and Windows' dynamic boosts take a
      normal-class busy thread to 9-10, so the margin would be thin; highest was never measured. Only threads that run
      take CPU at that level: an exit stuck waiting costs none.
    - Cap 30 s (the quit e2e's bound), was 120 s: past it the exit is broken anyway, and a thread that spins would starve
      the user's programs for the whole cap. When the booster ends (app gone or cap) every thread it raised that still
      runs in the same process goes back to normal: a hung app or a Chromium child left behind keeps none.
    - It always ends: only the quit starts it; the app already gone, a process or thread Windows does not let it open,
      or the assembly failing to load end it or skip that thread; its loop stops at the app's exit or the cap. Out of
      libuv's job, it survives the helper (the unit test sees it raise threads after the helper ended).
    - It touches only the app's process tree: the parent chain from the app's pid (held by handle, never reused), and
      in it only processes of the same executable name started after the app. The stable app is never a descendant of
      the dev one (separate launch), so it is never touched; a program opened from the app has another executable. A
      descendant pid reused between two 100 ms passes by a new process of the same name is the one theoretical gap.
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
