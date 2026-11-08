# 0227. Reused worktree pool per repository, and warm engines in the most used folders

Date: 2026-11-07. Status: proposed (waiting for the owner's review).

## Context

Proposals 3 and 5 of «Velocità alla cloudroom». Every delegated chat that writes gets an isolated worktree
(`DelegateWorktrees.prepare`, ADR 0083). Before this change each one was a new `git worktree add` on a new
`sb/delegate-<uuid>` branch, never reused, never removed. Measured on the owner's PC on 2026-11-07 (git spawns under
the usual load of several agents, ms):

| Step of the old prepare | ms |
|------|----|
| `config --get-regexp` (filter policy, once per git call) | 5011 |
| `rev-parse` | 5983 |
| `status --untracked-files=all` | 9267 |
| `diff-index` | 10874 |
| `worktree add` (Oris.Core.Web size checkout) | 72471 |
| `status` of the new worktree | 5963 |

About 29 git spawns per prepare, the filter-policy read repeated before each one; the 30 s timeout on `worktree add`
failed the delegation on a large repository under load.

Worktrees left behind (`git worktree list` in the repositories the app knows, never a recursive search of the home):

| Repository | Worktrees besides the main one | The app's | Disk |
|------|----|----|----|
| second-brain-app | 279 | 89 | measured in the report |
| Oris.Core.Web | 59 | 11 | 58.4 GB |
| brain-v2 | 72 | 72 | 5.19 GB |

The warm engine pool (ADR of 2026-10-13, `chats/warm.ts`) kept engines in one folder only: a chat in a second folder
closed the first folder's engines, so switching between two repositories always started cold. A delegated child never
adopted a warm engine: its worktree did not exist when the engine would have started.

## Decision

**Worktree pool** (`src/main/agents/worktree-pool.ts`), per repository (any git repository, `.NET` ones of Air too):

- A slot is an app worktree marked by a `second-brain-owned` file in its private gitdir (never in the work tree, so
  nothing shows in `git status`). Only marked slots, or legacy `.second-brain-delegate-*` / `.second-brain-integration-*`
  folders on an app branch, are ever reused or removed.
- `take`: the most recently released free slot of the repository is reset with `git checkout -B sb/delegate-<12 hex>
  <parent HEAD>` and `git clean -fd`, **never `-x`** (ignored build outputs such as `bin/` and `obj/` stay, so the next
  build is incremental). A slot is reused only when it is clean, has no commit outside the remotes, the base branch
  and the parent's HEAD, has no open chat and no lease. Otherwise a new worktree is added (timeout 10 min).
- Branch names stay guard-safe: 12 hex digits, no GUID (`tools/guard` rejects GUID-shaped strings).
- One `GitSession` per prepare caches the filter policy per folder: a reused slot costs at most 8 git spawns (with its policy probe) instead of 29.
- Base branch: `origin/HEAD`, else `master`, else `main` (one `for-each-ref`, cached).
- A reused slot blocks reopening the earlier child that ran there (its allocation is gone): `ChatManager.unarchive`
  asks `reopenBlocked` first.

**Cleanup**, «Pulisci ora» in Impostazioni → Avanzate (its own block, anchor `#st-worktree-pool`, a separate component
from the other blocks of that section), then automatic 5 minutes after start and every 6 hours:

- The automatic cleanup never runs before the user's first «Pulisci ora» (the user's decision, 2026-11-08: never
  silently at first start): until then the timer only measures. The pool file keeps `manualAt`; the report's `auto`
  tells the page which case it is.
- Only in the repositories of known chats (their `cwd`); `git worktree list --porcelain` in each.
- Removed: the app's clean orphans over the limits (per repository, in total, disk cap; least recently used first),
  with `git worktree remove` without `--force`, then their app branch if it holds nothing of its own; then
  `git worktree prune` and the deletion of `sb/` branches already merged into the base.
- Under the repository's lock, just before removing, the worktree is checked again (clean, still at the scanned
  commit, nothing of its own, not taken since the scan); its branch goes with `git update-ref -d <ref> <scanned sha>`,
  so a branch moved meanwhile stays. Only untracked links (a `node_modules` junction) are unlinked first.
- **Never removed, only reported**: a worktree with uncommitted changes, or with commits on no remote, not on the
  base branch and on no local branch outside `sb/`; one in use by a chat or a warm engine; one touched in the last 30
  minutes.
- A «Pulisci ora» while a scan runs waits for it and then cleans; every cleanup reports what it removed, 0 too.
- Limits are settings, protected from agents: `worktreePoolPerRepo` (default 6), `worktreePoolTotal` (20),
  `worktreeDiskCapGb` (40). Impostazioni shows them, the space of each repository and the reported worktrees.

**Warm pool in the most used folders** (`chats/warm.ts`): each new chat adds 1 to its folder's score and fades the
others by 0.9; engines wait in the top `MAX_FOLDERS` (3) folders, up to 4 in total; a full pool closes the least used
folder's engine first. A delegated child's engine waits in the next free slot of its repository's pool
(`WorktreePool.nextCwd`), so the next child adopts it.

## Engines

- Worktree pool: every engine (Claude, Codex, Cursor, OpenCode). `ChatManager` calls `prepareDelegation` for any
  delegated child before its engine starts; nothing in it depends on the engine.
- Warm engines: Claude only. Cursor and OpenCode (ACP) and Codex have `caps.warm` false in `engines/registry.ts` (the
  warm pool adopts a Claude process started with its session id and MCP endpoint chosen ahead; the others have no such
  start); unchanged by this ADR.

## Consequences

- A delegation in a repository with a free slot skips `worktree add`: the measured prepare goes from tens of seconds
  to a few git spawns. Build outputs stay warm between children.
- The first cleanup on an existing PC removes the app's old clean worktrees (tens of GB on Oris.Core.Web). Work is
  never lost: anything with changes or unpushed commits stays and is listed.
- A child closed long ago whose slot was reused cannot be reopened; its branch stays if it had commits.
