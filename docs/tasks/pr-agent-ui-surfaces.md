Title: feat(agents): add run feedback, catalog launch confirmation and contextual Battito cards

<!-- Review and integration handoff for AD-54, AD-57 and ADR70places; maintained by the UI surfaces workstream. -->

Home run strips show their pinned version, Orchestrator origin and current probation state. Expanded, settled runs offer explicit success, partial and failure verdicts, with pending/error feedback. Catalog cards open a goal/folder composer and confirm successful launches with a check animation and an actionable Home toast; reduced motion disables animations.

Battito cards now appear on matching agent pages, empty search and a brain file's side panel. Search shows at most two connections/curiosities. Paths outside the brain never become file places. Cards render plain text and expose explicit save, dismiss and task actions through existing IPC. The Orchestrator layout is untouched. Copy is available in Italian and English.

## Required integration before merge

AGENTS.md reserves shared contract/bootstrap files to the integration chat. These edits are requested, not implemented by this workstream:

- In `src/shared/contract.ts`, add to `InvokeMap`: `'run:outcome': [{ chatId: string; verdict: 'success' | 'partial' | 'fail' }, ChatSummary];` and add `'run:outcome'` to `INVOKE_CHANNELS`.
- `src/preload/index.ts` already derives its allow-list from `INVOKE_CHANNELS`; no additional bridge API is needed.
- In `src/main/index.ts`, register the handler. Validate nonempty bounded `chatId` and one of the three verdicts; reject unavailable `s.chats.markRun`; reject running/starting/waiting/queued chats or open pending requests. Delegate to `s.chats.markRun(chatId, verdict)`. Do not accept basis/by/at from the renderer. Do not expose this operation through MCP.
- `ChatService.markRun` is declared here. Existing `ChatManager.markRun` owns persistence and emits `chat:updated`, fixes basis to `human`, ends an open run and evaluates probation. Demo implementation and a settled demo seed are included.
- Add handler contract/security tests for malformed payloads, unavailable service and busy/pending runs. Existing manager lifecycle coverage remains authoritative for persisted outcomes.

## Validation

- `git diff --check`: passed.
- Targeted Vitest attempt (run lifecycle, catalog overview, contextual selectors): blocked before any test ran by `EPERM` creating the SSR cache in the system Temp directory outside the sandbox. No sandbox workaround attempted.
- Typecheck attempted: missing existing dependencies `diff`, `highlight.js`, `pdfjs-dist`; also the pending `run:outcome` contract. A local narrowing error found in ContextPulse was fixed.
- `npm.cmd run check:branch`: failed at typecheck for the same missing dependencies and pending contract. Its test marker write is also blocked by sandbox permissions on the worktree git metadata. No lint/unit/guard stage reached.
- E2E spec `test/e2e/agent-surfaces.spec.ts` is written, not run. It covers three outcomes, failed writes, launch failure/success, reduced motion, contextual placements and persistent Orchestrator visibility. Run only on main after merge, as required by AGENTS.md.
- No app launched: explicitly forbidden by the task brief. Visual verification and screenshots remain required.

## Review and release

Fresh-context review requested from the visible integration chat. Not ready to merge until shared IPC integration, review and verification succeed. Staging was attempted once and failed creating the worktree `index.lock` (Permission denied); nothing was staged or committed. Commit/publish remain with the integration/human workflow.
