Title: feat(agents): add reviewed agent pack flows and typed IPC

Adds main-owned, expiring export/import reviews, guard-backed export fixes, script approval, permission clamps, collision handling and imported-agent probation. User skill files live in the brain with immutable version snapshots and editable copies; direct edits survive saves, approvals and version restores. Runtime adapters attach the frozen skill package to Claude and Codex, and inject the own skill and learned rules into Cursor context.

Adds asynchronous learned-rule proposals, explicit approval/edit/discard, preset fork-on-edit and comparison, and automatic trials for higher untouched preset revisions. Real and demo wiring share the same scanner boundary. Export summaries are opt-in, including after cancelling a save dialog. Owned files open in a text editor rather than executing script associations.

Validation: TypeScript and ESLint on changed files pass. Related unit suites cover flows (18), chat persistence (1), pack layouts (24), agent versions (17), catalog (14), IPC allowlist (2), engine registry (7), and app-control tools (21). Regression tests were observed red before fixing direct-edit loss, deleted-file rescan, augmented Cursor context restoration and stale rules after a pre-knowhow restore. Fresh reviewer found no remaining blocker in these fixes. E2E execution is deferred to the final main gate, as requested.

Integration dependency: this checkout has no brain-pulse scheduler. `learnedRulesMaintenanceJob` supplies its engine-independent job descriptor and `learned-rule` kind; registration must be connected when that scheduler lands. The proposal tool and review IPC work independently. Do not mark scheduler integration complete.

Limits: anonymous summaries refuse compacted run histories rather than report incomplete counts. Preset comparison currently displays instruction texts; full knowledge-file comparison remains a follow-up. Native plugin compatibility evidence and remaining Cursor/Codex installation uncertainties are recorded in the core PR text. UI is the next stacked branch.
