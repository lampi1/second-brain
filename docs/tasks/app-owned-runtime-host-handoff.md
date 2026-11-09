<!-- Stage-two utility implementation handoff: exact scope, test evidence and remaining release blockers. -->
# Utility execution host: implementation handoff

Status: **partial, opt-in, not ready to enable by default**. Base commit: `605f7ed4`.

## Implemented path

`SB_AGENT_RUNTIME_HOST=1` in a non-stable app installs the runtime factory before service creation. The default
factory remains unchanged. The build emits `out/main/agent-runtime.js`; the existing out-directory packaging carries
this entry. One lazy, app-owned `utilityProcess` hosts the prepared Claude, Codex, ACP and API adapters.

Host responsibilities: CLI spawning, stdout/stderr parsing, adapter state/stream assembly, semantic batching,
adapter-owned file writes (including API history), and Claude's first-write barrier. Main retains launch preparation,
browser/window integration, the permission callbacks, engine-bound credential lookup and authenticated HTTP transport.
API streams are pulled through bounded chunks; API keys and headers remain in main and echoed keys are redacted across
chunk boundaries. CLI launch environments remain prepared by main and travel only on the private host launch channel.

This does **not** move ChatManager/run/workflow persistence or checkpoint recording out of main. Stage-three ownership
and the existing persistence integration remain outstanding. Warm-pool parity has not been demonstrated.

## Boundary and failure semantics

- Requests and acknowledgements carry protocol version, host epoch, chat id, session generation, operation id and
  sequence. Retired generations cannot consume replies or mutate a replacement proxy.
- Commands and callbacks have 256 RPC credits and a 64 MiB outstanding-byte ceiling. Semantic updates have a
  64 MiB / 256-update pending queue, a 16 MiB individual-value ceiling and one acknowledged frame in flight per
  session. Large values use 128 KiB binary fragments encoded as base64; each IPC frame stays below 256 KiB.
  Main publishes the complete value only after ordered reassembly. Overflow terminates the affected session
  explicitly, never silently discards it. Adjacent normal-sized item replacements still coalesce in the batcher.
- The proxy waits for acknowledgement that the host armed its first-write barrier before dispatching the turn.
  Rejected barrier installation never dispatches the turn. Checkpoint completion releases the named barrier.
- Host death rejects outstanding dispatched operations as uncertain. There is no host command retry or automatic
  process restart. Main's shutdown handler kills the utility; main JobGuard also supervises its process tree.
- Callback failures cannot allow a Claude PreToolUse operation. Async callback results crossing interrupt/close are
  checked against the adapter's local broker generation. Codex re-reads authoritative policy at actual turn dispatch.
- Stop invalidates undispatched sends waiting for the write-barrier acknowledgement (except explicit keepQueued).
  Native exits retire their proxy/host slot; an explicit close first waits for its own acknowledgement. Startup's
  ready promise waits for the ready snapshot to reach main instead of racing its projection. The start command
  acknowledges dispatch separately; native initialization/resume retains the adapter's own deadline.

## Exact integration change for permission receipts

`RuntimeAnswerConsumer.answerConsumed(requestId, answer, patch)` returns a `Promise<boolean>` fulfilled by the host
**after** the native adapter's `answer()` returns. The old synchronous proxy `answer()` throws before dispatch.

The integrator must make **every permission-consumption path** in `manager-requests.ts` await this interface when
present (otherwise use the existing native synchronous answer). Only a true acknowledgement can consume the receipt.
False leaves it unconsumed; rejection/timeout is uncertainty, never permission to retry. Preserve the original phone
provenance and recheck session/request identity after the await. This is one integration concept, not merely adding
`await` at one call site. This implementation deliberately does not edit that file.

## Evidence collected

- Earlier intermediate typechecks and two full builds passed before the shared dependency tree became incomplete.
- Host test red: 4 passed, 2 failed (unacknowledged-byte bound; constructor event before adapter initialization).
  Green after corrections: 6/6. A command-byte-credit test was subsequently added.
- Broker test red: 3 passed, 1 failed (overlapping key prefix split between chunks). Green after correction: 4/4.
- Latest focused run: `agent-runtime`, `runtime-host`, `runtime-broker`, `runtime-host-timing`: **35/35 passed**,
  exit 0. Timers and callback replies are deterministic; no live engines or load generator.
- Intermediate hidden-dev smoke with host enabled completed two turns for each of Claude, Codex, ACP and HTTP API.
  The baseline script then correctly rejected all 8 timing samples: transport marks still lived in the host.
  Exact host transport/text timestamp routing was added afterward and has unit coverage, but has not been rebuilt
  and recollected in the dev app yet.
