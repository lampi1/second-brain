# ADR 0059 · Brain domains and multi-PC sync: one person, many PCs, the work stays where it belongs

Date: 2026-10-16 · Status: accepted (owner, panel 16/10) · Source: the owner's request (16/10: work on the app from a personal PC with the
same rules, updated from either side, "sync automatico", "sarà così per tutti i prossimi utenti"); choices made in
panels on 16/10: personal PC, a different Windows user name there, two repos with one setup (no monorepo), domains and
the Codex engine (ADR 0060) in parallel · Builds on: ADR 0007 (stable vs dev), ADR 0057 (brain template in the app repo)

## Context
Today a brain is one folder on one PC: a local git repo with no remote, read by the app (`config.json` `brainRoot`)
and by the CLIs (user-level skills, agents, output styles and hooks that point into it with absolute paths). The
owner wants to work on this app from a second, personal PC with the same personal rules, and edit them from either
side. The same brain also holds employer data (production runbooks, customers, colleagues, credentials) that must
never reach a personal PC or a personal GitHub account. Every future user with a work PC and a home PC has the same
problem, so this is a product feature, not a one-off copy.

What exists: the app repo (local, no remote); the public product repo produced by the product sync, scrubbed by the
publish guard (`scan.mjs` + private deny list), which carries the app and a generic brain template but no personal
content; userData per PC (chats, engines, environments, leases, logs, keys encrypted with safeStorage).

## Decision
- **A brain is a list of domains.** Each domain is its own folder and its own git repo, with a `domain.json`:
  `{ name, scope: "everywhere" | "this-pc", remote? }`. The owner's brain becomes two domains:
  - **Personal** (`scope: everywhere`): who the user is and how to work with them, reply style, brain rules, generic
    skills, agents and hooks, the AI error/win logs, the app's own development notes. Synced to a **private** remote.
  - **Work** (`scope: this-pc`): everything about the employer (production, customers, colleagues, code rules of
    work repos, work skills and agents). Never gets a remote from the app; it stays a local repo.
  - Files that mix both today (the profile, the agents' boot file, the hub rules, the open threads, ideas, journal,
    routines, proposals) are split by section. A work domain may reference the personal one; the personal one never
    references the work one.
- **The app keeps the domains in sync**, for every domain with a remote: `git pull --rebase` at start and before a
  chat that reads the brain, commit + push after a brain change settles (debounced), one writer at a time per PC.
  A conflict stops the sync of that domain and shows a panel (keep mine / keep theirs / open both); it is never
  resolved silently. Status visible in the app (last sync, ahead/behind, blocked).
- **The publish guard runs before every push of a domain**, with the private deny list of that PC: a work term in
  the personal domain blocks the push and names file:line, never the matched value. Same fail-closed rule as the
  product sync. The deny list is per domain (owner, 2026-10-16): domain.json `denyList`, a bare file name in
  `%LOCALAPPDATA%/second-brain/publish`, default `deny-work.txt` (work facts only, so the owner's own name may live in
  the private personal domain); the public product sync keeps `deny.txt`. A missing list blocks the push.
  The allow list never comes from the domain (what is checked cannot exempt itself; review, 2026-10-16): only a private
  `allow-<domain name>.txt` beside the scanner, optional; a `.guardallow` inside a domain is ignored. Scanned: every
  commit not yet on the remote (a merge against its first parent), its message, author and committer; exactly the
  scanned commit is pushed, never a HEAD that moved meanwhile.
- **The app's own commits** carry a neutral identity (`second-brain <sync@example.com>`) and a message with
  only the time: never the user's global git identity or the PC's host name. The rebase runs in a temporary worktree
  and the branch moves with `reset --keep`: the user's files are never reset, an edit made during a sync is committed
  and synced by the next cycle.
- **No absolute paths in a domain.** Files use `{brain}` / `{domain:<name>}` placeholders or relative paths; the app
  and a setup script resolve them per PC. The owner's personal side has absolute paths today in about 30 files
  (mostly `harness/`, `.claude/`), the work side in about 180: the personal ones are rewritten during the split, the
  work ones later.
- **Setup on a new PC: one command** (`node scripts/setup-pc.mjs`, from the app repo): clones the app repo and each
  `everywhere` domain the user lists, writes the app's `config.json` (`brainRoot` + domains), runs `npm run setup`.
  Remotes are created by the user (repo rule 8): the script prints the command, it never creates a repo. It prints
  no push: the first push of a new remote is the app's, which scans the whole history before sending it. A
  `config.json` that is not valid JSON stops the setup (rewriting it would lose the user's settings).
- **The two repos stay separate** (owner's choice, 16/10): app repo and personal domain. A monorepo was rejected:
  the brain's automatic commits would move main's tip without a green `npm run check` and block "Aggiorna".

## What never leaves the PC
CLI credentials (`~/.claude/.credentials.json`, Cursor `mcp.json` with tokens, Codex `auth.json`), credential files
inside the brain (already git-ignored), API keys in userData (bound to the PC by safeStorage), the browser profile and
its logins, userData itself (chats, engines, environments, leases, logs: machine state, rebuilt on each PC; leases
are per PC by design). Each PC logs into each CLI and each environment itself.

## Rejected
- Pushing the whole brain to a private personal remote: employer data on a personal account.
- One shared folder (OneDrive or similar) instead of git: conflicts on the busy files, no history, no guard.
- Using the public product repo as the bridge: it is scrubbed by design, the personal rules would be lost.

## Consequences
- The CLIs still need the personal skills, agents and styles without the app writing `~/.claude` or `~/.codex`
  (repo rule 6): ADR 0060 loads them per launch (Claude `--plugin-dir`, Codex project files).
- Work: the split of the owner's brain (a brain chat, approved file by file), `domain.json` + sync service in
  `src/main/brain/`, the guard hook before push, `scripts/setup-pc.mjs`, a sync status in the UI, e2e with two local
  bare repos standing in for the remote.
- Risk: a work fact written in a personal file by an agent. The guard catches only listed terms; agents get a rule
  in the personal domain ("work facts go to the work domain") and the deny list grows from each block.
