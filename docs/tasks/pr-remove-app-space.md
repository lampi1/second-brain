Title: feat(chats): every worker lives in the Grindhouse

<!-- Review hand-off for remove-app-space: behavior, compatibility limits and open gaps for the human opening the PR. -->

The `app` chat partition is gone (ADR 0071). Workers created by the Orchestrator for app-code work now appear in the Grindhouse with every other chat: same grid, browser tab placement, needs lane, focus mode, maximize and autoclose. "Migliora l'app" keeps its proposal and version controls but no longer hosts a second chat list or an embedded chat tile. The canonical Orchestrator keeps its dedicated column.

Persistence: saved `space: "app"` values are dropped on load (`ChatStore`) and by `migrateOrchestrator`, with or without a coordinator. Ids, sessions, cwd, permission modes, archive state and continuation links are preserved; the legacy `appRegia` marker still feeds the Orchestrator migration. `test/unit/chat-space-migration.test.ts` covers this, including browser placement of a former app worker.

`app_create_chat` no longer advertises `space`. Old calls still work: `space: work` has no effect; `space: app` keeps the source-folder default and its fail-closed check but never creates a partition. App-code routing is now decided by `appCode`, set only when `ImproveService.inRepo` verifies the cwd (source repo or a registered worktree), so an explicit `space: work` cannot bypass it. `/mcp/app` now receives the improve deps for that check; the legacy `/mcp/improve` mount becomes `sourceOnly` and keeps its source-only creation rule. Engine, token, ownership, permission, proposal and publication checks are unchanged. `RouteRequest.appSpace` and `RoutedSpace.space` are renamed to `appCode`; the status view marks a chat as app work from `route.area === 'App'`.

ADRs 0020, 0021, 0032, 0036 and 0066 get a note that ADR 0071 supersedes their chat-space parts.

Wiring left for the integrator in shared files: none required beyond this diff. `wiring.ts` and `contract.ts` are touched (mount deps, deprecated `space` comments), so expect conflicts with other branches editing `attachAppTools` or `ChatSummary`/`NewChat`.

Known gaps:
- `ChatSpace` and the optional `space` fields stay in `contract.ts` as deprecated input; removing the type is a follow-up.
- `improveUi`/`showAppChat` in `src/renderer/store/improve.ts` and the `.imp-chat*`/`.imp-open` rules in `improve.css` and `proposals.css` look unused now; not removed here (`.imp-open` may still be used by the proposal page, check before deleting).
- `ChatManager.appMcpFor` still passes `'app'` to `appMcpUrl` for a legacy `appRegia` chat, routing it to `/mcp/improve`; intended for compatibility.
- `ImproveService` (branch → chat link) and `ProposalBridge` (reuse of a proposal's chat) now match any open chat whose cwd is the worktree, not only former app-space chats; confirm that is the wanted scope.

Integration (rebase on main 4e01cee):
- `app_resolve_question` on the legacy `/mcp/improve` mount: with the partition gone that Regia now sees every chat, and the mount skipped the per-Regia ownership check. It now closes a question only for a chat whose cwd is the source repo or a verified worktree and that no other open Orchestrator coordinates (unit test in `test/unit/appctl.test.ts`).
- Conflicts with main's i18n pass in `ChatTile.tsx` and `ImprovePage.tsx`: kept the translated labels, dropped the `space` wrapper and the removed "Agenti delle modifiche" card; its two now unused `audit.ImprovePage.*` keys are removed from both locales.
- `test/unit/improve.test.ts` (engine parity, added on main) expected `space: 'app'` on the app Regia; it now expects the App route area and no `space`.

`test/e2e/improve.spec.ts` is changed on this branch and runs first on main, in `npm run check` after the merge.

No new dependency, approval popup, updater promotion or production integration.
