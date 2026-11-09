# ADR 0254 · Permissions v3: everything is allowed, the only blocks are the user's brain rules

Date: 2026-11-09 · Status: accepted (owner, issue #352, approved scope; «risolvi tutte le issue aperte») · Supersedes:
the refusal and ask lists of ADR 0103 (its checkpoint and undo stay) and of ADR 0232 (`ASK_COMMANDS`) · Builds on:
ADR 0085 (every permission by default), ADR 0238 (plain push free), ADR 0253 (userAction)

## Context
The app answered permission requests itself (`chats/auto-permit.ts`), but kept its own opinion of danger: a fixed
deny list (download piped into a shell, DROP/TRUNCATE, disk formatting, `dd of=`, recursive deletes of roots, force
push, `git reset --hard`, `git clean -f`, `git branch -D`, stash drop, reflog expiry, `npm unpublish`) and an allow
list of "local work" that sent everything else to the user. OpenCode mirrored it (`ASK_COMMANDS`). The owner wants the
app to have no opinion: the user's brain decides. His policy (the «Safety» section of his `me.md`) is prose: three
things wait for his Esegui click (database writes, test and prod; production releases and deploys; Azure writes), local
dev DB `sqlcmd -S localhost -E -C` is free, secrets may be read but never printed, mail and Teams wait for his ok,
everything else is free.

## Decision
- **The format** (`chats/permit-policy.ts`): `<brain>/permissions.json`,
  `{ "version": 1, "rules": [{ "id", "action", "why", "tools"?, "match", "unless"? }] }`.
  - `action`: `esegui` (refused; the agent writes the exact command in a fenced block for Esegui, or a delegated chat
    reports `userAction { kind: 'command' }`), `ask-user` (sent to the user, without «always»), `never-print` (refused:
    use the secret without showing it).
  - `tools`: classes `command` (default), `edit`, `read`, `web`, `mcp`, `*`, or exact tool names.
  - `match` / `unless`: case-insensitive regular expressions on the command line (commands) or on `tool + JSON input`
    (any other tool). A rule holds a request when a `match` hits and no `unless` does; the first rule wins.
  - A file that is not exactly this format (bad JSON, an unknown field, a bad pattern, a duplicate id) is broken as a
    whole: half a policy would silently free what the missing rules held. It is read again when it changes.
  - The owner's policy in this format is `test/fixtures/brain-policy/permissions.json`. It is an example and a test
    fixture: nothing is written into a brain (clean install, ADR 0072).
- **The fallback**: no file in a brain folder that is there = no rule, everything is free. A broken file, or a brain
  folder that cannot be reached (an unplugged disk, an offline cloud folder) = the app cannot know the user's rules, so
  it asks the user for everything that is not a read, and shows once per chat «Il file permissions.json del tuo brain non
  si legge». It never falls back to a list of its own.
- **auto-permit.ts** allows by default, in and out of the chat's folder, with or without a checkpoint, for every engine.
  The only other things that reach the user are the user's own role limits («Chiede conferma», «Solo piano»: all;
  «Accetta modifiche»: what is neither a read nor an edit), a plan to approve (ExitPlanMode), and a change of the
  agents' own settings or hooks (`.claude`, `.cursor`, `.codex`, `.git` with its hooks, `.githooks`, `.husky`,
  `.vscode`, `.idea`, `.mcp.json`, `.guardallow`, `.gitconfig`, `claude_desktop_config.json`, `opencode.json`,
  `.opencode`, `.claude.json`, `core.hooksPath`, `git config --global|--system`, `claude|codex|cursor-agent|opencode
  mcp|config|plugin|hooks`, in any tool's input shape, through links, Windows `.git.` / `::$` forms, shell globs and
  quote splicing): AGENTS.md rule 6, not an opinion of the app. The role gate and the read-only role check stay (the
  user's settings).
- **What the app cannot read whole is the user's call**: a request an engine cut (`session.ts trimInput`: «… (+N)», a
  list of 200), a command with no command line, an edit that names no place, and Codex's `grantRoot` (write access under
  a folder for the rest of the session, whose later writes never come back to the gate). The rules must judge what will
  run, not a part of it.
- **No «always» where a rule could apply**: when a rule could hold requests of that tool (or the file is broken),
  whatever reaches the user for it is answered once: a remembered grant (Claude's `Bash(npm:*)`, Codex's session
  accept) would let a later request the rules hold run without coming back to the app.
- **ACP MCP calls** arrive as «Tool», named only in their title: rules match the title too and treat them as `mcp`.
- **OpenCode** sends every command to the app's gate (`bash: ask`, which auto-permit answers at once) so the brain
  rules see it; the user's Claude deny rules still carry over as OpenCode denies (they are the user's too). The
  `.env` read ask and the destructive/outward ask list are gone; edits of the settings files above still ask.
- **The chat goes on after a refusal.** Claude reads the refusal message as the tool result. Codex (`decline`) and
  Cursor and OpenCode (ACP «rejected») get no message and may end the turn: when nothing came after the refusal (by
  time, not item position), the app sends the rule's message after the turn («[rifiuto dell’app · regola «…»] …») and
  the agent continues; once per rule and run (never a loop), never after a turn the user stopped or that failed, and
  never from an older turn. For a rule on a tool (not a command) the message asks the agent to tell the user what is
  needed, since Esegui runs only commands.
- **Remote**: a permission held by an `ask-user` rule carries `heldBy { rule, why }` (set only by the app's gate; an
  engine's own field is dropped) and may be answered from the phone (Telegram) with Sì / No, once, never «always».
  On the PC it shows like every permission, in the questions window and the Orchestrator's needs lane.

## Consequences
- What the old lists refused now runs unless a brain rule holds it: a user without `permissions.json` has no fixed
  safety net besides the turn checkpoint and «Annulla l'ultimo turno» (ADR 0103).
- The matchers are the user's own regular expressions: a command written to dodge them is not caught. The policy is
  the user's statement of intent, not a sandbox.
- Claude's own permission mode and the user's Claude settings still apply before the app sees a request (AGENTS.md
  rule 6: never changed by the app). Within «allow by default», the user's own Claude `ask` and soft-deny rules (and
  OpenCode's own denies) now reach the app, which allows them unless a brain rule holds them; only Claude `deny` rules
  still hold by themselves.
- The rules' regular expressions run in the main process on at most 20 000 characters per request: a slow pattern of
  the user's own slows the app; the format does not guard against it.
- On OpenCode, MCP and web tools run under OpenCode's own rules and do not reach the app's gate: a brain rule on them
  (mail, Teams) applies to Claude, Codex and Cursor only. Known limit.
- Old transcripts keep their «Comando rifiutato dall'app» rows (`sys.commandDestructive` stays for them).
