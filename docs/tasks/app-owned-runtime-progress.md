# App-owned runtime: execution-stage progress

This is the execution owner's handoff and evidence ledger. It records the unfinished migration without treating
instrumentation, an ADR or a separate PID as proof of success. The runtime must remain in main until the baseline
has actually run and informed the quantitative budgets.

## Current checkpoint

### Review correction checkpoint (supersedes historical gate results below)

- Corrected coalesced insert byte accounting: measure the final `replace` value before admission; on overflow flush
  the prior insert and retain the incoming replacement. The exact serialized array budget is 262144 bytes.
- Regression evidence: replacement regression on received code exited 1. Temporarily restoring the pre-fix
  delimiter accounting and `extra === true` replay predicate made both respective regressions fail, exit 1.
  Restoring those two existing fixes and applying the coalescing fix: 23/23 focused tests passed, exit 0.
  Commands: `npx vitest run test/unit/agent-runtime.test.ts -t "recomputes bytes"`;
  `npx vitest run test/unit/agent-runtime.test.ts test/unit/runtime-baseline-validation.test.ts -t "exact 262144|extra replay"`;
  `npx vitest run test/unit/agent-runtime.test.ts test/unit/runtime-baseline-validation.test.ts`.
- Local checkpoint `476abc56` rebased cleanly onto stage-one `b2c8aa0b`, exit 0; resulting commit `c74b5adb`.
- Exactly one fresh `npm run check:quick` was invoked with a 600-second tool timeout and an in-command exit capture.
  The terminal returned `Unknown: ChildProcess.kill` without output or the exit marker. Its exit and failing tests
  are unavailable; this is not a passing gate. No retry. The known base registry failure remains unverified here.
- Full-index export guard exited 0; `node scripts/guard-commit.mjs` exited 0 (clean index after commit).
  The new independent review belongs to the Orchestrator. No push was performed.
- CoordinationStore is absent from the received base; stage-three wiring must be supplied as an integration patch,
  not implemented against an invented store. Runtime extraction itself remains unfinished.

Stage-three integration: once its real store is available, add its actual import and change the closing line of
the `new Workflows(...)` call in `src/main/wiring.ts` (following the approved-plan callback) from `});` to:

```ts
  }, { store: new CoordinationStore(app.db), chats: () => manager.list(), pending: () => manager.pending() });
```

