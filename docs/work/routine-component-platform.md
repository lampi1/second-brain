<!-- Recovery checkpoint for the component platform implementation. Keep this accurate at each commit. -->
# Routine component platform: implementation checkpoint

Branch: `feat/routine-component-platform`
Base: `2cd103fdd7889a826e9f62355810bbfc6dfcdc5d`
Status: implementation and independent reviews complete. Branch checks, build and native CI screenshots passed on db3afdc; final visual polish is awaiting the same checks. PR #240 remains a draft because the whole-history privacy CI gate reports existing main-history findings.
Scope: implement the actionable improvements from the component comparison report, preserving existing host approvals, validators and field limits. Add evidence-linked developer learning.

## Resume with any provider
1. Read AGENTS.md and this file. Fetch this branch; do not use a stale worktree.
2. Inspect git status and the latest commits before changing anything.
3. Continue the unchecked deliverables below. Never report a foundation as a finished integration.
4. Run focused unit tests, typecheck, branch checks and build. Do not run branch e2e.
5. Obtain independent security, correctness and UI reviews before delivery.
6. Update this checkpoint with exact commands/results and remaining limitations.

## Deliverables and acceptance
- [x] A. Generic component sources: versioned catalog cache, bounded search and full inspection. Public pinned GitHub content and local bundles; refresh without model calls; no installer.
- [x] B. Immutable staged bundles: per-file hashes, licenses, dependencies, compatibility and changes; digest-bound user decision; routine conversion remains an inert draft through existing validation.
- [x] C. Orchestrator tools and native UI: discover, inspect, propose/update; no agent approval endpoint; clear yes/no/free-text decisions; no catalog in the always-on prompt.
- [x] D. Context inspector: selected/omitted memory, skills, provenance and estimated cost; no silent changes to sealed routine workers.
- [x] E. Routine readiness: host checks of package/models/workspace/interpreters/grants/targets and explicit unknowns; same read model in UI and tools; runtime revalidates effects.
- [x] F. Bounded progress/rework inspection: evidence-based repeated-failure detection and visible recovery, preserving existing limits and review checks.
- [x] G. Routine evaluation workbench: versioned cases, deterministic checks, host-linked observations, comparable version results and data coverage; no fabricated scores or automatic promotion.
- [x] H. Version analytics and improvement proposals: observed outcomes, attempts, waits, intervention counts; candidate versions only.
- [x] I. Developer learning: concise change brief, causal explanation, tradeoffs, evidence/commit links, optional guided questions and Orchestrator handoff; no knowledge scores inferred from approvals.
- [x] J. Voice diagnostics and portable read-only companion view: observed events, coverage and safe export; remote access must use explicit opt-in authentication, never expose local MCP.
- [x] K. Documentation, meaningful tests, native visual verification and independent reviews; final polish must pass the same gates.

## Boundaries retained
No production execution, no external release changes, no runtime dependency on the catalog, no automatic import of hooks/mods/settings or native CLI configuration edits. Optional executable extensions are inspected/staged only until the user approves a concrete capability; catalog popularity and scanner scores never grant authority. New integrations require explicit adapters, not shell bypasses.
Do not copy personal data or company-specific routine definitions into this public repository.

## Validation and publication
The complete implementation is in this branch. No migration, dependency addition, grant relaxation, active-routine
mutation, external CLI configuration write or production operation is required. The README and ADR 0161 describe
entry points and limitations; `app_flow_capabilities` discovers component and verification tools on demand.

Completed: pinned GitHub/local catalog, inert staging and user-approved adoption; compact tool inspection; launch
context manifests; Doctor and version metrics; retrospective evaluation; bounded no-progress retry holds; optional
evidence-linked learning; voice measurements; aggregate JSON and offline HTML companion exports.

Validation already observed:
- Original checkpoint 36b98f15: branch checks and build passed in the previous session (2384 tests passed, 6 skipped).
- Review fixes: 72 focused tests in 6 files passed, plus typecheck and focused lint, exit 0.
- New `test/e2e/routine-workbench.spec.ts` covers component inspection/history/focus, workbench checks/evaluation/HTML
  export, context manifests and voice observations, each with screenshots. Authored only; no branch e2e executed.
- Independent Astra xhigh security, correctness and UI reviews found issues; all confirmed findings were fixed and
  rechecked without remaining confirmed findings. The UI reviewer also inspected five actual native screenshots.

Fixed findings include ancestor licenses/BOM bytes; canonical report/command IDs incorrectly counted as progress;
stopping timed-out live workers before a hold; multiline evidence; paused automation grants; cross-routine suite
results; case-insensitive source identity; role defaults/ceilings; stale catalog matches/history; focus tokens and
localized workbench summaries. Exact host diagnostics remain available under technical details.

## Final verification and recovery
At db3afdc, `npm run check:branch && npm run build` passed with exit 0: 272 test files passed, 2 skipped;
2403 tests passed, 6 skipped, plus the separate publish-guard test. Typecheck, changed-file lint and guard passed.
GitHub run 40279840244 passed the branch gate on Windows, macOS and Linux. The hidden native dev-visual job also
passed: 18 screenshots, no renderer errors, isolated synthetic fixtures, no paid services or branch E2E execution.
Its artifact is https://github.com/lampi1/second-brain/actions/runs/40279840244/artifacts/12631182727 .
The five new views were inspected independently. Final polish styles component fields, keeps the adaptation action
in the fixed modal footer, aligns voice diagnostics and fixes singular counts. Re-run checks and native captures
on that final commit; record the exact results in PR #240: https://github.com/lampi1/second-brain/pull/240 .

The whole-history privacy CI job reports ten email findings in nine historical commits already reachable from
main at 2cd103f. They were not introduced by this branch. Do not rewrite main history or add guard exceptions to
hide them. Keep the PR unmerged; the owner reviews the implementation and resolves the historical release gate.
The new E2E spec is authored but deliberately not executed on this branch; its first run remains on main.

Known limits: retrospective evaluation does not launch paid model jobs (existing Learning replay remains explicit);
counts are not causal rankings; readiness cannot prove remote credentials or availability; voice timing is partial,
not end-to-end latency; the companion is an offline export, not a remote service; executable mods are staged only.
