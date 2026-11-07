# 0225. Delegates write up their tree, parents close their children, assignments without a handshake

Date: 2026-11-07. Status: accepted.

## Context

The cloudroom comms report (owner's brain, `tmp/cloudroom-comms.md`, proposals 4, 5 and 6, approved by the owner on
2026-11-07) found three frictions between delegated chats:

- a delegated chat could not write to the Orchestrator at all (`send_to_chat` refused), yet could write to any sibling
  or unrelated chat: corrections and warnings upwards waited for the user, while sideways noise was open;
- no `agent_*` tool closed a child: a parent with a stalled or useless child needed the Orchestrator's `app_close_chat`;
- `app_assign_task` and `agent_assign_task` required `expectedVersion` and `expectedEventSeq`, so every follow-up cost an
  extra `*_task_events` call and still failed with «Task version changed» / «Unread user instructions» (3 refusals in 4
  days in the logs).

## Decision

- **Mail up the tree** (`chats/mail.ts` `delegateRefusal`): a chat with a `parentId` may `send_to_chat` only its parent
  and the ancestors above it, and the Orchestrator only when the root of its tree was opened by the Orchestrator (the
  root's run `startedBy: 'orchestrator'`). Siblings, other trees and chats outside the app are refused. Without a
  `kind`, a delegate's mail is `info` (it waits for an idle Orchestrator's next turn). The per-minute limit, the hop
  limit and the «not written by the user» label are unchanged; results still go with `agent_report`.
- **`agent_close_child`** (`agents/delegation.ts`): an open delegating chat closes one of its own descendants (child or
  deeper) through `ChatManager.close`, which cancels that subtree (ADR 0217). The rules are those of `app_close_chat`,
  now in one module (`chats/close-rules.ts` `closeRefusal`): never an Orchestrator, refused while the chat or an open
  descendant waits for the user (an open question or permission, or a Strategist plan in phase `proposed` waiting for
  «Approva e parti»; this tightens `app_close_chat` too). Never its parent, a sibling or another tree. The caller must be
  a live role chat (`activeParent`): a parent that already reported, or whose run ended, cannot close its tree on a late
  wake. Pre-approved like the other `agent_*` tools, shown only to roles that may delegate.
- **Assignments without a handshake** (`chats/manager-work.ts` `assignTask`, `shared/user-events.ts`): `expectedVersion`
  and `expectedEventSeq` are optional on both tools. Omitted, the current task version is used; given, the version must
  match and the cursor must be a valid one (≤ latest). The user's entries in the chat after the acknowledged cursor (his
  messages, his panel answers) are returned to the assigner as `userInstructions`, readable (`unreadInstructions`: a
  panel answer recorded as JSON becomes «Answer to a question: …» / «Permission allowed|denied»), and the tool text asks
  it to account for them. They are **not** appended to the child's prompt: the child already received every one of them
  as a message or an answer, and only the assigner had not seen them; repeating them would duplicate text and let an old
  instruction override a newer assignment written after talking to the user. The only remaining refusal for timing is a
  chat that works or has queued work.

## Consequences

- The assigner loses the explicit «I read it» step; the user's entries come back in the result, so nothing it had not
  seen is silently skipped, and the child's prompt carries only the new assignment.
- A delegate can now nudge an Orchestrator directly; the default `info` class and the existing limits keep that quiet.
- Tests: `test/unit/chats/mail-delegates.test.ts`, `test/unit/agents/close-child.test.ts`,
  `test/unit/shared/user-events.test.ts`, `test/unit/agents/delegation-reuse.test.ts`, `test/unit/agents/delegation.test.ts`.
