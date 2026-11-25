# ADR 0345 · A delegated chat works in any folder its parent names, also of another repository

Date: 2026-11-24 · Status: accepted (owner, issue #460: «uno stratega mi aspetto che i suoi piani a volte coinvolgano
più progetti, deve poter aprire figli ovunque, non capisco che senso ha») · Amends: ADR 0083 §3 (the child's folder),
ADR 0227 (the worktree of a writing child) · Partly superseded by: ADR 0353 (in place by default)

## Context

- `agent_delegate` refused a `cwd` outside the parent's folder and its repository's worktrees: «a child never leaves
  its parent's repository». A plan that touched a second product repository stalled.
- The way around it was a report to the Orchestrator, which opened the chat there with `app_create_chat`: a root chat
  with no parent, so it did not report to the Strategist that planned the work.
- The folder was never a permission. A chat's permissions are its tool classes and its ceiling (`tool-policy.ts`); a
  parent with a shell reaches any folder anyway, and the Orchestrator already opens chats anywhere.
- What a folder does bring is its own project configuration, which the engine loads there (a repository's
  `.claude/settings.json` with its hooks and allow rules, its sub-agents). A Strategist the user narrowed can now
  start a child under any existing folder's configuration; the Orchestrator already could. Accepted: the child's tool
  classes and ceiling are still cut to the Strategist's.

## Decision

- **Any existing folder**: a child's `cwd` is its parent's folder (the default), a folder inside it, or any other
  existing absolute folder, of any repository or of none (`delegableFolder`, `agents/worktrees.ts`). Checked by
  `agent_delegate` and again by `ChatManager.create`, the check that counts. Only a folder that does not exist is
  refused. The child stays its parent's child: it shows under it and reports to it.
- **No list to approve**: the issue suggested that the plan names its repositories and the user's approval covers
  them. Not done: the owner asked for «ovunque», a Strategist without a plan delegates too, and a list would be one more
  question for a folder that gives no permission.
- **Permissions still only go down**: the child's policy is its role's, cut to its parent's tools, ceiling and mode, as
  before. Only the Orchestrator and the Strategist delegate, as before.
- **A writing child gets its worktree in the repository of its own folder** (`DelegateWorktrees.prepare`): a slot of
  that repository's pool, on `sb/delegate-<12 hex>` at that checkout's commit. Only that checkout must be clean and
  committed. The parent's checkout is read only when the child works in the parent's own repository, where nothing
  changes; in another repository the parent's folder may have pending edits or be no repository at all. The record of
  such a child names the checkout it was branched from (`sourceRoot`); a continued child («Riprendi») keeps its
  predecessor's. A parent folder counts as «another repository» when git's rev-parse fails there with its
  fatal exit 128 (no repository, no commit yet) or the host policy refuses that repository's configuration; a git that
  timed out or crashed is an error («Git could not read the repository at …»), never a missing repository.
- **Its changes are staged in its own repository** (`agent_integrate_child`, `agent_integrate_children`): a detached
  worktree of the checkout it was branched from, never of the parent's. One repository and one checkout per call:
  children of different ones are refused together, with that reason.
- **A reuse keeps the folder** (`agent_assign_task`): the child's own folder, whatever repository it is in; refused
  only when that folder no longer exists.
- **Removed**: `gitWorktrees`, `listedWorktrees`, `withinParent` and the `worktrees` lookups of the manager and of the
  delegation tools (a `git worktree list` per folder outside the parent's): the folder is no longer compared with the
  parent's repository.

## Not done

- `app_create_chat` does not take a parent: the Orchestrator's chats stay root chats. With this change a Strategist no
  longer needs the Orchestrator to reach another repository.
- A past run of a writing child in another repository still counts as its parent's repository in the episodic examples
  (`run-examples.ts` follows the parent run of a delegate worktree).
- Untried on the owner's PC with two real repositories.

## Tests

- `test/unit/agents/delegation.test.ts`: a child in another repository starts, is its parent's child, has the same
  permissions as one in the parent's folder, reports to the parent and is reused in its folder; a missing folder is
  refused by the tool and by the manager.
- `test/unit/agents/worktree-other-repository.test.ts` (scripted git): the worktree is made in the child's repository
  whatever the state of the parent's folder; a dirty checkout there still blocks; the parent's own repository behaves
  as before; staging happens in the child's repository, one repository per call.
- `test/unit/agents/worktrees.test.ts`, `delegation-reuse.test.ts`: `delegableFolder`; a reuse in another repository.
