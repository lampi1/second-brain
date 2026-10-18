Title: feat(agents): install versioned role presets and preserve customized profiles

The catalog previously offered six short generic seeds. This change adds ten focused role presets with a shared safety preamble, explicit tool policies and permission ceilings, operating manifests, stop conditions and machine-readable run-report instructions.

Models are pinned from area-independent routing at installation; without a route, an available known CLI model is pinned. An unavailable explicit route is never silently replaced. With no eligible known model, installation waits until the next catalog load. Preset revisions upgrade pristine behavior with a new history entry; customized definitions expose an update badge and before/after field comparison. Loading an update into the editor remains a draft until the user saves it through the existing save flow.

Legacy seeds are archived only when untouched, unused in chat/run records, and replaced by an active preset. General remains available. Corrupt usage data prevents retirement. Role composition revisions remap membership overrides and primary-agent references; offline setup recommendations use the new IDs when available. Running chats keep their existing snapshots.

Integration (this PR also contains the designed glyphs of #42 until that merges):
- The ten presets use their designed role glyphs (`role-implementer` ... `role-planner`) and distinct tones; a unit test checks each preset has its own glyph and tone. Brother's approval of the glyph sheets (#42) still gates the release.
- A brand-new catalog retires the legacy seeds silently: before this, a new user received five "sostituito dai nuovi preset" notices for agents they never had. An existing catalog still announces each retirement. Unit test added.
- The preset update badge and comparison texts moved to i18n (it/en) instead of hard-coded Italian.
- Tests that asserted an exact archived list or the absence of the word "private" now account for the retired seeds and the preset texts: the archived assertions compare against the list just before the action, the history check includes archived definitions, the secret-field check uses a unique sentinel.

Validation (integrator, on origin/main 2e34ff7 + #42):
- `npx tsc --noEmit` and `npx eslint .` clean.
- `npx vitest run`: 2628 passed; `file-diff.test.ts` timed out under load and passes alone; the publish-guard test sees only the local untracked `tmp/`.
- Commit guard (`tools/guard/scan.mjs --commits`) clean.
- `test/e2e/role-agent-presets.spec.ts` adds screenshot acceptance; e2e runs only on main (ADR 0027).

Still open:
- Reconcile with the default-orchestrator preset and `.sbagent` fork-on-edit branches when they land (they adapt to this PR).
- Fresh installs show the five retired seeds under Archived; they are recoverable by design.
