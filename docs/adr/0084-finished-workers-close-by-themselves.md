# ADR 0084 · Finished workers close by themselves; held ones say what they wait for

Date: 2026-10-19 · Status: accepted (owner, issue #86: "When a worker chat has sent its final report to the
Orchestrator and is idle, the app marks its work as done and closes it by itself") · Builds on: the main-owned
auto-close scheduler (`chats/auto-close.ts`), the explicit work holds (`ChatSummary.work`, `app_set_chat_work`),
agent runs (A5), `shared/waiting.ts` (2026-10-16) · Amended by: ADR 0134

## Context
Every chat an agent opens starts with `work: assigned`, an explicit hold that only `app_set_chat_work completed`
released. Orchestrators rarely called it, so on 2026-10-19 three workers that had delivered their report stayed in the
Grindhouse as "assigned" with their run "running". Two of them were web research tasks: wiring also held any chat that
owned a browser tab, even an idle one. A held chat gave no hint of why it stayed.

## Decision
1. **The explicit report completes the assignment.** A worker's accepted `agent_report`, or a legacy `run-report`
   block with outcome `done` or `partial`, is completion evidence. `send_to_chat` is only mail: it may carry waiting
   hints, but never completes an assignment, regardless of its wording. At a clean turn end (`settleReport`), an `assigned` worker with a report
   newer than its assignment gets `work: completed` and its agent run ends `completed`, unless:
   - the report or its last answer waits for someone (`waitsForPeople`: the user or a decision from above, or a
     colleague: another chat, a quoted name, the Orchestrator) → `ChatSummary.waitsOn` = `user` / `colleagues`;
   - it waits for running work (`waitsForWork`, background tasks), a question or permission is open, or the report says
     `blocked`. `waiting-mail` (set by the Orchestrator) is never overridden;
   - an observed native child is active, a delegated child still owes a result, or its plan is not done. A
     non-blocked explicit report first finalizes its plan (`finishPlan`: unfinished steps become partial), so this
     plan guard holds only legacy `run-report` blocks and turns without a report.
   Mail cannot replace an accepted final report. A new explicit assignment can reuse a completed worker; an ordinary
   message does not grant that authority. The scheduler then archives it as before (delay, two-minute acknowledged warning, `closedBy: 'auto'`).
2. **`waitsOn` holds every chat**, worker or not: an answer like "Aspetto il tuo ok" never auto-closes.
3. **Held chats name their wait.** `autoCloseCandidates` returns `waitingFor` (`answer`, `permission`, `command`,
   `user`, `colleagues`, `work`, `report`, `mail`, `browser`), carried by `AutoCloseStatus.waitingFor`; the strip's
   `AutoCloseNotice` shows "In attesa di…" (amber when it waits for the user). Main names it; the renderer never decides.
4. **An open tab alone no longer holds a chat**: only a hand-off, a JavaScript dialog or a page still loading (the
   archive closes its tabs; the renderer still holds a tab the user is looking at).
5. Settings → "Archivia lavori conclusi dopo" also offers 2 minutes (the default); 0 = never.

## Consequences
- Agent metrics and feedback see reported workers as completed runs, without the Orchestrator's extra call.
- Waiting labels remain heuristic; completion requires an explicit report and host-observed work guards. This rule
  is engine-independent. Manager tests use fake sessions, not live engine verification.
  Tests: `test/unit/waiting.test.ts`, `test/unit/chats/auto-close-report.test.ts`.