- Lifecycle script reached Claude startup and a user-interrupted streamed turn with a separate utility PID, then
  failed because `chat:close` removes a user chat. The script now uses archive (adapter close while retaining the
  native identity) before reopen. That correction is unverified; no complete native-resume proof is claimed.

## Gate and blockers

`check:quick` ran **once**, with a 600-second tool timeout. It failed at typecheck; no retry, lint or related suite
followed. Missing `highlight.js` and `mermaid` declarations were reported. The additional `isWellFormed` type error
in the unchanged `appctl-child-output` test remains unclassified. Earlier attempts had independently reported missing
`@playwright/test`, `3d-force-graph` and `@eslint-community/eslint-utils`. The latest full build failed while importing
an invalid `vite/package.json`, before emitting the current build. No dependencies were installed or rewritten here.

Restore a consistent dependency tree before collecting the remaining evidence. The inherited final baseline has
96 operations and main p99 **103.612 ms** (the stricter budget remains **88.277 ms**). There is **no after p99**.

Outstanding: final build/typecheck/lint; independent review; complete CLI/API lifecycle and host-death proof in dev;
96-operation comparable performance capture and CPU profile; large-event compatibility; warm-pool/shutdown parity;
stage-three acknowledgement/persistence integration. No default activation, push or readiness claim is justified.

### Resumed verification

- Dependencies now permit typecheck: exit 0, including after the new changes. Targeted lint of `agent-runtime/`,
  `runtime-host.test.ts`, `runtime-fragments.test.ts` and the evidence runner: exit 0. A separate lint command
  also covered all inherited changed adapters, session factory, main entry, build/lifecycle scripts and tests: exit 0.
- Large-event regression: red with zero delivered items on the inherited host; green after bounded fragmentation.
  Cancellation regression: red with one write after Stop; green after invalidating the pending send generation.
  Native-exit regression: red with `gone === false`; green after retiring the proxy. Ready-projection regression:
  red with ready resolved before delivery; green after resolving readiness from its ordered semantic snapshot.
- Final focused run of `runtime-host.test.ts` and `runtime-fragments.test.ts`: **14/14, exit 0**. The subsequent
  typecheck corrected a missing `error: null` in the test exit fixture; lint changed its host declaration to const.
- One broader targeted run was killed by the shell harness without an exit code; it is not passing evidence.
- The first background build launch was denied by the app permission layer before execution. No alternative
  launcher was attempted. `scripts/runtime-evidence-runner.mjs` is prepared but not execution-verified.
- No new build, complete branch gate, dev screenshot, after-p99, commit or push is claimed by this resumed run.
  The inherited 103.612 ms baseline is historical; fresh comparable before/after measurement remains required.
- Read-only inspection of `feat/stage3-coordination` found synchronous `deliverAnswer` still calling `session.answer`.
  It does not yet await `answerConsumed` or revalidate session/request identity after that await. Integrate this
  after stage three lands; do not enable the host by default in the meantime.
- Guard: exported the staged index with `git checkout-index --all --prefix=<temporary-directory>/`, scanned that
  complete tree against its `.guardallow` (exit 0), then ran `node scripts/guard-commit.mjs` (exit 0).
- Independent Claude Opus 5.5 review: **FAIL**, four findings reported. Two medium findings were delivered in the
  available summary: the start RPC's 30-second deadline killed valid native cold starts; `entry.fail()` used chat id
  without checking generation and could dispose a replacement session after an old broker rejection.
- Both medium findings now have actual red/green regressions: a deferred ready promise survives 30,001 virtual ms;
  a pending old-generation `turnEnded` rejected during replacement cannot kill the new adapter. Fixes: start dispatch
  acknowledgement is separate from ordered readiness; failure callbacks check the exact runtime identity.
- Latest `runtime-host.test.ts` + `runtime-entry.test.ts`: **13/13, exit 0**. Latest typecheck and lint: **exit 0**.
  Fragmentation's three tests passed in the earlier 14-test run and its implementation has not changed since.
  These last corrections have not been re-reviewed. The complete four-finding output was not delivered to this
  worker; recovering it and checking the remaining two findings still blocks a clean review. Review references
  are retained in the parent chat rather than treated as a PASS or silently replaced by a fresh full review.

### Recovery after the app restart

The resumed worktree already contained both medium fixes and their regressions in the staged implementation.
The successor independently repeated the red/green proof, temporarily restoring only the two faulty behaviors:

- Awaiting native readiness inside the start RPC killed the adapter at 30,001 virtual milliseconds.
- Removing the identity check from the entry failure callback killed the replacement adapter when the old broker
  rejected. Both selected tests failed with one unexpected `killNow` call each.
