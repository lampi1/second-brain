# ADR 0240 · Idle engines end with their tools; a chat with unsaved git work does not close by itself

Date: 2026-11-09 · Status: accepted (owner, issues #350, #354, #357, #360, «risolvi tutte le issue aperte») · Builds
on: ADR 0026 (engine housekeeping), ADR 0084 (auto-close and its waits), ADR 0134 (auto-close for every engine)

## Context
- **#360**: 34 `claude` processes (7.1 GB) stayed alive on the owner's PC. `releaseIdle` (setting «Libera il motore
  delle chat ferme dopo», 30 min) asked for a complete sub-agent census, which the CLI engines (Claude, Codex,
  Cursor) never report, so it never freed one of them.
- **#350**: when an engine was released it kept the tools it started (test runners, shells) until the chat really
  closed; idle chats kept test runners alive for hours.
- **#357**: the auto-close closed a finished chat whose repository still had uncommitted changes or unpushed commits.
- **#354**: an open chat whose engine had ended showed «chiusa» in the sidebar.

## Decision
- `releaseIdle` counts sub-agents like the auto-close (`childrenDone`): an idle engine with no sub-agent seen running,
  waiting or unknown, no background task and no delegated child still owing a result is released. A work chat that
  delivered its result (`delegation.result` or work `completed`) releases it after 5 minutes (`DELIVERED_RELEASE_MS`).
  The release is a full close: the tools of that engine and of earlier kept engines are reaped (`reapKept`). The chat
  stays open; its next message starts a fresh engine on the same session.
- `chats/worktree-hold.ts`: a finished chat in an app worktree, or with a git checkpoint (ADR 0103), whose
  repository has a remote and holds uncommitted changes (tracked or untracked) or commits on no remote branch, waits
  with the new reason `unsaved` («Lavoro non salvato»). Git runs asynchronously, one chat at a time, cached by the
  chat's last turn; a held chat is checked again every minute, and once more right before the close. A failing git
  command keeps the chat open and logs one warning. Repositories without a remote (the brain) are not checked.
- Sidebar: only an archived chat (`closedAt`) is «chiusa» and it leaves the tree (as before); an open chat whose
  engine ended reads as done for now (a root) or as owing its result (a delegated chat).

## Consequences
- Memory and CPU of finished chats go back to the PC within minutes; a dev server a chat started ends with its idle
  engine (it starts again with the chat's next turn).
- Unit tests use a fake git (rules.md §7: no real git in unit tests), not a real temporary repository as #357 asked.
