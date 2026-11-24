# ADR 0342: A work map per job

**Status:** Accepted (2026-11-23). Amends ADR 0276 (a plan is drawn on a project map), 0108 (one «Approva e parti») and
0191 (night mode, kept). The screens come with the next change.

## Context

The owner: «il lavoro dello stratega deve sempre generare una mappa», and «l'utente potrebbe anche solo voler pianificare
e poi farlo partire quando vuole, oppure ripianificarlo; anche solo un'idea potrebbe essere una mappa». A plan lived only
in its Strategist's chat, `map` on `plan_propose` was optional, and a plan drawn on a project map lost its pieces when the
chat closed before the approval. Approving and starting were one click.

## Decision

1. **One work map per Strategist job or idea**, made and kept by the app in code (`main/workmap/service.ts`): it watches
   the events main sends to the page, so no agent calls anything. A job of one part has one too. The project maps stay;
   each shows the jobs that touch it (`ProjectMapView.jobs`).
2. **The map holds the plan itself** (`shared/work-map.ts`) and is the app's record: `userData/work-maps/<id>/map.json`
   plus one history line per version. It outlives the chat and a restart. Nothing is deleted.
3. **Lifecycle:** idea → toApprove → planned → running → stopped | finished → archived. The state is always derived from
   the record (`workStateOf`), and `workActions` is the one list of what can be done now; the service refuses the rest.
4. **Approve and start are two actions.** `planDecide(…, keep)` approves and leaves the plan in phase `approved`; nothing
   starts, and no step can be delegated, until `planStart`. Both are recorded in the coordination journal as before. Such
   a chat is not pruned.
5. **Stop, resume, replan.** «Ferma» marks the plan stopped and interrupts its chats; nothing new starts until «Riprendi».
   A replan is a revision: what started goes on, nothing new starts before the user's ok, and started steps the new plan
   does not need (`remove`) stop at that ok.
6. **The owner chat.** Closed by the user, or by the app with steps open = stopped. No longer in the app = stopped (gone):
   resuming opens a new Strategist with the saved idea, answers and steps, and its plan needs the user's ok again. A chat
   that moves to another job leaves its first map behind and gets another; a chat that continues another takes its map.
7. **Finished and seen goes to the archive** by itself and can be reopened. Ideas and plans to approve stay until the user
   starts or archives them. Archiving a plan that waits answers its request without calling the Strategist back.
8. **Migration at load:** a chat with a plan gets its map once; an old closed job that was over goes straight to the
   archive, so the user does not meet it again.
9. **Who acts:** the user (`workmap:*` IPC) and the authenticated Orchestrator for him (`app_project_map` jobs, job, idea,
   approve, keep, start, stop, resume, replan, archive, reopen, seen), with the authority it already has on plans.
10. **Night mode** approves as proposed and starts, as before; a job the user stopped stays stopped.

## Consequences

- The screen and the live status build on `WorkMapInfo`, `WorkMapView` and the event `workmap:changed`.
- `plan_propose` with no `map` is fine: `map` is only for a project's map.
- A job whose chat is gone cannot be approved from the map: it is resumed first.
