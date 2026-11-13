Title: feat(agents): evaluate probation and measure Generale runs by tags

<!-- Review hand-off for A7b: behavior, validation and integration limits for the human opening the PR. -->

Manual chats without a selected agent now run as Generale and receive the same run accounting as catalog agents. Generale is restored when missing and cannot be archived; existing chats retain their original ownership.

Add validated probation state, keep/retire decisions with version history, a pure evaluator, daily evaluation, and quiet kept/normal retired feed events with a restore action. Human edits end an existing probation. This supplies the data and rules for A7; creating probation agents and the approval UI remain with their owning workstreams.

Runs capture skills, app and repository tags. Metric filters retain exact counts for single and combined tags after pruning, within the existing 1 MB rollup budget; tag counts are dropped before samples. Untagged legacy runs never match a tag filter. Start skills work across engines; automatic tool-use discovery currently recognizes Claude's Skill events.

Validation: TypeScript, touched-file ESLint, build, and seven related unit specifications (98 tests). Fresh-context correctness/security review completed; regressions cover combined filters after pruning, the lower rework time boundary, and human verdicts after a run has ended.

The new `test/e2e/generale-run.spec.ts` must first run on main after merge, in `npm run check`, per ADR 0027. It writes its screenshot outside the repository. No PNGs are committed. Hidden dev inspection and final branch gate results are recorded in the hand-off.

No new dependency, approval popup, updater promotion, or production integration. Pack import, preset fork storage and the asynchronous approval list remain in ADR 0069/0070 workstreams.
