Title: feat(agents): install versioned role presets and preserve customized profiles

The catalog previously offered six short generic seeds. This change adds ten focused role presets with a shared safety preamble, explicit tool policies and permission ceilings, operating manifests, stop conditions and machine-readable run-report instructions.

Models are pinned from area-independent routing at installation; without a route, an available known CLI model is pinned. An unavailable explicit route is never silently replaced. With no eligible known model, installation waits until the next catalog load. Preset revisions upgrade pristine behavior with a new history entry; customized definitions expose an update badge and before/after field comparison. Loading an update into the editor remains a draft until the user saves it through the existing save flow.

Legacy seeds are archived only when untouched, unused in chat/run records, and replaced by an active preset. General remains available. Corrupt usage data prevents retirement. Role composition revisions remap membership overrides and primary-agent references; offline setup recommendations use the new IDs when available. Running chats keep their existing snapshots.

Validation:
- ESLint passed on the changed source and test files; git diff --check passed.
- npm run typecheck and npm run check:branch were attempted. Both stop on missing diff, highlight.js and pdfjs-dist dependencies in existing renderer modules. The branch check also cannot record its start under the read-only Git worktree metadata.
- Vitest was attempted for catalog/version suites. No tests executed: EPERM creating its SSR temporary directory outside the sandbox.
- Added migration, pinned routing, pristine upgrade, customized diff, unavailable route and role-remapping unit coverage; updated the existing composition/catalog expectations.
- Added test/e2e/role-agent-presets.spec.ts with screenshot acceptance. Not run: e2e is main-only and the brief forbids launching the app.

Integration gates still required:
- HEAD and the local origin/main ref both resolve to 2e34ff7; no merge is needed now. The attempted merge was denied at ORIG_HEAD.lock. The Regia handles integration when the parallel branches land.
- Reconcile catalog installation with the parallel default-orchestrator preset and .sbagent fork-on-edit changes. This patch does not change coordinator selection; default-orchestrator is absent from this base.
- The additional ui-agents-revision specification makes approved designed icons a release dependency. Presets currently store the specified symbol/tone pairs and reuse AgentAvatar; this base still maps them to generic existing glyphs. Integrate the designed icon set and confirm its owner approval before release.
- Obtain the requested visible fresh-context reviewer, restore dependencies, run the unit/branch gates, then execute e2e/visual acceptance on main.
- Run the publish guard, commit reviewed product files only (never tmp/), and have the authorized integrator push/open the PR. No commit, push, PR or merge was performed here.
