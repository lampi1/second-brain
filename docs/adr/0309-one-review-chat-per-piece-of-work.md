# ADR 0309 · One review chat per piece of work: after a fix it reviews only the delta

Date: 2026-11-14 · Status: accepted (owner, issue #387: «One independent review chat per work thread. After a fix,
the same review chat re-reviews only the fix delta. A new review chat only when the work thread changes or the user
asks for a fresh one») · Amends: ADR 0083 (a Sentinel child is continued like any other child), ADR 0091 (a review's
clean session is its first one, not one per round)

## Context

Independent reviews multiplied. In a week of the owner's use 147 chats out of 517 were reviews (28 %), and one feature
got about 15 of them in a day: a fresh review chat for every commit or fix round, each reading the whole change again.
A rule in the owner's brain («one review per job», 2026-11-08) did not hold, because the app itself pushed the other
way: `app_assign_task` and `agent_assign_task` refused a Sentinel chat («an independent Sentinel review always needs a
fresh chat»), and the role texts said to open a new chat for every review.

A reviewer is independent because it is not the chat that wrote the change. It does not stop being independent when it
looks at the fix of what it found: it is the chat that knows best what to check.

## Decision

1. **A piece of work keeps its review chat.** A piece of work is an implementation chat (all its runs) or, when the
   chats are linked to one open work thread (`app_work_create`), the thread.
2. **A second review chat is refused, naming the first** (`agents/one-review.ts`):
   - `app_create_chat` with `reviewOf`, for a Sentinel or a Judge, when a root review chat already reported on that
     work;
   - `agent_delegate` with role `sentinel`, when a Sentinel child of the caller already reported on the caller's
     current task.
   The refusal gives the call to make instead and how to open a fresh one.
3. **The same chat takes the next round.** `app_assign_task` and `agent_assign_task` accept a review chat. The app puts
   one fixed paragraph before the contract (`DELTA_REVIEW`): review only what changed since your last review and say
   which earlier findings are fixed; only once it has reported, and never for `mode: "new-task"` (a first round that
   stopped early, or a new task, reviews it all). For a root review the new run keeps `reviewOf` (the run named, else the current
   run of the chat it reviews), so its report still carries the verdict fields and `app_work_report` still accepts it.
   A review chat is never given other work: `reviewOf` must belong to work it reviewed in any of its rounds (so a chat
   the refusal names is always one the assign tool accepts), and never to a review chat, itself included.
4. **A fresh one stays possible**, with `freshReview: true`: when the user asks for a fresh reviewer, the review
   covers a part no review chat covers, or the assign tool refuses the chat named (another engine turned off, changed
   settings or permissions).
5. **What never counts as a duplicate**: reviewers started side by side that have not reported yet (several parts of
   one change reviewed at once); a review chat that could not take the assignment anyway (another folder, a role card
   changed since, closed by the user, a stopped engine of another kind); other work; another task of the same parent.

## Consequences

- Fewer chats and fewer tokens: a fix round costs a delta review in a chat that already holds the context.
- The count of review chats is no longer the count of review rounds: a round is a run of the review chat (`reviewOf`
  on each run), which is what the levels and the judge sample already read.
- A reviewer that keeps its context can also keep a wrong idea across rounds; `freshReview` is the way out, and the
  user can always ask for it.
- Not covered: reviews an agent runs with its engine's own sub-agents inside its chat (they are not chats of the app).

## Tests

`test/unit/agents/one-review.test.ts` (the lookup), `test/unit/agents/delegation.test.ts` (a parent and its Sentinels
on a real chat manager), `test/unit/appctl.test.ts` (the Orchestrator's tools).
