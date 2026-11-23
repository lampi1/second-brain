# ADR 0338: No leftover processes: no breakaway from an engine's job, engines recorded at once, leased stacks spared

**Status:** Accepted (2026-11-23), amends 0026

## Context

The user: processes stay open after an agent hangs or the app closes. On 2026-11-23 the PC had orphan `bash` processes
(`npm run check:quick`, `npx electron .`), a dev app 17 hours old with a dead parent and 13 MSBuild nodes. The stable app
had run 1161 orphan sweeps in 15 days: none of them reported an orphan or a kill.

- **Commands of the Bash tool left the job.** An engine's job allowed explicit breakaway (0026, no reason recorded), and
  Git Bash leaves any job that allows it. Measured with the same tree (cmd → bash → bash → node) in two jobs: flags
  `0x2C00`: node is not in the job; `0x2400`: node is in it. So the kill, the reap and the crash cover of 0026 missed
  what an agent started from Bash. Which chat started each leftover of that day is not known.
- **The walk by parent cannot replace the job.** It stops at the first parent that ended, as a background command's does.
- **`engines.json` was written by the sweep only** (2 min after the start, then every 15 min): an engine that started and
  was lost in between was never recorded. A recorded engine of an earlier run was never ended itself, only its tools.
- **Stop on an engine that does not answer** failed («Stop non riuscito») and left it running.
- **A finished tree closed one level per two minutes**: a parent blocked by a child got a whole new warning.
- The app did not know the leased shared environments (`<brain>/ops/state/envs.json`): a local stack started by an agent
  could end with that agent's job.

## Decision

- **No breakaway** (`JOB_FLAGS`): kill-on-close and die-on-unhandled-exception only. What an agent starts (shells, builds,
  a dev app, what those start) is born in its engine's job and ends with it: ✕, kill, quit, crash.
- **Leased processes are spared** (`leased-procs.ts`): the pids bound to a held lease and what they started, read at each
  kill. The walks skip them; a job that holds one has its other members ended one by one and is then released; every
  minute such a job loses kill-on-close, so a crash spares it too.
- **Engines are recorded when they start** (`jobguard.onAdd` → `EngineSweeper.noteSpawn`), the first sweep comes after
  45 s, and an engine of an earlier run that is still the same process (pid, creation time, name) ends with its tools.
  Only recorded engines and their descendants are ever candidates. One log line per kill, with its reason.
- **Stop ends an engine that does not answer** (`stop-kill.ts`): a failed interrupt of a running engine kills its tree. The
  threshold is the interrupt's own timeout (15 s for Claude); closing keeps its 10 s grace (`CLOSE_GRACE_MS`).
- **Builds leave no nodes** (`engine-env.ts`): `MSBUILDDISABLENODEREUSE=1` and `DOTNET_CLI_USE_MSBUILD_SERVER=0` for every
  engine.
- **A finished tree closes in one countdown** (`auto-close.ts`): a blocked parent follows its slowest child. The delay the
  user set and the two-minute warning do not change.
- **A working count** beside the Grindhouse entry: chats running or starting, hidden at 0.

## Consequences

- A program that insists on leaving its job now fails to start from an agent (`ERROR_ACCESS_DENIED`) instead of escaping.
  Git Bash asks only when the job allows it.
- A forced kill of an engine also ends a user program an agent opened from Bash (it already did from PowerShell); a clean
  close still spares it (only tools die).
- Between a stack's start and the bind of its pids to the lease, closing the agent that starts it ends it.
- Without the job helper the paths stay taskkill and the walk.
