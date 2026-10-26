<!-- Architecture and authority boundaries for the component platform, used by maintainers and routine authors. -->
# 0161 — Curated knowledge and evidence workbench

Status: implemented on the feature branch; final validation is tracked in `docs/work/routine-component-platform.md`.

External templates are authoring material, never executable authority. Public GitHub repositories and local text
bundles feed a bounded, token-free catalog. Network reads use fixed GitHub origins, reject redirects, pin a commit
before fetching files, and reject symlinks and oversized trees/files. Catalog refresh never changes a routine.

Staged bundles are content-addressed, include file hashes, origin, available license text and review findings.
Scripts, hooks and configuration remain inert. Component adoption copies selected bytes into a new routine draft,
through the existing definition/package validators. The existing native approval activates the exact routine;
there is no second installer, tool approval or permission model. Updates produce a file diff and a new draft.
Catalog sources and source enabling are user configuration; an agent can search/inspect/stage/propose, not enable
sources. Discovery and content are untrusted data, outside permanent agent prompts.

Readiness, comparisons and developer learning use host observations and explicitly report missing evidence.
An explanation is not a verified cause; a user approval is not a learning score. The learning entry point asks the
Orchestrator for a short explanation linked to changes/tests, with optional guided questions and no automatic rules.
Sealed workers retain their exact package. No prompt, grant, production or external CLI configuration is relaxed.

No new runtime dependency. Public source defaults may be suggested but require user opt-in before network polling.

## Context and observations
The launch manifest stores selected memory IDs/provenance, omission counts, skill hashes and a character-based
token estimate. It is not the vendor system prompt, billing usage or a measure of relevance probability. Existing
memory selection stays unchanged; sealed workers include no ambient brain memory. Missing legacy manifests are
unknown, never reconstructed as observed history.

Doctor reports local readiness and explicit unknowns, including paused grants, current role ceilings and unverified
credentials/interpreters. Runtime still checks every effect. Comparison and evaluation read recorded host receipts,
not model-generated quality scores. Suites are immutable; subjects cannot cross tuning/holdout splits. Latest-run
selection is disclosed. Missing runs remain unknown; case checks do not prove the truth of every agent claim.

Automatic retry holds require three identical failure classes without new observed evidence. Canonical report IDs
and host command receipt IDs are normalized only in known host fields. Raw diagnostics remain visible. Timed-out
workers are stopped before the hold; explicit user retry resets comparison and never raises existing attempt limits.

Voice diagnostics keep content-free counters and bounded timing samples in memory. The reported intervals are
endpoint-to-transcript and synthesis-request-to-main-audio, not microphone-to-speaker latency or recognition accuracy.
Fake/demo measurements are marked. No audio, transcript, session ID or usage profile is persisted.

The portable companion is an aggregate JSON/static HTML snapshot: whitelisted fields, escaped labels, no scripts,
remote assets, inputs, prompts, transcript, MCP endpoint or controls. It is deliberately offline; remote authenticated
hosting is future integration work. Executable mods, external CLI settings and template installers remain unsupported.

## Adoption and updates
Existing routines and approved versions need no migration. Sources default disabled; a user enables them in the
component modal. Public GitHub content is pinned to commits and blob hashes; local bundles are inert UTF-8 JSON
files. Exact byte limits, path checks and the existing routine validators apply. No new runtime dependency was added.

Catalog metadata is validated on load, and tool inspection returns manifests first, with bounded file pages on
demand. The native dialog can show complete files. An update is an old/new manifest diff plus a new draft carrying
selected assets, provenance and all bundled ancestor licenses. The existing modal approves the resulting exact
routine bytes. Scanner findings are review aids, not a security, license or compatibility certification.
