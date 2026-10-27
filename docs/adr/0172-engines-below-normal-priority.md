# ADR 0172 · Engines run below normal CPU priority; stalls say whether the app was working or waiting

Status: accepted (2026-10-27, after the owner reported that ADR 0171 changed nothing: "il mouse sul campo testo ci mette
un po' a diventare il pointer giusto", "le lettere compaiono dopo qualche secondo", "scrollo, si blocca e scrolla tutto
in un colpo").

## Context

The owner's logs of 2026-10-27 (stable app, 468d655 then b696f85):

- 07:48-11:25: 5150 main-process stalls of 200 ms or more (about 24 a minute), the worst growing from 3 s to 70 s.
  The 206 logged ones add up to 995 s; the labelled steps inside them (the agent-runs.json and chats.json writes of
  ADR 0171 included) add up to 1.26 s, 0.13%. After b696f85, with every timer, IPC handler, event, engine output and
  MCP tool labelled: 270 stalls in 20 min, 0.48% inside labelled code.
- Several long stalls have IPC lines logged in the middle (10:57:58 inside the 68 s stall ending 10:58:51): the app's
  JavaScript was not stuck in one long step.
- The orphan sweep (a PowerShell process listing, normally 1-3 s) took 16-45 s exactly in the hours of the long stalls
  (08:48 22 s, 10:05 45 s, 10:50 31 s, 11:20 40 s), with 35-49 node.exe, up to 31 taskkill.exe and 475-512 processes;
  the admission queue read the PC at 78-86% CPU. The same pattern is in the earlier days (2026-10-22 16:08-16:38, 44-45
  claude.exe and 65-71 node.exe; 2026-10-24 07:42, 72 s with 16 taskkill.exe).
- Pointer shape, scrolling and typed keys all pass through the Electron main process's UI thread.

So the window froze because the app's main process waited for a CPU kept busy by the agents' process trees (engines,
their MCP servers and shells, the CLIs' `taskkill /T` storms) at the same priority, not because of its own work.

## Decision

1. Every engine (Claude, ACP, Codex) is set to below-normal priority right after it is spawned
   (`jobguard.ts lowerEnginePriority`, `os.setPriority(pid, PRIORITY_BELOW_NORMAL)`: Windows
   `BELOW_NORMAL_PRIORITY_CLASS`, nice 10 elsewhere). What the engine starts afterwards inherits it (Windows gives a
   child of a below-normal process its class). A refusal is logged once and the engine runs anyway.
2. The stall log adds `cpuMs` (CPU the main process got while late, all its threads) and `machineCpu` (the PC's busy %
   over the stall); with `cpuMs` under 25% of the stall the cause says the app was waiting for a busy PC.

## Consequences

- When the PC is busy, the window goes first and agents get what is left; on an idle PC they run as fast as before.
- `scripts/bench-contention.mjs` (Linux container, 4 cores, 64 CPU-bound children, a 1.4 MB store parsed every
  second): 33 stalls a minute and 309 ms worst before; 0 and 17 ms after. Not measured on Windows yet.
- ADR 0171 stays: its writes are correct and cheaper, but they were not the freeze.
