# Open risks after the fast merge of 2026-11-08

What it is: the reviews, checks and known reds that were skipped or left open when every finished branch was merged
into `main` at once. Why: the owner, 2026-11-08, «fai mergiare tutto ciò che è stato fatto adesso, mergialo su main
subito, niente controlli» and «beh che lo lasci in un documento per i prossimi agenti». Who uses it: any agent (a cloud
agent included, which sees only GitHub) before working on one of these areas. **Whoever fixes a risk removes its
line**; when the file is empty, delete it and its line in `AGENTS.md`.

Every branch came in through the integration branch `int/queue` as one `--no-ff` merge; the merge commit is named
after the branch (`git log --first-parent --oneline main`). The ADR clashes were renumbered: Remote Control
0222 → 0229, Impara 0221 → 0230, agents-merge rule 0221 → 0231, OpenCode permissions 0221 → 0232.

**Not run on the merged tree at all:** typecheck, lint, unit tests, e2e and README/doc-freshness checks
(`npm run check` without e2e is the first thing to run on `main`). The machine was saturated (100 % CPU) all day,
so many unit reds seen on the branches were timeouts, not verified failures.

## Per branch

| Branch (merge on main) | Skipped or open | Known risk | Look at |
|---|---|---|---|
| `feat/parallel-checkpoint` (on main before, 76ef2dcc) | none open: Sentinel clean, barrier tests 6/6 and 5/5 green on a lighter load | — | `src/main/chats/write-barrier.ts` |
| `feat/acp-catalog-replay` (9e7cb916 + 27875258 + 5ef1509b) | the fix of the Sentinel's first finding (the Codex thread preview, the user's first message, was written in clear in the wire recordings) was cherry-picked, not re-reviewed on the merged tree | a wire recording could still hold user text | `src/main/chats/wire-record.ts`, `test/unit/chats/wire-record.test.ts` |
| `impara/land` (36796d6d) | e2e «a topic» red on Windows (the frozen demo's `filesVerdicts` path escape; already red on main before) | — | `src/main/learn/demo.ts`, `test/e2e/impara.spec.ts` |
| `feat/worktree-pool` (746aa3e1) | none open: Sentinel clean on the commit and on the conflict resolution. Minor notes left: `README.md` (Worktree section) should say automatic cleanup starts only after the first «Pulisci ora»; comments in `src/main/ipc-handlers/app.ts` and `src/shared/contract/app.ts` say «Ruoli e deleghe» but the block is in Avanzate | — | `src/renderer/components/WorktreeSettings.tsx`, `src/main/brain/settings-schema.ts` |
| `test/restyle-e2e-refresh` (88135d5d) | e2e `agent-card-model`, `phone-bridge` and `setup-simple` red, not diagnosed | stale specs or real regressions, unknown | `test/e2e/` |
| `chore/faster-agent-checks` + `docs/gate-no-e2e` (703bc6c4) | the Sentinel review of 21a8a437..40c88d3b found 3 doc findings; they were fixed in 9dcb3df8 with no re-review. One minor note not acted on: `CONTRIBUTING.md` says the e2e suite runs only when the maintainer asks, while `npm run promote` runs `npm run check` (e2e included) | — | `scripts/check-quick.mjs`, `docs/agents/rules.md` §7 |
| `chore/auto-merge-main` (cf636cf3) | stage 1 also aligns the Orchestrator runtime prompt with §7 and the ADR 0231 amendment; independent review pending | §7 remains the gate's source, and a narrower current assignment still wins | `docs/agents/rules.md` §7-8, `docs/adr/0231-agents-merge-verified-branches-to-main.md`, `src/main/agents/orchestrator-role.ts` |
| `feat/agent-comms-cloudroom` (44cb99d3) | e2e `orchestrator-wake.spec.ts:35` red under load and never seen green; the unit test `delegation-reuse` timed out | the wake e2e may be a real regression from the quiet turn ends (ADR 0223) | `test/e2e/orchestrator-wake.spec.ts`, `src/main/agents/delegation.ts` |
| `fix/opencode-auto-permissions` (7161bde0) | stage 1 includes all three later fixes (27338abf, ed7413b2, 9c953764); fresh security review pending, historical final review not confirmed | auto-approved permissions on OpenCode chats: security-sensitive | `src/main/brain/adapters/opencode-permission.ts`, `docs/adr/0232-opencode-auto-permissions.md` |
| `chore/drop-load-flaky-tests` (3b3b546e) | Sentinel findings 2, 4, 6 fixed; 1, 3, 5 accepted as the owner's decision to delete the tests; no re-review of the fixes | coverage removed for load-sensitive paths | `test/unit/` (the files the merge commit touches) |
| `fix/harness-parity-resume-tools` (6d3d7b9b) | stage 1 reproduces and fixes the medium replay finding below; fresh lifecycle review pending | residual permission risks below remain unverified | `src/main/chats/acp.ts`, `src/main/chats/manager-sink.ts` |

## Stage 1: replay consolidation evidence

Base: `5b6c5b69`, preserving the published WebP fixtures and German guide. Chosen implementation: the two production
files of `7dc8b5fa`. Replay is owned by a session identity, and cleared on its exit, so a replacement never inherits
its predecessor's replay even without resetting a shared boolean at sink construction. The competing boolean-reset
implementation in `9a52c202` plus its working diff is not applied. Both original worktrees remain untouched.

The regression adapts the second candidate's agent-reopen path and uses the first candidate's crash fixture (flushed
output before exit). The original `7dc8b5fa` test used a user's send, which bypasses admission and cannot prove slot
release. Here the agent reopens an auto-closed chat through `gate()` with kind `start`, holds one slot, and queues a
successor. On the unfixed base plus this same fixture/test: **exit 1**, expected slots 0, actual 1 after the real
assistant answer; successor not admitted. With the identity-bound fix: **exit 0**, slot released and successor admitted.
Command: `npx vitest run test/unit/chats/admission.test.ts -t "an engine that died during session/load"`.

Optional `SB_STAGE1_MEASURE=1` emits diagnostic event times and existing engine-ready/before-send/first-event timings;
there are no assertions on wall-clock duration. This is one normal cold fake-ACP replay, not a load test or a claim
about model inference. Windows, Node test runner, forced sampler CPU 10%, free RAM 60%, one slot, warm pool off.
The first engine dies during `session/load`; only its fresh successor produces a real answer. Independent review and
the final branch gate are still required before this branch is ready.

Diagnostic sample (milliseconds, not a performance gate): before = base plus regression, after = identity-bound fix
with the same regression; ordinary machine activity was not controlled. Cold-start admission wait was 0 in both.

| Measurement | Before | After |
|---|---:|---:|
| Crash observed / slot released, from scenario start | 458 | 614 |
| Fresh successor admitted, from scenario start | 470 | 625 |
| Successor engine ready (native adapter log) | 262 | 488 |
| Before-send total / engine portion | 276 / 271 | 509 / 503 |
| Before-send non-engine residual | 5 | 6 |
| Prompt to first engine event | 25 | 22 |
| First full real response observed, from scenario start | 803 | 1228 |
| Slots held after response / queued successor admitted | 1 / no | 0 / yes |

The larger after total is in engine initialization (244 -> 466 ms), not a new local dispatch wait. One diagnostic
sample is not statistical evidence of unchanged throughput; the queue invariant is proved independently of timing.
The crashing load has no real answer, so its load-to-answer duration is not reported as zero.

Initial branch gate: typecheck and changed-file lint passed; 975 unit tests passed, 1 skipped, 4 failed. The frame
budget and stale guide-anchor failures were corrected (48 focused tests then passed). The remaining failure,
`checkpoint-barrier.test.ts:140`, triggered the checkpoint follow-up below. Full e2e and the non-e2e main batch check
remain unrun here.

### Checkpoint deadline follow-up

The unchanged original test passed once on isolated `5b6c5b69`, then passed all five requested repetitions (5 green,
0 red), and passed once on `19a37a84`. The initial gate failure is intermittent; those samples alone do not prove
whether it predates the branch. The temporary base worktree was removed after the comparison.

A separate deterministic regression (`checkpoint-deadline.test.ts`) holds the prior turn's end read across the next
turn's deadline with a promise and fake timer, then writes `TARDI`, finishes the old read and undoes the old turn.
Before the fix it fails with actual `ORIGINAL`, expected `TARDI`; after the fix it passes. The implicated production
files were unchanged between `5b6c5b69` and `19a37a84`, proving the faulty ordering exists in the base code too.

Cause: `ManagerCheckpoints.checkpoint` races the previous snapshot/end against the new deadline. On timeout it opens
the write barrier while `recordTurnEnd` can still read the files. That late end tree includes the next turn's write;
`restore` then attributes it to the earlier checkpoint (or, for a missing end tree, uses the entire current tree).

Fix: mark unresolved older end records uncertain before releasing writes, including queued end records through a
turn watermark. A late read cannot make them safe again. Undo still records a backup, but preserves all current
files when the selected checkpoint's end is uncertain. Completed end trees keep their normal selective undo.
The original `checkpoint-barrier.test.ts` is byte-for-byte unchanged; it and the new regression passed (7/7).

The next full branch gate passed typecheck/lint and the original checkpoint test, but is still blocked: 981 tests
passed, 1 skipped, 3 failed. One failure was the new regression's initial real snapshot deadline; all of its
deadline timers are now frozen before the first snapshot and its focused run passes. The other two failures,
`correction-catch-hook.test.ts:79,86`, are outside this change: semantic/recall responses were missing. The production
hook has real 200/300 ms HTTP deadlines while these tests expect localhost replies; cause still needs independent
confirmation. They were left intact in the checkpoint commit; the follow-up below addresses their nondeterminism.

### Hook deadline follow-up

The requested comparison ran only `correction-catch-hook.test.ts`: five runs on `5b6c5b69` all passed (30/30 test
executions); five runs on `9214938f` gave four passing files and one failure (29/30 test executions). The intermittent
failure was the semantic-positive assertion at line 50; the earlier combined gate had failed lines 79 and 86.
CPU sampled immediately before each run through Windows `Win32_Processor.LoadPercentage`: base 78/90/81/79/55%,
tip 93/68/80/71/69%. These are snapshots, not average load measurements or a synthetic load generator.

Cause: the subprocess uses real `AbortSignal.timeout(200)` for detection and `(300)` for recall
(`brain-template/.claude/hooks/correction-catch.mjs:34,47`). Tests asserting successful local HTTP replies were racing
those deadlines against process scheduling and MCP service time. The timeout fallback correctly returns no semantic
result/no recall, which contradicts those success assertions when scheduling is delayed.

The test-only `hook-deadline-clock.mjs` preload controlled those AbortSignals via IPC in the real hook subprocess (2026-11-09:
that test and the preload were removed with the other real-process tests, `docs/tests/load-sensitive-removed.md`).
Successful requests use the real HTTP/MCP server without advancing virtual time; timeout cases deliberately hold
the response and advance the unchanged 200/300 ms budgets. All content/count assertions remain, and the harness
also requires an actual expiry acknowledgement for timeout scenarios and rejects unexpected budgets/nonzero exits.
No production hook, settings or permission behavior changed. The fixed file passed once, then ten requested runs
all passed (60/60 test executions); CPU snapshots for the ten runs: 100/83/93/68/100/75/100/57/93/86%.

The temporary recall-baseline worktree was left for owner cleanup after its removal was denied; no cleanup retry.
The subsequent complete `check:quick` passed typecheck, lint, hook tests and checkpoint tests: 982 tests passed,
1 skipped, but 2 other tests failed (`chats/claude.test.ts:368`, interrupt still running instead of idle;
`chats/proctree.test.ts:80`, orphan reap count 0 instead of 1). Neither was retried, skipped or changed by this
follow-up. The overall gate remains blocked pending those failures and the independent reviews of the final tip.

Low residual risks of the same branch, explicitly unverified and carried into the runtime migration: trust by server name (a user-defined OpenCode MCP server named
`second-brain` would be treated as the app's own); shell permissions without a `kind` fall into the Tool category;
Kimi's MCP tool naming.

## Outside this repo

The brain's `code.md` "Repo exceptions" and its line B-171 still describe the old gate with e2e and a lock: a Scribe
updates them (not a repo file).