- Restoring both fixes and running `npx --no-install vitest run test/unit/runtime-host.test.ts
  test/unit/runtime-entry.test.ts` passed **13/13, captured exit 0**. The tests now also assert that the start receipt
  arrives while readiness remains pending, and that a stale failure emits no failed packet.

No complete four-finding review report was found in the worktree or the app evidence folder. The two unidentified
findings remain open, and neither the earlier FAIL nor the missing review is treated as a clean verdict. A fresh
independent review and stage-three `answerConsumed` integration remain required before any push/default activation.
This recovery is limited to local commits/rebase, one foreground build, one foreground `check:quick`, and guard checks.
The earlier interrupted/denied commands remain historical; the new foreground commands completed normally.

### Recovery gate receipts

- Implementation commit before rebase: `3c1212f5`; after rebase: `804f65a5`, based on `origin/main` at `a66f452f`.
  Commit and rebase both captured exit 0. The inherited branch commits rebased to `4694233e` and `b28a89c0`.
- `npm run build` in the foreground, with a 600-second tool timeout: **exit 0**, emitted `out/`. The only reported
  build warning was a minified chunk exceeding 500 kB.
- Exactly one `npm run check:quick` in the foreground, with a 600-second tool timeout: **exit 1**, failed at unit.
  Typecheck and changed-file lint completed successfully. Unit results: **1,318 passed, 1 skipped, 6 failed** across
  96 files (92 passed, 4 failed). No retry and no suite-wide timeout adjustment was made.
- Open gate failures: `guide-anchors.test.ts:102,112` reports a stale `permissions` point 1 anchor for
  `claude.ts#onControlRequest`; `chats/acp.test.ts:218,231` and `chats/claude.test.ts:158` timed out awaiting
  the no-brief question scenarios; `chats/turn-watchdog.test.ts:82` timed out awaiting its watchdog warning.
  The timeout causes remain undiagnosed; no claim that they are load-only or pre-existing is made.
- Direct worktree guard: **exit 2**, finding worktree metadata in `.git` and the unscanned `node_modules` junction.
  No allowlist or junction was changed. Exporting the entire versioned index with `git checkout-index --all` returned
  **exit 0**; scanning that complete source snapshot with its own unchanged `.guardallow` returned **exit 0**.

The code was built and checked at `804f65a5`; the following documentation-only receipt commit does not change it.
No push, default activation, dependency installation, new independent review, screenshots or dev lifecycle run was
performed by this recovery. All six gate failures, the two unidentified review findings, the new review and the
stage-three permission-consumption integration remain explicit blockers.

### Six-red classification and correction follow-up

Base comparison: temporarily switched this clean tracked worktree to detached `origin/main` (`a66f452f`), ran each
affected file alone using the existing dependencies, then switched back to `feat/app-owned-agent-runtime` at
`a442135f`. No stash, installation, new worktree, junction change or push was needed. All four baseline commands
returned **exit 0**: `guide-anchors.test.ts` 14/14, `chats/acp.test.ts` 53/53, `chats/claude.test.ts` 40/40 and
`chats/turn-watchdog.test.ts` 3/3.

| Previous red | Classification | Cause and correction |
|---|---|---|
| `guide-anchors.test.ts:102`, stale code anchor | Caused by stage two | The asynchronous `onControlRequest` change invalidated its stored hash. Re-read the permissions card: its description still matches the implementation. Regenerated the anchor. |
| `guide-anchors.test.ts:112`, maintenance not empty | Caused by stage two | Same stale anchor, exposed by the maintenance view; the same regenerated hash fixes both checks. |
| `chats/acp.test.ts:218`, missing-brief refusal | Caused by stage two | The retry deleted its grace marker before awaiting the asynchronous brief lookup, then scheduled grace again forever. Retain the marker until the retry settles. |
| `chats/acp.test.ts:231`, third-ask fallback/cancellation | Caused by stage two | Same retry loop prevented the first refusal and later fallback. Keep the exact map entry through the recheck and remove it in `finally`. |
| `chats/claude.test.ts:158`, missing-brief refusal | Caused by stage two | The Claude timer had the same premature marker deletion. Keep it through the asynchronous recheck and remove it in `finally`. |
| `chats/turn-watchdog.test.ts:82`, missing watchdog warning | Caused by stage two | Codex's asynchronous policy lookup moved its local `effortSubmitted` patch outside synchronous `send`; the watchdog misclassified it as an engine response. Ignore patches containing only local effort-submission metadata. |

