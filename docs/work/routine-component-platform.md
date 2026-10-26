<!-- Recovery checkpoint for the component platform implementation. Keep this accurate at each commit. -->
# Routine component platform: implementation checkpoint

Branch: `feat/routine-component-platform`
Base: `2cd103fdd7889a826e9f62355810bbfc6dfcdc5d`
Status: implementation and independent static reviews complete; final branch checks pending. Native visual verification is blocked by the cloud environment. Not ready to merge.
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
- [ ] K. Documentation, meaningful tests, visual verification and independent reviews.

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
  rechecked without remaining confirmed findings. These are static/in-memory reviews, not native visual approval.

Fixed findings include ancestor licenses/BOM bytes; canonical report/command IDs incorrectly counted as progress;
stopping timed-out live workers before a hold; multiline evidence; paused automation grants; cross-routine suite
results; case-insensitive source identity; role defaults/ceilings; stale catalog matches/history; focus tokens and
localized workbench summaries. Exact host diagnostics remain available under technical details.

## Remaining release gate and recovery
Run `npm run check:branch` and `npm run build` on the final clean commit; record exit codes in the handoff/PR.
Native hidden-development inspection was attempted with an isolated synthetic profile, `SB_HIDDEN=1`, and no
external services. Electron crashed before creating a window: `process_singleton_posix.cc: socket() EPERM`. No
screenshots were produced. Do not claim a passed visual inspection or merge readiness from the static reviews.

On an environment that can launch Electron, inspect Components, Verifica e confronta, Contesto dell’agente and
Voice diagnostics in the hidden dev app, including keyboard focus and a narrow window. Capture actual screenshots.
Do not execute branch e2e; its first execution remains on main under the repository policy. Keep this branch/PR
unmerged until native visual verification and the owner's review are complete.

Known limits: retrospective evaluation does not launch paid model jobs (existing Learning replay remains explicit);
counts are not causal rankings; readiness cannot prove remote credentials or availability; voice timing is partial,
not end-to-end latency; the companion is an offline export, not a remote service; executable mods are staged only.
