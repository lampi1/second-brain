Title: feat(agents): add run feedback, catalog launch confirmation and contextual Battito cards

<!-- Review and integration handoff for AD-54, AD-57 and ADR70places; maintained by the UI surfaces workstream. -->

Home run strips show their pinned version, Orchestrator origin and current probation state. Expanded, settled runs offer explicit success, partial and failure verdicts, with pending/error feedback. Catalog cards open a goal/folder composer and confirm successful launches with a check animation and an actionable Home toast; reduced motion disables animations.

Battito cards now appear on matching agent pages, empty search and a brain file's side panel. Search shows at most two connections/curiosities. Paths outside the brain never become file places. Cards render plain text and expose explicit save, dismiss and task actions through existing IPC. The Orchestrator layout is untouched. Copy is available in Italian and English.

## Integration (done by the integration chat)

- `run:outcome` is in `InvokeMap` and `INVOKE_CHANNELS` (`src/shared/contract.ts`); the preload derives its allow-list from `INVOKE_CHANNELS`, so no bridge change. Not exposed through MCP.
- The handler lives in `src/main/run/outcome.ts` and is registered in `src/main/index.ts`. It validates a bounded `chatId` (1-120 chars) and one of the three verdicts, rejects an unavailable `markRun`, a chat that is not a run, a starting/running/waiting or queued run, and open pending requests, then delegates to `ChatService.markRun`. The renderer cannot pass basis, author or time: `ChatManager.markRun` fixes the basis to `human`. `ChatManager.markRun` has no busy check of its own, so this handler is the guard.
- `test/unit/run-outcome-ipc.test.ts` covers malformed payloads, the unavailable service, a non-run chat and busy/pending runs.
- Fixed in integration: `FileViewer` imported `ContextPulse` statically, which pulled the app bridge (`window.sb`) and store into the brain pages; since `store/ui` imports the brain pages, five unit suites (`ui-lib`, `toast-lifecycle`, `regia-dock`, `appearance-prefs`, `role-preferences`) failed at import with `window is not defined`. The file card is now `FilePulse`, loaded with `lazy` like the other bridge readers of the brain pages.
- Rebased on origin/main 4e01cee: the catalog card keeps both the preset update badge from #43 and this PR's run composer and row index.

## Validation (integrator, on origin/main 4e01cee; per-branch checks decided by Brother on 2026-10-18)

- `npx tsc --noEmit` and `npx eslint .` clean.
- `npm run check:branch`: unit 1260 passed; the publish-guard stage reports 88 findings, all in the local untracked `tmp/` (never committed).
- Commit guard (`tools/guard/scan.mjs --commits`) clean.
- E2E spec `test/e2e/agent-surfaces.spec.ts` is written, not run: e2e runs once on main at the end. It covers three outcomes, failed writes, launch failure/success, reduced motion, contextual placements and persistent Orchestrator visibility.
- No app launched (forbidden by the brief): visual verification and screenshots remain to do on main.
