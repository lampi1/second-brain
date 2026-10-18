<!-- Review text for the map readability and navigation consolidation change. -->
# fix(ui): make brain maps readable and consolidate navigation

The dense Dashboard graph previously started as almost identical grey dots with no overview labels. Brain nodes now use semantic colours and sizes, a visible legend, eight prioritised hub labels with full names, and label-aware fit bounds. Selecting a node immediately shows its neighbourhood; selecting another node resets zoom. Labels sit above the graph with leader lines and search outward to avoid nearby dots. The graph remains bounded to 100 nodes and its existing deterministic layout is memoized.

The 3D map and Dashboard no longer reserve or show the coordinator column. Closing the map returns to the previous page; Discuss prepares an unsent draft and returns to the Grindhouse so the coordinator is visible. The brain-map tab has a compact header so the actual graph starts higher. The 3D view includes an explanation and a small legend of its existing layer colours.

## Navigation before and after

| Surface | Before | After |
| --- | --- | --- |
| Sidebar, default | Grindhouse; Lavoro: DevOps (conditional), Fatto e standup; Brain: Procedure, Regole imparate, Mappa 3D; App: Dashboard, Skill tecniche | Same groups and entries except Mappa 3D is reached from Dashboard → Mappa brain → Esplora in 3D |
| Role-specific sidebar | Role pages can also include Migliora l'app, already in the top-bar menu | Migliora l'app is excluded from role entries; one shell destination remains |
| Top bar | Brand/version; Back; Forward; Recent places; Stato: chat e PR; Search; Usage; CPU queue (conditional); CLI status; Brain sync (conditional); Next request/Da rispondere; Popup switch; Connectors; New browser; Stop all; More; Notifications; Settings | Same order except Connectors is removed; its sole editor is Settings → connectors |
| Settings gear | Theme: system/dark/light; Density: comfortable/compact; Keyboard shortcuts; All settings | Keyboard shortcuts; All settings. Theme and density are edited only inside Settings |
| More menu | Hide/show browsers; Environment credentials; Improve the app | Unchanged; these are actions/destinations absent from the rail |
| Dashboard tabs | Agents map; Brain map; Costs; Tokens/context; Errors; Tips | Same; Brain map owns its 3D exploration action |

History/search are navigation utilities, not additional destinations. Usage and CLI indicators remain live status controls. Notifications and Next request serve different queues. Stato is a chat/PR list, while Dashboard provides graphs and source-qualified metrics. The existing shortcuts/deep links to the 3D map remain supported.

## Validation

Final typecheck, touched-file ESLint, 17 related unit tests, the targeted publish guard and whitespace checks passed. A hidden isolated Electron demo passed on an intermediate revision: screenshots were inspected locally and are not committed; it confirmed zero coordinator panels in Dashboard and 3D, and eight labels at rest.

Final check results and environment limitations are recorded in `tmp/handoff-mapnav.txt`. The sandbox currently blocks Git index writes and the final rebuild; the complete branch check is not green. No e2e suite was run. Existing map entry and menu specs were updated, and `test/e2e/mapnav.spec.ts` covers the map legend, full-width map, selection and return to the coordinator; these first run on main. Fresh-context review finished with no remaining actionable findings. No dependencies, IPC or security settings changed.
