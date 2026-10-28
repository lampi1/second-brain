<!-- Implementation and verification record for ADR 0179. Results are updated after the exact branch checks. -->
# Terminal-only routines: removal report

- Removed the old flows runtime/service, five-second tick, settlement/reconciliation, automation/trigger loop,
  role workers and their specialized MCP/browser/DevOps execution paths: only the CLI may execute routines.
- Removed the app's package runtime/trigger loop, startup conversion and periodic run reads: a closed view must be idle.
- Removed app-flow tools, routine configuration/approval controls, component/workbench execution UI and their tests.
  Retained format validators and DTOs needed to read old data or explicitly convert a definition to a CLI package.
- Kept package authoring/preflight, explicit import/export and credential entry because they prepare terminal packages.
  Historical encrypted site credentials are read lazily only during explicit package preparation/export.
- Kept live steps/actions, every screenshot, before/after pairs, enlarged images, evidence files, reports and history.
  The view's watcher follows root journals only, never the run's checked-out repository. Incremental asynchronous
  event reads and lazy images avoid repeatedly cloning state or transmitting full PNGs on every action.
- Kept the original legacy files, including the four cancelled version-19 runs' unknown DevOps outcomes. They are
  archive data, never queued work or questions. The app cannot safely invent their external outcomes.

## Verification

The hidden dev capture executes the real CLI `main(run)` in a separate process, with the production browser MCP
and a synthetic token-free Claude stand-in. It checks two new screenshots within five seconds, a live step/action
transition, completion/report, enlarged screenshot and reopened history. Artifacts include the actual run folder,
CLI log, native app captures and manifest timings. Main-process filesystem instrumentation checks 15 idle seconds
before opening Routine and 15 seconds after closing it. Unit tests also cover constructor idleness, zero timers,
watch teardown, legacy preservation, partial event writes, image path confinement and authenticated tools.

Exact check, visual trace and reviewer results: pending at this checkpoint.

## Risks and limits

The supplied stable Windows diagnosis measured 0.7–1.6 second stalls about every five seconds. Its attribution to
snapshot/GC was an evidence-backed hypothesis, not a CPU-profile proof. Removing both app executors eliminates that
periodic routine work; a Linux dev trace cannot establish an equivalent end-to-end speedup on the user's Windows PC.
Independent `brainmodel:state` and renderer costs from the diagnosis are not resolved merely by removing routines.

`fs.watch` is intended for local run folders; network/virtual filesystems may lose notifications. Reopening the view
reads the current files. Existing files are preserved, so any manually desired external reconciliation stays outside
the app. The runtime package's execution semantics remain unchanged.
