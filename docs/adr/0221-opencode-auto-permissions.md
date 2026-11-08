# 0221. OpenCode chats start with the app's permission rules

Date: 2026-11-07. Status: accepted (asked by the owner, 2026-11-07). Amends ADR [0216](0216-opencode-engine.md).

## Context

OpenCode chats asked again and again: each read of the brain, each `node -e`, each command naming a path outside the
chat's folder. Three causes. OpenCode 1.19.5's own default is `external_directory: ask` (`opencode debug agent build`
shows it) and the app passed no permission config (`engines/sessions.ts`, the `acp` case). The app answers only
`allow_once` (ADR 0216: an `always` grant is cached by OpenCode and skips later checks, force push included), so the
next similar request asks again. The app's own auto-permit (`chats/auto-permit.ts`) asks for what it cannot read as
local work: OpenCode's `external_directory` requests, paths outside the folder, `node -e`. ADR 0216 left this open.

## Decision

1. **A config at every start, never a file.** The engine entry says `permissionConfig: 'opencode'`; every OpenCode
   process the app starts gets `OPENCODE_CONFIG_CONTENT` (`brain/adapters/opencode-permission.ts`). OpenCode merges it
   after the user's global and project configs, but that alone does not make its rules win (read in the 1.19.5
   binary): the merge keeps a key the user already has in the user's place (`{"*":"ask","git *":"allow"}` keeps
   `git *` after the app's `*`), and an agent's own `permission` (`agent.build`, a `.opencode/agent/*.md`, the legacy
   `mode.build`) is applied after the shared one. So the app's rules go on the shared block and on every agent the chat
   can run (build, plan, general, explore, the hidden ones), under permission names spelled as no config spells them
   (`bAsH`; `BaSh` on `mode`, merged into the agent later): OpenCode matches names without case, and a key new to the
   user's object is appended after the user's keys, so the app's rules are the last ones on every agent. The task tool
   starts only general and explore (a user's own agent carries rules the app cannot see); the chat starts on build
   whatever the user's `default_agent`; `OPENCODE_PERMISSION` (merged after every config) is left out of the
   process environment. The user's other settings, and a `OPENCODE_CONFIG_CONTENT` of their own, are kept; on the
   permissions the app sets (bash, read, edit, external_directory, web, task) the app's rules replace the user's
   OpenCode rules: Claude's settings are the one list of what is denied. Only an admin-managed OpenCode config (its
   managed folder, an organisation's console config, merged after this one) keeps the last word. No Claude, Cursor or
   OpenCode file is written (rule 6). It holds for every new start: a chat already open gets it when its engine
   restarts (app restart, model change).
2. **The role's ceiling, never more.** A class the role lacks is `deny` (no `edit` and no `brain-write`: edits denied;
   no `web`: web tools denied); `shell-read` only, a set ceiling or a read-only run: commands `ask` (or `deny` when
   read-only), so the role gate and auto-permit still judge them. «Chiede conferma» (`default`) asks for everything
   outside the folder too. The shared block never allows edits: OpenCode's plan agent keeps its own refusal; the build
   agent's edit rules are set on `agent.build`.
3. **Claude's deny list holds on OpenCode.** The `permissions.deny` of the user's Claude settings, the brain's and the
   folder's (`.claude/settings*.json`, read only) become OpenCode `deny`: `Bash`/`PowerShell` patterns on `bash`
   (`prefix:*` read as `prefix*`), `Read`/`Edit` paths on `read`/`edit` (`~/`, `//`, `/` and relative forms; a named
   file also as any file of that name and, for reads, as any command naming it). The folder holding a protected file
   asks on `external_directory` (a search there could read it). `autoMode.soft_deny` entries with a `Tool(pattern)`
   prefix become `ask`. What OpenCode cannot express (`$defaults`, plain-language classifier rules, MCP tool names)
   is not allowed by any extra rule; its operations keep OpenCode's default or the app's gates.
4. **What the app's gates judge still asks.** Destructive, outward or opaque commands (`rm -r`, `git push`,
   `git reset --hard`, `curl`, `ssh`, a pipe into a shell, `*.sh`, `sudo`…), a shell or an interpreter given code on
   the command line (`bash -c`, `sh -c`, `pwsh -c`, `powershell -Command`, `cmd /c`, `python -c`, `env`, `xargs`: a
   deny pattern cannot see the string it runs; `node -e` only when it names `child_process`, `spawn`, `exec`, `eval(`,
   `base64` or similar, otherwise it stays normal work), edits of settings, hooks, credentials and
   `.git`, and `.env` reads stay `ask`: their request goes through `role-gate.ts` and `auto-permit.ts` as before, which
   refuse or show the panel. Answers stay once-only (ADR 0216).

## Consequences

- An Artisan on OpenCode runs `git status`, `node -e`, reads the brain and edits its folder with no panel; a command
  the user's Claude settings deny is refused by OpenCode before it runs.
- The rules OpenCode cannot express are listed (`ClaudeRules.unexpressed`); a shell script (`*.sh`) asks rather than
  being denied unless the Claude list names it.
- A shell or interpreter command with code inline reaches `auto-permit.ts`, which reads it as not local work: it shows
  the panel (no classifier judges it, as Claude's auto mode would). The safer side, by the owner's rule: a deny that
  cannot be expressed stays ask, never allow.
- OpenCode's pattern semantics (ordered, last match wins, `*` crosses folders, case-insensitive) and its config merge
  (a user's key keeps its place, agent rules after the shared ones, `mode` after `agent`) are re-implemented in the unit
  test to judge the generated config against a user config that opens everything; a change in a later OpenCode version
  is caught by the live check (`opencode debug agent build`), not by the unit test.
