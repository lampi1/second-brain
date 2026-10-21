# ADR 0103 · Safety without popups: a checkpoint before every turn

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «di default hanno tutti i permessi perché se no i popup compaiono
ogni 2 secondi») · Builds on: ADR 0085

## Context
Every role has every permission by default (ADR 0085), but nothing could put a chat's files back after a bad turn:
no checkpoint, no undo, and the guards outside the stable copy only cover killing processes. A popup per command is
what the owner refused; the safety net has to work after the fact.

## Decision
- Before each turn of a work chat whose folder is in a git work tree, `chats/checkpoints.ts` records the files as they
  are (tracked and untracked, `.gitignore` respected) in a commit object under `refs/sb/checkpoints/<chat>/<time>`,
  through a copy of the index: the user's index, HEAD and branches are never touched. The last 30 per chat are kept.
- «Annulla l'ultimo turno» (the chat's menu, IPC `chat:undoTurn`) restores the files changed or deleted since and
  removes the files created since; ignored files (builds, dependencies) stay. The chat learns it with its next message.
  Never while the chat works.
- Not the Orchestrator (it does not edit work files). Off in the test suite (`SB_TEST`).

## Consequences
- A turn costs a `git add -A` on a temporary index before it starts (fast with the index's stat cache; a failure only
  means that turn cannot be undone, never a held message).
- Checkpoints live in the app's memory for the session; their refs stay in the repository until pruned.
- Proposed and held for the owner's explicit confirmation: the app answering permission requests itself (allow normal
  work, refuse destructive commands with their reason, ask only for what leaves the machine). Confirmed by the owner on
  2026-10-21 (issue #127, «Entrambe, PR separata»); see "The app answers permission requests" below.

## After the review (2026-10-20)
- When a turn ends its files are recorded again; the undo puts back only the paths that turn changed, and leaves a path
  changed again since (the user's or another chat's edit) as it is. Nested repositories are skipped; names are literal.
- Before it touches a file, the undo records the files as they are under `refs/sb/undo/<chat>/<time>` (the last 10).
- It asks for confirmation, and is refused while chats this one started still work or another chat works in the same
  repository.

## The app answers permission requests (owner, 2026-10-21)
`chats/auto-permit.ts` answers a work chat's permission request before it reaches the user (ChatManager's
`sink.pending`, after the role gate), on every engine (Claude, Cursor, Codex):
- **Allowed without a popup**: reads inside the chat's folder (links resolved; outside it, the home or a parent: asked),
  web searches, todo lists; reading commands (`tool-policy.ts readOnlyCommand`) with no path outside the folder; while
  the turn has a checkpoint (so «Annulla l'ultimo turno» can put the files back), edits of files inside the folder and
  local commands (`npm test`, `git commit`, `mkdir`, `rm` of a file in the folder).
- **Refused, with the reason shown in the chat** (`sys.commandDestructive`) and told to the model: recursive deletes of
  the folder, a parent, the home, a drive or `.git`; force pushes and remote deletes; `git reset --hard`, `git clean -f`,
  `git branch -D`, `git stash drop|clear`, history pruning; disk formatting, `dd of=`, shutdown; a download piped into a
  shell; `DROP`/`TRUNCATE` of database objects; `npm unpublish`. Wrappers (`sudo`, `env`, `xargs` …) and quoting or
  escapes do not hide them. Refused even for a narrowed role and without a checkpoint.
- **Still asked**: what leaves the machine (`git push`, `gh`, `az`, cloud CLIs, SSH, `curl`/`wget`, database clients,
  publishing, mail, containers), `git config`/`git remote` changes, files of settings, hooks, credentials and the
  repository (`.git`, `.claude`, `.cursor`, `.codex`, `.githooks`, `.env*`, `.npmrc` …), commands that run text or
  code (`bash -c`, `eval`, `node -e`, substitutions, variables), killing processes, the plan (ExitPlanMode), MCP tools,
  web fetches, Codex's session-wide write grant, and anything outside the folder or not read with confidence.
- A role the user set to «Chiede conferma» or «Solo piano» on its card is always asked (only the refusals apply);
  «Accetta modifiche» lets reads and edits through, commands only when they read.
- It only answers requests the engine asks: a chat in `auto` or `bypassPermissions` asks nothing, as before. Off in the
  test suite in practice (no checkpoints under `SB_TEST`, so only reads and refusals apply).
