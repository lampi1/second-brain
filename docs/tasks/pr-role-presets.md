Title: feat(agents): install versioned role presets and preserve customized profiles

The catalog previously offered six short generic seeds. This change adds ten focused role presets with a shared safety preamble, explicit tool policies and permission ceilings, operating manifests, stop conditions and machine-readable run-report instructions.

Models are pinned from area-independent routing at installation; without a route, an available known CLI model is pinned. An unavailable explicit route is never silently replaced. With no eligible known model, installation waits until the next catalog load. Preset revisions upgrade pristine behavior with a new history entry; customized definitions expose an update badge and before/after field comparison. Loading an update into the editor remains a draft until the user saves it through the existing save flow.

Legacy seeds are archived only when untouched, unused in chat/run records, and replaced by an active preset. General remains available. Corrupt usage data prevents retirement. Role composition revisions remap membership overrides and primary-agent references; offline setup recommendations use the new IDs when available. Running chats keep their existing snapshots.

Integration (on top of #42, the designed glyphs, now on main):
- The ten presets use their designed role glyphs (`role-implementer` ... `role-planner`) and distinct tones; a unit test checks each preset has its own glyph and tone. Brother's approval of the glyph sheets (#42) still gates the release.
- A brand-new catalog retires the legacy seeds silently: before this, a new user received five "sostituito dai nuovi preset" notices for agents they never had. An existing catalog still announces each retirement. Unit test added.
- Main's login-aware starters (`refreshDefaults`) and the presets now follow one readiness rule: a preset is never pinned to a logged-out or missing engine, prefers a ready one, arrives when an engine logs in on a catalog born without one (the starters it never showed retire silently), and a pristine preset rebinds to the ready engine after a re-login, like the starters. A customized preset stays pinned. Main's own seeding test now restores the retired development starter before customizing it. Unit test added.
- The preset update badge and comparison texts moved to i18n (it/en) instead of hard-coded Italian.
- Tests that asserted an exact archived list or the absence of the word "private" now account for the retired seeds and the preset texts: the archived assertions compare against the list just before the action, the history check includes archived definitions, the secret-field check uses a unique sentinel.

Validation (integrator, on origin/main 70773c8; per-branch checks decided by Brother on 2026-10-18):
- `npx tsc --noEmit` and `npx eslint .` clean.
- `npm run check:branch`: 1044 unit passed; `compare/headless.test.ts` "a run past its time is killed" timed out under load (the branch does not touch it) and passes alone, 21/21.
- Commit guard (`tools/guard/scan.mjs --commits`) clean.
- `test/e2e/role-agent-presets.spec.ts` adds screenshot acceptance; e2e runs once on main at the end.

Still open:
- Reconcile with the default-orchestrator preset and `.sbagent` fork-on-edit branches when they land (they adapt to this PR).
- Fresh installs show the five retired seeds under Archived; they are recoverable by design.