Fresh red proof on the branch: the two unchanged guide checks and the real-adapter watchdog test failed (exit 1).
The watchdog test now advances fake time after the real adapter is ready instead of polling for a real deadline;
its first run still reproduced the missing warning. Four new fake-clock brief regressions (Claude/ACP, synchronous
and asynchronous callback) then failed with zero replies instead of one (exit 1). An initial parse error in that new
test fixture was corrected before this four-failure run and is not counted as a regression proof.

Green after the corrections: those three files plus the complete original ACP and Claude files passed **114/114,
exit 0**. The brief regressions also preserve two refusals followed by the third-ask panel, with no extra grace timer.
The original ACP and Claude assertions were not weakened. A new foreground build returned **exit 0** (only the
existing large-chunk warning).

The single follow-up `npm run check:quick` ran in the foreground with a 600-second tool timeout and completed with
**exit 1**. Typecheck and lint passed; all six original reds passed. Final unit results: **1,327 passed, 1 skipped,
1 failed**, across 97 files (96 passed). The new failure is `agents/delegation.test.ts:244`, "a result that keeps being
followed by siblings' still goes within the cap of the debounce": a wall-clock timestamp was 39 ms beyond the asserted
bound. This follow-up did not rerun the gate or that test, remove it, or claim its cause is pre-existing/load-only.
It remains an unclassified gate blocker, separate from the six stage-two regressions fixed above.

The independent review, two unidentified historical review findings, and `answerConsumed` integration after stage
three remain outstanding. No push or default activation is authorized by these partial verification results.

## Shared-file integration footprint

- `src/main/index.ts`: a guarded dynamic runtime-host setup before services; test-only recorder wrapper imports the
  new transport-timing module to preserve original cross-process timestamps. No normal diagnostic surface is added.
- `src/main/wiring.ts`, `src/shared/contract.ts`, all workflows and `manager-requests.ts`: unchanged by this assignment.
- `test/unit/agents/delegation.test.ts`: three existing hook assertions now await the widened callback result;
  their expected values are unchanged.

## Stage-three integration follow-up

Rebased the five stage-two commits onto `origin/main` at `acd84ba7` without conflicts. The request journal now prefers
the session's optional `answerConsumed` API: remote delivery stays `dispatching` until the host acknowledgement,
then becomes `delivered` or `failed`; a rejected acknowledgement becomes `uncertain`, with no automatic retry.
The synchronous adapters keep their existing path. Duplicate user submissions are refused while the acknowledgement
is pending; phone attribution survives a resolved event arriving after the RPC acknowledgement. Policy recaps and
pending removal also wait for consumption, and repeated away settlement cannot resend an accepted decision.

The focused manager and host-boundary tests pass (24 tests, exit 0), covering delayed success, duplicate submission,
false consumption, lost acknowledgement, policy success/failure and repeated away settlement during delivery.
A standalone typecheck also passes (exit 0). Full gate and guard
receipts are reported by the completing assignment; these targeted checks alone do not constitute that gate.

### Debounce classification

The old assertion at `delegation.test.ts:244` compared the actual callback's wall-clock timestamp with the deadline
of another timer. A timer deadline does not guarantee when the event loop runs the callback. Both this assertion
and the production debounce/cap implementation are unchanged in `acd84ba7`: stage two only changed three unrelated
hook assertions in that test file. The requested detached-main comparison passed both original debounce tests
(exit 0); it did not reproduce the historical 39 ms overrun, so it cannot establish a machine-load cause or a
stage-two regression. No such claim is made.

The two debounce tests now control Date and timeout scheduling explicitly, and await the actual delivery event.
They assert no early delivery, restart after a correction, a single latest-only batch, and a flush exactly at the
cap even with repeated sibling results. All result-content checks remain; the cap check is unconditional rather
than guarded by a wall-clock-dependent `if`. Both deterministic tests pass (exit 0). No production debounce code,
deadline, test timeout or gate exclusion was changed. The detached baseline remains for owner cleanup; no worktree
or junction was removed. The existing junction points at the main checkout, whose matching lockfile dependencies
were restored by the owner. This assignment installed nothing and does not push.

### Single final gate receipt

Implementation commit `97de9f40`: the single `npm run check:quick` returned **exit 1**. Typecheck passed; lint found
two `prefer-const` errors in the new debounce test callback targets (plus the existing non-blocking `wiring.ts`
length warning). Unit and documentation tests in that gate did not start. The callback targets now use a const
holder; targeted lint of all five changed TypeScript files returns **exit 0**. The gate was not repeated, so the
post-correction tip must not be presented as having a green branch gate. The earlier 24 manager/host and two
debounce test passes remain targeted evidence only. Independent review and a complete passing gate remain open.