The constructor and store import are intentionally not invented on this base. The integrator must bind `app.db`
to the actual database owner in its combined tree (here `app` in wiring is Electron's app).

### Earlier execution evidence (historical)

- Dependency junction is available. `npm run build` exited 0; recorder tests passed 8/8.
- First replay attempt timed out after 120 seconds. Its log proved ACP consumed its two prompt entries as startup
  configuration requests; the first Claude also received the app's auxiliary `get_usage`. The replay now explicitly
  answers only those known auxiliary controls without advancing the recorded turn sequence. Unexpected traffic
  still fails parity. Every turn has a diagnostic failure deadline and the driver selects the authorized main page,
  not the request overlay, before using IPC.
- `runtime-before.json`: 96/96 operations, exit 0. Follow-up adds actual first-assistant DOM observation, the next
  animation-frame opportunity, machine CPU samples and an explicit main CPU profile: `runtime-before-dom.json`,
  96/96 operations and 96/96 DOM samples, exit 0. These are distinct workloads; compare after against the DOM version.
- Complete measured numbers and numeric budgets are in [the design ledger](app-owned-runtime-design.md).
- Final schema-2 baseline: `runtime-before-final.json` plus `.cpuprofile`, 96/96 operations and DOM samples, exit 0.
  A later 8-operation smoke had reported 7/8 rows and one rejected timestamp. Cross-process milestones now use the
  common system epoch clock (1 ms), not separate Node/Chromium performance origins; the full baseline was recollected
  after a fresh successful build. The stricter replay validator also rejects unexpected traffic after a fixture ends.
  Final main p99: 103.612 ms; semantic text→DOM-frame p99: 53 ms. Prior captures remain historical, not after results.
- Added generation/epoch/operation/sequence RPC primitives (bounded, no retry after uncertainty) and a 16 ms semantic
  batcher (first item and first nonempty text immediate; adjacent snapshots only; boundaries flush). These are
  foundations, **not a migrated runtime**. No utility-process session factory is connected yet.
- `npm run typecheck`: exit 0. Initial transport/batcher tests: 19/19 passed; one byte-framing regression was then
  added with its accounting correction; focused recheck `npx vitest run test/unit/agent-runtime.test.ts`: 20/20 passed.
- `npm run check:quick`: first invocation was terminated at the shell's 120 s limit during lint, before tests.
  Next invocation exited 1 on the prepared inline import type; corrected to a regular type-only import.
  The subsequent full quick gate completed: typecheck/lint passed; 103/105 test files passed, **1,426 tests passed,
  1 skipped, 2 failed**. No repeat of the failing unit suite:
  - `test/unit/engines/registry.test.ts:84`: OpenCode mixed-case `bAsH['*']`, expected `ask`, actual `allow`.
  - `test/unit/correction-catch-hook.test.ts:89`: expected recalled past errors alongside correction reminder;
    only the correction reminder arrived. The test exercises a real timed hook; cause not established here.
- Gate failures and the async-answer integration dependency were sent to the owning Orchestrator. Stage-three
  owned files remain untouched. Independent Sentinel review was requested on this checkpoint, not on a completed
  process migration. Full unit suite/e2e and after measurements have not run.
- Full index exported with `git checkout-index --all --prefix=<temporary-export>/`, then
  `node tools/guard/scan.mjs <temporary-export> --allow <temporary-export>/.guardallow`: exit 0, clean.
  `node scripts/guard-commit.mjs`: exit 0. No allowlist changes and no scan of the worktree's `.git` pointer/junction.
- **State on 2026-11-09 (issue #353):** merged on `main`; non-e2e gate run on main's tip and independent review done, both recorded in [`post-merge-review-353.md`](post-merge-review-353.md). The «red», «pending» and «not merge-ready» lines below are the history of the branch before the merge.
- Local checkpoint only; no push. Review pending and quick gate red, so this branch is not merge-ready. There is no
  visible product change and no before/after UI claim; the baseline runs the real hidden dev renderer.

### Initial checkpoint (historical)

- Base: stage-one consolidation `19a37a84`; branch `feat/app-owned-agent-runtime`.
- Prepared: opt-in baseline instrumentation, a hidden-app replay driver, three explicit CLI replay wrappers and
  deterministic recorder tests. **Not compiled or executed in the app.** No performance numbers exist yet.
- Dependency setup was refused when creating the worktree's `node_modules` junction. The refused action was not
  retried or replaced with another way of linking/copying/installing dependencies.
- `npm run check:quick` exited 1 at typecheck: missing local `node_modules/typescript7/bin/tsc`.
- `node tools/guard/scan.mjs . --allow .guardallow` exited 1 on the worktree administrative `.git` pointer:
  `user-path`, `home-path`. The allowlist and guard rules were not changed.
- `node --check` passed for the replay driver and all three wrappers. This is syntax evidence only.
- No runtime migration, no budget-bearing ADR, no local commit and no push. Independent reviews are still required.

## Instrumentation semantics

`src/shared/runtime-performance.ts` contains only diagnostic data types. The optional `chat:send.diagnostic` field
is never a permission, receipt or provider acknowledgement. The normal sender check runs first. The capture handle
exists only in a non-stable main with both `SB_TEST=1` and `SB_RUNTIME_PERF=1`; it is not exposed by preload or IPC.
Capture must be started explicitly by the replay driver. Normal app runs retain no samples and create no histogram.

| Mark | Source | Meaning |
|---|---|---|
| UI | caller's `Date.now()` (schema 2, system epoch ms) | Immediately before the typed send invocation |
| main | authenticated `chat:send` handler | Received by main, before manager preparation/admission |
| runtime | manager, immediately before `session.send` | Handed to the local adapter; not remote acceptance |
| providerWrite | successful stdin write / fetch submission | Submitted to the provider transport; not delivery/ack |
| firstText | live, non-replay session sink, nonempty assistant item | First semantic text parsed by the adapter |
| firstTextIpc | actual `webContents.send` of nonempty assistant text | First semantic text submitted to the UI |
| result | live session result after item emission | End of this measured turn |

Fresh sessions created during capture supply their creation timestamp and label the first send cold, subsequent
sends warm. Cold session-to-first-text is reported separately from UI-send latency. Overlapping/busy turns,
duplicate IDs, failed/incomplete operations and dropped samples are explicit; they cannot silently become zero
latency or count as successful operations. This recorder is for **one outstanding turn per chat**, not a general
cross-process trace implementation. The migration needs explicit operation identities on queued work and IPC.

Capture is bounded at 4,096 operations. Every duration summary has n/p50/p95/p99/max (nearest rank). Main event-loop
delay uses Node's histogram at resolution 10 ms, reporting nanoseconds as milliseconds without subtracting the
resolution. CPU is process CPU delta; RSS is start/end, not peak. IPC JSON byte counts exclude transport framing;
their extra serialization is opt-in measurement overhead and must be identical before/after.

## Baseline workload (run before migration)

The earlier checkpoint reports a successful build and baseline run with
`node scripts/runtime-baseline.mjs --output <existing-evidence-directory>/runtime-before-final.json`.
This correction run does not recollect the baseline; its evidence is the focused regressions above.
The driver uses a new isolated dev profile/fixture brain, hidden windows and explicit `.mjs` replay paths:

- Claude, Codex and synthetic ACP: 12 new sessions each, 2 sequential turns each from the existing wire fixtures.
- OpenAI-compatible API: 12 new sessions, 2 turns each against a loopback mock server. The placeholder key is synthetic.
- No real CLI/model calls. No concurrent load generator. Expected total: 96 complete measured operations.
- JSON records fixture hashes, build bundle hash, Git revision/dirty status and machine metadata.
- The driver fails on incomplete traces, overlaps, replay divergence, missing completion or incorrect mock call count.

The current driver observes the first assistant DOM mutation and the following animation-frame opportunity,
collects a main CPU profile and machine CPU samples, and rejects string-valued unexpected replay traffic.
These are first-text observations, not GPU presentation timestamps or measurements of every streamed delta.

## Next implementation sequence

1. Finish the correction checkpoint, stage-one rebase, quick gate and guard; request a fresh independent review.
2. Preserve the measured baseline and exact workload in the design ledger; finalize the ADR with implementation.
3. Coordinate shared type/wiring edits with the coordination owner when its store is available.
4. Introduce the typed runtime protocol: version, host epoch, session generation, chat ID, operation ID, sequence.
   Convert function-valued session options to explicit asynchronous broker operations. Main retains permission
   authority, credentials/trust/MCP, JobGuard and supervision; API HTTP credentials never cross to the runtime host.
5. Move adapter parsing/assembly, session admission/replay, checkpoints/write barriers and heavy persistence to the
   app-owned utility process. Keep first deltas immediate, bound queues, flush ordering boundaries and preserve
   ADR 0228. No broker timeout can authorize. An uncertain send is never replayed; Codex steer timeout is not refusal.
6. Deterministic host-crash/stale/duplicate/barrier/cancel/shutdown tests, equal-workload after measurements,
   `check:quick`, guard and actual hidden dev verification. Request the two independent reviews from the parent.

## Shared-file ownership

Execution owner integrates contracts/fragments, agents/workflows shared types, session protocol, manager facades,
broker, wiring/index and packaging. The coordination owner works on workflows service, runs/store, manager-work,
manager-requests, digest and request/receipt modules. No coordination file was changed in this checkpoint.

## Acceptance ledger

| Criterion | State | Evidence |
|---|---|---|
| Baseline measured before migration | Measured | 96/96 replay operations and DOM samples; main CPU profile; design ledger |
| ADR with measured numeric budgets | Partial | Numeric budgets in design ledger; architecture ADR awaits actual implementation |
| CLI/API adapters outside main, API keys in main | Not started | Existing execution unchanged |
| Crash/stale/duplicate/barrier/shutdown deterministic tests green | Not started | Recorder tests written, not run |
| Same after measurements with comparison | Not started | Migration not begun |
| Quick gate, guard, dev verification, local commits | Done (2026-11-09) | Merged on `main`; non-e2e gate on main's tip and independent review recorded in `post-merge-review-353.md` (before: correction tests 23/23, guard clean, quick gate red, review pending) |
