# Update integration evidence

Application is deliberately HARD disabled in main/update/wiring.ts. No environment or setting enables it.
The integrated restart helper SHA256 is `9106134a5a59a7ad7f1c7e0952c4bff2fad937d98ba868a4a69eb23b1beba503`.
Its supervised lifecycle and cancellation have real isolated Electron evidence, not cockpit integration evidence.

| Boundary | Owner | Current evidence / remaining proof |
| --- | --- | --- |
| Helper starts only after parent exits; native cancellation | Restart owner / Regia | PASS: tmp/restart-lifecycle-probes/probe-lxnHvi/RESULT.json and probe-jmiJIs/RESULT.json. Exact helper above. |
| Actual index before-quit, jobguard and storage flush | s integration / Regia host | OPEN: execute complete cockpit quit chain in an isolated profile; ensure cleanup does not own the supervisor. |
| Real IPC/MCP quiescence; failure after READY cancels before unlock | s integration / Regia host | OPEN integration: update-service unit cases cover ordering via DI, not live adapters. Unconfirmed cancellation must preserve hold. |
| Writer activates exact staged manifest and conditionally rolls back | s integration / Regia host | OPEN integration: protocol and service units support this; private installed release-root smoke is still required. Never overwrite a concurrent selection. |
| Target and fallback adopt nonempty drafts/layout and ACK once | s integration / Regia host | OPEN integration: checkpoint/core/agent-drafts units support this. Captured/aborted snapshots are not offered as armed recovery. |
| Installed launcher, installer, main-only release gates | Regia host | OPEN: branch does not run main-only e2e or stable promotion. No installed smoke claimed. |

These remaining cases are specific prerequisites, not a claim that the helper failed or permission to restart the active cockpit.
Do not repeat the unchanged isolated helper probes. Preserve staged assets and checkpoint backups on failure.
