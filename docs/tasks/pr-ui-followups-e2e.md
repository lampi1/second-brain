Title: fix(e2e): preserve remaining UI follow-ups on current Grindhouse

<!-- Local PR handoff: explains the reconciled parked fixes and validation for the integrating Orchestrator. -->

Merge current main into the parked follow-ups branch without rewriting history. Keep main's navigation and Grindhouse strip fixes, and add only the remaining corrections:

- Use G-letter navigation for detail pages still accessed through absent sidebar entries; preserve main's Ctrl+K navigation, top-bar menu coverage, closeSetup, openAgents and expandChats helpers.
- Match the current agent start flow, coordinator wording and GenUI choice selector. Restore the existing-coordinator note and accessible description in AgentStartDialog, plus the context section's test selector.
- Open the stopped chat before checking its transcript and size the maximized browser relative to its workspace.
- Contain the brain map beside the Orchestrator column. Apply flex only to the map so its hidden toast sibling cannot consume half the workspace; add geometry assertions to the existing map acceptance spec.

Dropped as duplicates: the parked agent-studio, menus, navigation and personal-progress rewrites; repeated question/input/live-demo strip expansions; the legacy working-column locator. Kept main's versions of these checks. Also dropped the old base's unrelated opacity-setting removal and its associated changes. The question-choice selector now uses the current GenUI class; no separate line-ending rewrite was needed. No visual baselines changed.

Validation: TypeScript --noEmit and ESLint on touched TypeScript files passed; 4 targeted unit files passed (19 tests: agent-start-role, orchestrator-column, orchestrator-dock, orchestrator-several). Build passed with bundling warnings. Hidden isolated app inspected: dialog note and map with synthetic brain data; map width 1076 px ends exactly where the 524 px Orchestrator column begins in a 1600 px window. Fresh-context correctness/UI review found no remaining blockers after the map flex correction.

E2e specs and screenshots were not run or regenerated. The changed specs first run on main after merge, including the new map geometry assertions. Commit guard and final branch-check results are recorded in tmp/handoff-uifollow.txt.
