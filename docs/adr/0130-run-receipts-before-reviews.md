# ADR 0130 · Run receipts: deterministic checks before a Sentinel review

Date: 2026-10-22 · Status: accepted (owner approved the plan: "cut review cost with deterministic checks first, without
losing quality") · Builds on: ADR 0083 (the app owns the review loop), 0100 (XP = verified successes), 0103 (per-turn
checkpoints), 0125 (audits grade the judge)

## Context
With the judging switch on (the default), `judge-sample.ts` opens a full Sentinel chat (top tier, all tools) for every
finished root run, plus a second review for one run in ten. A run recorded only counters and the agent's own report:
nothing said which commands ran with which exit code or which files changed, so the only objective facts were reopen
and rework, and those only count against (`TRUST.facts = 0`). Many runs are code changes whose repo checks already say
whether they work: reviewing them with a model spends tokens to learn what the exit code of `npm test` already told.

## Decision
1. **Receipts (zero tokens).** While a run is open (and during the turn it ended in) `ChatManager` records in
   `AgentRun.receipts` (`agents/receipts.ts`), bounded: at most 12 commands (text cut to 120 chars; a check outlives
   other commands) with their exit code and whether they run a repo check; at most 15 changed paths (from the per-turn
   checkpoints, `checkpoints.ts turnFiles`), with flags computed over all of them (a test or check config touched, a
   code file touched); when a file last changed; commits (`git commit` exit 0) and PRs (`gh pr create` exit 0, a
   `create_pull_request` MCP tool). Exit codes come from the engines, on the tool row (`ChatItem.exitCode`):
   - **Claude** (stream-json): Bash / PowerShell results: an error result reads `Exit code N`; a non-error result is 0,
     except a background command, an interrupted one or one whose code the CLI reinterpreted
     (`returnCodeInterpretation`), which stay unknown;
   - **Codex** (app-server): `commandExecution.exitCode`, exact;
   - **ACP / Cursor**: ACP defines no exit code for a tool call (only client terminals have `exitStatus`, which the app
     does not offer); a `rawOutput` that carries `exitCode` / `exit_code` is read, otherwise unknown. A failed status is
     never read as an exit code.
   A command's time is when it started; a file's change time is the edit tool's, or the end of a turn whose files
   changed with no edit tool (a command changed them: an earlier check in that turn is not after them). A turn with no
   own checkpoint (not git, checkpoints off, git failed, a queued turn) is a gap: files unknown.
2. **Deterministic verdict.** `receiptVerdict` (pure, unit-tested), set when the run ends and its last turn's files are
   in: no code changed → `unknown` (non-code work: docs, messages, plans); the last run of a repo check after the last
   change failed → `fail`; report verified "yes" with no check run at all → `fail` (claims verified without evidence);
   files not fully known, a test or check config touched by the run (it may have written the check it passed), no
   check after the last change, an unknown or masked exit code (a pipe, `||`, `;`, `&`), a mechanical done-when
   criterion unmet (a commit, an opened PR) → `unknown`; otherwise every check after the last change passed → `pass`.
   The check list is small on purpose (npm/pnpm/yarn test·check·lint·typecheck, vitest, jest, tsc, eslint, pytest, go
   test, cargo test, dotnet test, mvn/gradle test, make test, rspec, phpunit): an unknown runner only costs a review.
3. **Review only when needed.** `judge-sample.ts` asks `receiptDecision` first: a `pass` the report agrees with (done)
   or a failed check the report agrees with (partial / blocked) becomes the run's outcome with basis `receipts`
   (`run-feedback.ts recordReceipts`), no Sentinel. `unknown`, `claims-unverified` or any disagreement goes to the
   Sentinel as before, whose prompt now carries the receipts. A receipts verdict weighs × 0.7 in the performance
   (`standing.ts TRUST.receipts`, below the user and a review × 1 and a graded review × 0.8, above the Orchestrator
   × 0.6) and its success counts as XP (an objective, independent check); only the user or a verified review replaces
   it, never an opinion.
4. **Audits.** The 1-in-10 audit (`auditPicked`) now also samples receipt verdicts (`pickReceiptAudits`): a Sentinel
   reviews the run; being its first review, its verified verdict becomes the run's outcome, and `judge-samples.json`
   keeps how it compared with the receipt (`graded`: agree / partial / disagree, also logged), so the receipts are
   graded like the judge.
5. **Cost estimate.** `judgingEstimate` counts in `runsPerDay` only the runs still reviewed, reports the ones the
   receipts decide (`receiptsPerDay`, free) and audits over all finished runs; the Agenti switch shows both.

## Consequences
- Code runs whose repo checks pass after the last change, untouched by the agent, cost no review; everything else is
  reviewed as before, so quality does not drop: a receipt never passes on unknown data, and one run in ten is checked.
- A run that writes its own tests is always reviewed (we cannot tell its checks existed before the run).
- Runs from before this ADR have no receipts and are reviewed as before. agent-runs.json grows by about 0.2–3 KB per run
  (bounded); the store's byte budget prunes the oldest runs into rollups as before. Receipts out of shape are dropped,
  never the run.
- Cursor runs mostly stay `unknown` (no exit code over ACP) and keep their review.
