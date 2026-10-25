<!-- Recovery checkpoint for the component platform implementation. Keep this accurate at each commit. -->
# Routine component platform: implementation checkpoint

Branch: `feat/routine-component-platform`
Base: `2cd103fdd7889a826e9f62355810bbfc6dfcdc5d`
Status: first integrated implementation checkpoint; validation/reviews in progress. Not ready to merge.
Scope: implement the actionable improvements from the component comparison report, preserving existing host approvals, validators and field limits. Add evidence-linked developer learning.

## Resume with any provider
1. Read AGENTS.md and this file. Fetch this branch; do not use a stale worktree.
2. Inspect git status and the latest commits before changing anything.
3. Continue the unchecked deliverables below. Never report a foundation as a finished integration.
4. Run focused unit tests, typecheck, branch checks and build. Do not run branch e2e.
5. Obtain independent security, correctness and UI reviews before delivery.
6. Update this checkpoint with exact commands/results and remaining limitations.

## Deliverables and acceptance
- [ ] A. Generic component sources: versioned catalog cache, bounded search and full inspection. Public pinned GitHub content and local bundles; refresh without model calls; no installer.
- [ ] B. Immutable staged bundles: per-file hashes, licenses, dependencies, compatibility and changes; digest-bound user decision; routine conversion remains an inert draft through existing validation.
- [ ] C. Orchestrator tools and native UI: discover, inspect, propose/update; no agent approval endpoint; clear yes/no/free-text decisions; no catalog in the always-on prompt.
- [ ] D. Context inspector: selected/omitted memory, skills, provenance and estimated cost; no silent changes to sealed routine workers.
- [ ] E. Routine readiness: host checks of package/models/workspace/interpreters/grants/targets and explicit unknowns; same read model in UI and tools; runtime revalidates effects.
- [ ] F. Bounded progress/rework inspection: evidence-based repeated-failure detection and visible recovery, preserving existing limits and review checks.
- [ ] G. Routine evaluation workbench: versioned cases, deterministic checks, host-linked observations, comparable version results and data coverage; no fabricated scores or automatic promotion.
- [ ] H. Version analytics and improvement proposals: observed outcomes, attempts, waits, intervention counts; candidate versions only.
- [ ] I. Developer learning: concise change brief, causal explanation, tradeoffs, evidence/commit links, optional guided questions and Orchestrator handoff; no knowledge scores inferred from approvals.
- [ ] J. Voice diagnostics and portable read-only companion view: observed events, coverage and safe export; remote access must use explicit opt-in authentication, never expose local MCP.
- [ ] K. Documentation, meaningful tests, visual verification and independent reviews.

## Boundaries retained
No production execution, no external release changes, no runtime dependency on the catalog, no automatic import of hooks/mods/settings or native CLI configuration edits. Optional executable extensions are inspected/staged only until the user approves a concrete capability; catalog popularity and scanner scores never grant authority. New integrations require explicit adapters, not shell bypasses.
Do not copy personal data or company-specific routine definitions into this public repository.

## Validation and publication
Implemented so far (unchecked acceptance items still need final verification):
- Public GitHub/local inert catalog, commit/blob/hash checks, ancestor licenses, opt-in sources, daily metadata refresh,
  search/inspect/stage tools and native component dialog. Import copies selected files into the normal routine draft.
- Routine Doctor, retrospective immutable evaluation suites, version analytics, native workbench and aggregate export.
- Repeated identical failures stop after three attempts without new host evidence, preserving explicit user retry.
- Frozen launch memory/skill manifest, chat menu inspector and Orchestrator read tool; sealed workers load no ambient facts.
- Optional developer-learning handoff and local content-free voice diagnostics.

Verified: 93 focused unit tests across components, workbench, flows, memory, agent packs, context and voice passed.
Typecheck passed before the final voice/file-input additions; rerun on the checkpoint. Initial independent security
review found two issues (ancestor licenses and UTF-8 BOM preservation); fixed and covered by regression tests.

Remaining before delivery: rerun typecheck/full branch checks/build; harden catalog metadata read validation;
finish concise inspection/exports and capabilities/docs; add visual/e2e specs (do not execute branch e2e); verify
screens in hidden dev; fresh final security/correctness/UI reviews; fix confirmed findings. Review repeated-failure
integration and launch-manifest persistence in particular. Retrospective evaluation does not launch paid model jobs;
existing Learning replay remains the explicit execution path. Companion is an offline read-only export, never an
unauthenticated remote service. Remote hosting/mod execution are not enabled.

The remote branch is a recovery checkpoint, not a completed or reviewed release.

