# 0161 — Curated knowledge and evidence workbench

Status: implementation in progress.

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
