# 0139 — Isolate delegated writers and stage integration

Writing child chats must not race with their parent or siblings in a shared checkout. The host creates a unique Git
worktree after ChatManager computes the child's effective policy. `edit`, unrestricted `shell`, `brain-write`, external
`mcp` and unknown policies are treated as potentially writing; `read` and `shell-read` alone can share a folder. Role
names and agent instructions never authorize or bypass isolation. Production wiring always installs this preparation.

The parent and requested source must be clean committed checkouts of the same verified repository. Dirty/untracked
changes, an unborn/non-Git source, a foreign repository or failed checkout block launch explicitly; there is no shared
writer fallback and no automatic stash or discard. Subfolder projects keep their relative directory. Preparation pins
the source commit, verifies the new worktree and rechecks source/parent state before returning. ChatManager rechecks
the parent assignment, binds the allocation to the actual child ID, then starts the engine. App-owned provenance is
persisted in userData separately from mutable role definitions and loaded strictly; no cleanup deletes user work.
A host-authorized manual continuation uses the prior child ID to verify its allocation and retains the original delta
base in the successor worktree, so committed predecessor work is included in later integration.

`agent_integrate_child` accepts only a direct child ID; `agent_integrate_children` accepts 1–10 distinct direct child IDs.
Each requires the active parent's current write policy. The host checks its recorded ownership, repository identity, branch, committed baseline and completed child before reading a
bounded binary delta of pinned commits. It applies the deltas in stable child-ID order in one fresh detached worktree
based on the parent's current clean HEAD. Conflicts stay there and are reported with the staging path. No parent index, checkout, branch, production
branch or remote is changed; hooks, configured filesystem monitors, clean/smudge/process filters and repository scripts
are not executed by this route. A configured custom merge driver blocks host isolation/integration instead of executing
its command. Any Git include/includeIf directive also blocks the route, including an inactive branch condition that
could otherwise activate after worktree creation. Partial/promisor configuration also blocks the route; host Git
disables lazy fetching and permits no transport, including explicitly enabled external protocols. Read-only host commands disable optional index refresh writes.

A staged result includes the pinned parent/child commits, applied child IDs, resulting union index tree and the host's `git diff --cached --check`
exit receipt. That receipt is whitespace-only: `checksRequired` remains true, and it never becomes a semantic pass or a
run receipt in `agents/receipts.ts`. The parent can ask the Orchestrator to open a normal permitted check/review chat in
the returned staging folder; repository checks run under that chat's normal approval policy and attach to its run.
Integration creates no merge commit and grants no merge/push permission. A later explicit merge remains outside this
staging route. Persisted ownership survives restart; missing/corrupt provenance never falls back to trusting chat text.

Validation uses real temporary Git repositories and unit tests for concurrent writers, clean/foreign-source refusal,
persistence and chat binding, unchanged parent files/index/branch, hook suppression, and conflict containment. No e2e
runs are part of branch validation.
