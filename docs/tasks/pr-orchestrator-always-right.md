Title: fix(ui): keep the Orchestrator beside Dashboard and the brain map

<!-- PR description and verification handoff for the integration chat. -->

Dashboard and the 3D brain map now retain the persistent right-hand Orchestrator column and reserve its width. Discuss and Ctrl+R focus the coordinator without navigating away or losing the selected note. The map no longer declares itself modal, so assistive technology can reach the adjacent coordinator.

Existing map colours, labels, label-aware fitting and consolidated navigation are preserved. Dashboard container queries and the 3D canvas ResizeObserver already adapt to the reserved width; no replacement layout is introduced.

Regression coverage checks Dashboard and map focus, discussion without sending, usable column geometry, visible non-overlapping panels, and canvas resizing when the coordinator width changes. The main-only mapnav e2e captures the map beside the Orchestrator.

Validation: touched-file ESLint and `git diff --check` passed. `check:branch` stopped at typecheck because `diff`, `highlight.js` and `pdfjs-dist` could not be resolved in existing file-viewer modules; Git check recording also reported EPERM. Targeted Vitest could not create its Temp/ssr directory (zero tests ran). Build was blocked by esbuild directory access denial. No app launch, e2e execution, commit or PR creation was performed here, as required by the task brief.

Integration must review the diff, rebase onto current main, run the branch gate and hidden visual verification, then commit. Run the updated `test/e2e/mapnav.spec.ts` on main after integration. Verify Dashboard labels and fit at narrow widths, discussion draft/focus, and 3D canvas resizing beside the column. Do not stage `tmp/` artifacts.
