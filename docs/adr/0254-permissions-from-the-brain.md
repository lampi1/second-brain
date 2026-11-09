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
- **The fallback**: no file = no rule, everything is free. A broken file = the app cannot know the user's rules, so it
  asks the user for everything that is not a read, and shows once per chat «Il file permissions.json del tuo brain non
  si legge». It never falls back to a list of its own.
- **auto-permit.ts** allows by default, in and out of the chat's folder, with or without a checkpoint, for every engine.
  The only other things that reach the user are the user's own role limits («Chiede conferma», «Solo piano»: all;
  «Accetta modifiche»: what is neither a read nor an edit), a plan to approve (ExitPlanMode), and a change of the
  agents' own settings or hooks (`.claude`, `.cursor`, `.codex`, `.git` with its hooks, `.githooks`, `.husky`,
  `.vscode`, `.idea`, `.mcp.json`, `.guardallow`, `.gitconfig`, `claude_desktop_config.json`, `opencode.json`,
  `core.hooksPath`): AGENTS.md rule 6, not an opinion of the app. The role gate and the read-only role check stay (the
  user's settings).
- **OpenCode** sends every command to the app's gate (`bash: ask`, which auto-permit answers at once) so the brain
  rules see it; the user's Claude deny rules still carry over as OpenCode denies (they are the user's too). The
  `.env` read ask and the destructive/outward ask list are gone; edits of the settings files above still ask.
- **The chat goes on after a refusal.** Claude and Codex read the refusal message as the tool result. Cursor and
  OpenCode get only «rejected» over ACP and may end the turn: when nothing came after the refusal, the app sends the
  rule's message after the turn («[rifiuto dell’app · regola «…»] …») and the agent continues; a turn the user stopped
  stays stopped.
- **Remote**: a permission held by an `ask-user` rule carries `heldBy { rule, why }` (set only by the app's gate; an
  engine's own field is dropped) and may be answered from the phone (Telegram) with Sì / No, once, never «always».
  On the PC it shows like every permission, in the questions window and the Orchestrator's needs lane.

## Consequences
- What the old lists refused now runs unless a brain rule holds it: a user without `permissions.json` has no fixed
  safety net besides the turn checkpoint and «Annulla l'ultimo turno» (ADR 0103).
- The matchers are the user's own regular expressions: a command written to dodge them is not caught. The policy is
  the user's statement of intent, not a sandbox.
- Claude's own permission mode and the user's Claude settings still apply before the app sees a request (AGENTS.md
  rule 6: never changed by the app).
- On OpenCode, MCP and web tools run under OpenCode's own rules and do not reach the app's gate: a brain rule on them
  (mail, Teams) applies to Claude, Codex and Cursor only. Known limit.
- Old transcripts keep their «Comando rifiutato dall'app» rows (`sys.commandDestructive` stays for them).
