Title: fix(e2e): align menus and navigation with the Grindhouse UI

<!-- PR draft for the human integrator: explains the stale navigation assertions and validation status. -->

The Grindhouse redesign intentionally removed secondary pages from the default rail and made the Orchestrator column persistent. The menus spec still expected a rail entry for app improvement, and four navigation tests still clicked the removed Costi/Idee entries.

Update the specs to open secondary pages through Ctrl+K, verify Dashboard and Skill ordering in the App rail group, and open app improvement through the top-bar menu. Keep the badge warning and clear-on-visit assertions by explicitly seeding a saved CTO role with Idee included. Verify that Ctrl+R focuses the persistent Orchestrator input, including repeated use.

Validation:

- `npx tsc --noEmit`, ESLint on both changed specs, and `git diff --check` passed.
- The publish-guard unit test passed for all three changed files, using the repository's allow list and configured deny list.
- The literal `node tools/guard/scan.mjs .` command reported two findings in the worktree's `.git` pointer file (local paths); no guard exceptions were added.
- `npm run check:branch` has reported failures outside this diff in `release-writer.test.ts` (Electron assets were not yet installed) and `compare/headless.test.ts` (process-tree timeout). Electron setup was completed afterward; the full branch check is not green.
- E2E execution remains pending on main, as required by AGENTS.md; neither spec is skipped or weakened.
