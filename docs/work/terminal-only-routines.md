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

The implementation tree `1b4b75e03a06714ca5eaa7b585926a646a16bac5` passed `npm run check:branch` locally
(commit `871d765b`, published with the same tree as `38640580`): typecheck, changed-file lint, 2,865 tests and the
changed-file publication guard. The 14 optional/platform skips already existed; tests for removed features were deleted.
Fresh correctness, security and UI reviews found issues that were fixed: archived-chat entry points, descriptor
replacement during image reads, stale usage-cache reads, unreadable tall screenshots, and capture assertions.

CI run [40679951862](https://github.com/lampi1/second-brain/actions/runs/40679951862) recorded:

| Measurement | Baseline | Candidate |
| --- | --- | --- |
| Real CLI screenshots: event to decoded image in app | — | 88 / 54 / 50 ms (third overwrote the second file) |
| Reopened terminal history | — | Both screenshots decoded |
| 360 s synthetic streaming: renderer CPU, one core | 53.55% | 51.99% |
| Long-task time in that window | 500 ms | 107 ms |
| Typing latency p95 | 23.6 ms | 23.7 ms |

The first idle capture ran from `2026-10-28T11:27:54.043Z` to `11:37:54.076Z`: zero main stalls at or above
100 ms of timer lateness, maximum probe delay 3.49 ms and zero renderer long tasks. That fixture had an empty brain and disabled
production pollers, so it is only a baseline.

CI run [40683163561](https://github.com/lampi1/second-brain/actions/runs/40683163561), implementation `38640580`,
passed the branch gate on Windows, macOS and Linux. Its native capture passed visual review: report contents, readable
full-width screenshots, bounded before/after pairs, step/action progress, completion and reopened history. Screenshot
latencies were 84 / 45 / 30 ms, with no renderer errors. With a synthetic product brain and production read-only pollers
enabled, `2026-10-28T11:52:59.764Z`–`12:02:59.797Z` recorded zero main stalls at or above 100 ms (max probe delay
5.32 ms) and zero renderer long tasks. These older probes used a 100 ms cadence: the metric is timer lateness,
not a precise bound on blocking-task duration. The corrected capture samples every 10 ms and flags delays from
90 ms, conservatively covering uninterrupted tasks over 100 ms regardless of their start phase.

The early trace wrapped Node's default objects but missed ESM named imports. Its zero process count and filesystem
counts are not acceptance proof. The corrected filesystem probe calls `syncBuiltinESMExports` after patching/restoring
and instruments `realpathSync.native`. Process counting observes `ChildProcess.prototype.spawn`, preserving public
APIs and covering previously captured promisifiers. Small Node canaries verified interception and restoration. The corrected
ten-minute capture includes a synthetic 5,000-turn Cursor ledger to exercise idle usage refreshes. Corrected raw
counts and timestamps are recorded in PR #261. Process counts cover successful asynchronous Node child launches by
main, not synchronous launches, Chromium/utility processes or grandchildren. Paid jobs, personal-account probes and
the engine sweeper remain disabled in these fixtures; the wiring read-only pollers are enabled.
The synthetic renderer comparison completed twice; its temporary opt-in for this cleanup branch was then removed.

The first report PNG was not valid proof: the tracing wrapper had dropped `realpathSync.native`, making the generic
viewer report a missing file. The wrapper now preserves and instruments that API; capture waits for the actual report
heading. Screenshot previews are bounded to 240 px; opening one uses a scrollable fit-width view.

The full-history publication guard is still blocked by 12 findings in commits already ancestral to the base main:
10 email findings in historical commit metadata and two historical GUID findings. No guard rule was relaxed and no
shared history was rewritten. A green changed-file check does not make that historical gate green.

## Risks and limits

The supplied stable Windows diagnosis measured 0.7–1.6 second stalls about every five seconds. Its attribution to
snapshot/GC was an evidence-backed hypothesis, not a CPU-profile proof. Removing both app executors eliminates that
periodic routine work; a Linux dev trace cannot establish an equivalent end-to-end speedup on the user's Windows PC.
The owner's subsequent d3ce40f6 field measurement confirms the old periodic pattern disappeared: 14.4 stalls/minute,
median 925 ms before, about one/minute, median 255 ms after. This is supplied field evidence, not a new measurement
of this branch. Remaining renderer and storage costs are separate: this branch removes minute-based estimate
backtests, avoids no-op analytics saves, coalesces real analytics writes asynchronously, avoids flushing run storage
on metrics reads, caches the rendered tool copy, skips advisory lint in background cost reads, and reuses unchanged
transcript/step projections. The probe now counts stalls from 100 ms and reports renderer long tasks without keys.
The CI idle trace records ten minutes with timestamps; a separate baseline/candidate renderer profile uses identical
synthetic sessions. Windows background-busy cursor behavior still requires a Windows field observation.

`fs.watch` is intended for local run folders; network/virtual filesystems may lose notifications. Reopening the view
reads the current files. Existing files are preserved, so any manually desired external reconciliation stays outside
the app. The runtime package's execution semantics remain unchanged.
