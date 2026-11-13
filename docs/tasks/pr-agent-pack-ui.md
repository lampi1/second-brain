Title: feat(agents): add agent pack review and learned-rule surfaces

Adds export and import dialogs, a window-wide archive/folder drop target, content selection, anonymous-summary opt-in, guarded export fixes, full script review, permission clamps and collision choices. Imported agents show probation controls. Agent cards expose learned rules and their asynchronous approval/edit/discard queue, preset provenance and comparison with an explicit manual merge editor. Italian and English labels are included.

Protects an open editor from overwriting an agent changed by import/preset actions: the saved base revision survives navigation, stale saves stop, and the user can preserve the draft as a new agent or reload the current agent. Dialog callbacks preserve keyboard focus. A real demo-wiring regression also fixes the empty demo deny list while retaining the shipped scanner.

Validation: related unit suites cover UI/drop boundaries (2), draft revision retention (2), recovery copy (1), all shipped preset exports plus flows (19), and real demo-scanner integration (1). The demo-scanner test was observed red then green. TypeScript, changed-file ESLint and build were run; final results are recorded in the handoff. Fresh UI reviewer confirmed the stale editor, manual merge and focus fixes with no further concrete blockers.

Main gate: `test/e2e/agent-pack.spec.ts` is authored but NOT RUN, per owner instruction. It covers export/import probation, native-file drop and script opt-in, blocked export/exclude, checkbox focus and preservation of a stale editor draft, with screenshots. Hidden dev visual inspection exposed the demo guard bug; after correction, the tightened sandbox prevents Electron renderers from starting (`launch-failed`, exit 49). No successful final visual pass is claimed. Main must run the e2e and inspect its screenshots before merging/promoting.

Stack: core -> flows -> UI. The flows PR's remaining integration limits still apply: brain-pulse job registration awaits that scheduler, preset comparison currently compares instructions, and anonymous summaries refuse compacted histories. No push, PR creation or promotion performed.
