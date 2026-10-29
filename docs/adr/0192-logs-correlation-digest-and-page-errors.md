# 0192 — Logs: run correlation, interface errors, a page's error card and a 90-day daily digest

Status: accepted. Builds on ADR 0111, ADR 0132, ADR 0153 and the logging rules in AGENTS.md (cause + hint).

2026-10-29.

## Context

The analysis «Second-brain: app solida, brain e Manutenzione» (owner, 2026-10-29) found four holes in what the app
knows about itself:

- **Interface errors were never logged.** The page had no window `error` / `unhandledrejection` handler and the only
  React error boundary wrapped an agent's visual (GenUi.tsx). A page that threw while rendering blanked the whole window,
  and window.ts's crash hint («look for a renderer error just before») pointed at lines nobody wrote.
- **Log lines could not follow one job.** They carried `chat` only: a job spans chats (delegation), engines and tools.
- **«Manutenzione» saw too little.** Its log step and data pack read only warn/error groups of the raw logs. The Log page's
  journal (7 days), the window stalls (scope `perf`) and interface errors never reached it.
- **A late click lost days.** The raw logs keep 14 days and Manutenzione runs only on the user's click: a click after
  three weeks saw a week at most.

## Decision

**Correlation ids.** A log `Entry` may carry `run` (the agent run id), `step` (a tool call's or an engine turn's id) and
`op`, named after the OpenTelemetry GenAI operations where one fits: `invoke_agent` (an agent turn: «timing: before
send», each engine's «turn done»), `execute_tool` (a tool permission ask, with the tool-use id as `step`), `chat` (a
model call of an API engine). The chat manager registers a resolver (`log.correlate`), so every line with `chat` gets
`run` without touching each call site. `npm run logs -- --run <id>` filters by it. The journal's events already carry
`runId` (unchanged).

**Interface errors.** `startUiErrors` (renderer/lib/ui-errors.ts) reports the page's uncaught errors and unhandled
rejections, and each `ErrorBoundary` its render error with the component stack, through a new contract channel
`log:renderer` (allowed while an update holds the app, like the other reads). Only the error's message and stack leave
the page, cut to 500 and 2000 characters. Main (`main/renderer-errors.ts`) keeps only those strings, writes one
`log.error('renderer', …)` with cause and hint, the same error at most once a minute (repeats counted on its next line)
and at most 10 lines a minute in all. The logger redacts them like every line. The page also skips the same message
within 5 s, so a render loop cannot flood IPC.

**A page's error card (S2).** `components/ErrorBoundary.tsx` wraps each page (PageFrame: the brain pages, Memoria,
Impostazioni, Log, Guida…), the focus view, the 3D map and the Orchestrator column's body (its tabs stay usable). A
render error shows, in that place only, «Questa pagina ha avuto un errore», a line that the rest keeps working,
«Ricarica la pagina» and the folded details. The reload remounts the children under a new key. Texts in it/en/de; the
Orchestrator's `app_guide` explains the card and where the error went.

**Daily digest, 90 days.** `main/log-digest.ts` writes one bounded line (≤ 32 KB) per finished day to
`userData/logs/digest-YYYY-MM.jsonl`: lines per level; the warn/error groups (key `scope | msg | cause` with numbers
folded, the same key as the log step) and the 15 busiest info groups; distinct runs; stalls (counted with the ones a
minute's line folded) and the worst ms; slow-typing reports; interface errors and their groups; the journal's events
per kind and level. The logger's `housekeep` writes it at start, for every past day not yet summarized, and again a few
seconds after each day's rollover. Only then does it delete the raw files past 14 days, never a digest file. Reads are
streamed (async), so a big day never freezes the window. Months entirely past 90 days are deleted. The journal keeps a
day the digest does not hold yet past its 7 days (at most 30 more), so a start after a long pause summarizes it first.

**The maintenance sees the whole period.** The pack (ADR 0132) gets four sections: `journal` (events per kind, the
notable ones still in memory), `perf` (stalls per day and their logged causes), `ui-errors` (interface error groups,
with the log step's sample line when it has one) and `digest` (one line per day). They cover the time since the
previous pass (its `logsAt`), or 30 days on a first pass. The days the digest does not hold yet (today) are summarized on
the fly. The log step (`scanLogs`) adds the warn/error groups of the period's days whose raw file is gone from the
digest, with a note instead of a sample. `maintenance_pack`'s section enum is `PACK_SECTIONS`, so the tool follows.

## Consequences

- `npm run logs -- --scope renderer` shows interface errors, and window.ts's crash hints now point at them. A native
  renderer crash may still leave none; the hint says so.
- A late «Manutenzione» click sees counts and groups for up to 90 days, but no sample line for a day whose raw file is
  gone: a bug card from such a group says so.
- Contract: one new invoke channel `log:renderer` and the `RendererErrorReport` shape. No new dependency, no new
  permission prompt, zero tokens.
- The journal's local day and the technical log's UTC day share one digest line per date string. Near midnight a few
  events may count on the neighbouring day.
- Only the permission asks of tool calls are logged with `execute_tool`; a tool call the CLI runs without asking has no
  line of its own (unchanged).
