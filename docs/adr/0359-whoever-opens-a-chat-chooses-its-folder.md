# ADR 0359 · Whoever opens a chat chooses its folder, in place by default

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25: «oggi la cartella di una chat viene decisa dall'app; voglio che la
scelga chi apre la chat») · Supersedes: ADR 0139 (a writer always gets an isolated worktree; a dirty parent blocks), the
worktree part of ADR 0345 and ADR 0227 (when a copy is made), the «same project» rule of a reuse (ADR 0352, #427) · Keeps: the pool, its cleanup and the staging of copies

## Decision

1. **Any existing folder**, for a new, delegated, reused or resumed chat, by the Orchestrator and the Strategist alike
   (`folderProblem`, `agents/worktrees.ts`). The opener's folder never limits it. The one refusal names the folder and why
   (missing, a file, not accessible), before anything exists.
2. **In place by default** (`NewChat.place` here): the chat works in that folder, for instance a slot already booked. **A copy
   only when asked** (place copy): an isolated worktree of that folder's repository, from the pool; that checkout must be
   clean, the parent's is not read.
3. **Uncommitted changes are told, never refused**: to the chat (in its first message and as a line) and to its opener. The app
   runs only `git status` there.
4. **Two writers in one folder are never silent**: the second one and its opener are told who is already writing there (same
   folder, around it or inside it), and to wait or stay off those files. Readers (Strategist, Scout, Sentinel, a chat
   whose role only reads), copies and chats that reported do not count. The app's own chats are what it can see: the brain's
   leases stay the agents' rule.
5. **Reuse in another folder is a linked chat** (`ChatManager.assignElsewhere`): hand-off, role, permissions, parent, plan step and
   history go on, through every check of an assignment; the old folder is left as it is. A chat with chats at work under it
   stays where they report until they end. «Riprendi» starts in the last folder used, or in the one named (`cwd`).
   A child that goes on in its own copy keeps that copy: no second one.
6. **In place there is nothing to integrate**: the commits are already in the folder; `agent_integrate_child` says so.
7. **The folder is no permission**: tool classes, ceiling, read-only, approvals and role rules are what they were.

## Consequences

- A writing child no longer pays for a worktree it did not need; the pool serves only the copies asked for.
- Two agents can work in one checkout when somebody chooses it. The warning replaces the old isolation.
