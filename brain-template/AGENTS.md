# {{BRAIN_NAME}}: {{OWNER}}'s personal operating system

Canonical context for ANY agent (Claude, Cursor, Codex, Copilot...). Every chat starts here, or reaches here through
the `{{BRAIN_NAME}}` skill. Tool-specific files (`CLAUDE.md`, `.claude/`) only point here: never put rules only there.
Durable knowledge lives in this folder, **not** in agent-private memory, so every agent sees the same brain.
**This file is a short index (always loaded): everything else is read only when the table below says so.**

## Hard rules (always, in every area)

1. **Safety**: `me.md` "Safety" (the only copy). Production and shared systems: the agent proposes, {{OWNER}} runs.
2. **No secrets in files.** Credentials live outside this folder (e.g. `~/.{{BRAIN_NAME}}.env`); agents never read them.
3. **Commits**: product repos → {{OWNER}} decides. **This folder** (local git, no remote) is **auto-committed** by the
   Claude Stop hook `auto-commit.mjs`; other agents run `git -C {{BRAIN}} add -A && git -C {{BRAIN}} commit -m "<area>: <what>"`.
4. Never search the home folder recursively: it walks cloud folders and downloads cloud-only files.
5. **Text with backslashes (paths, regex, \n in code) goes into files via Write/Edit**, never via shell heredocs.
6. **Code changes**: `reviewer` on the diff before "done" or a commit (`code.md`).
7. **Chats get abandoned without warning**: keep your thread's `now.md` line current (state + next step) whenever it
   changes, with `node {{BRAIN}}/ops/tools/mem.mjs now me --label "<chat>" --text "<where · state · next>"`.
8. **Every AI error gets logged at once**: when {{OWNER}} corrects you, a reviewer proves a claim wrong, or you find
   your own mistake, append one line to `ai-errors.md` with `mem.mjs error` (format there).

## Read on demand

| When | Read (absolute: `{{BRAIN_WIN}}\...`) |
|------|------|
| Before reading or writing any memory file; unsure where something lives | `map.md` |
| You are the hub "Regia", or you coordinate other chats/agents | `hub.md` |
| Code work (fix, implement, review, PR) | `code.md` |
| Production, a customer, an incident | `ops/AGENTS.md`, then `ops/runbook/` |
| Changing a rule, a skill, an agent or a test | `brain-rules.md` |
| "Riprendiamo", "a che punto eravamo" | `now.md` |

## Routing by intent

| {{OWNER}} wants | Do |
|--------------|----|
| "Cosa devo fare oggi?" | `now.md`, due `ideas.md`, yesterday's `journal/`; propose the top 3 |
| "Segna nel diario"; "cosa ho fatto oggi" | `journal/` (`journal/index.md`) |
| "D'ora in poi fai X", "non fare più Y" | Agent `brain-editor` with the exact words (`brain-rules.md`) |
| An idea, a what-if, "segnatelo" | `ideas.md` (`mem.mjs idea`) |
| A recurring chore | `routines.md` |
| Anything else | Answer; then check `map.md` for what to save |
