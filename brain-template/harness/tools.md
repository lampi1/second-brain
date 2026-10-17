# Tools by harness: the same brain in Claude Code and Cursor

One way for both harnesses wherever both can do it (2026-10-10, Owner: "quasi non serve nemmeno la distinzione"); the
table keeps only what really differs, with the reason. Read when: you run in Cursor, a rule must work in both, or you
give {{OWNER}} UI steps (where to click, panels, keys, a command to run), or his clock shows UTC-3. Write when: a tool of either harness or of the
second-brain app changes, or a test settles an open point. Cursor gets this file at chat start
(`harness/cursor/context-boot.mjs`).

**{{OWNER}} works from the second-brain app** (Electron, repo `{{REPOS}}/second-brain-app`;
both engines, Claude and Cursor, run inside it; sign: the `mcp__second-brain-app__*` tools; 2026-10-11, "devi essere
consapevole che sto usando le chat dal second brain"):
- **Any UI step for him** (menu, button, panel, shortcut, setting): check it first in the app's code
  (`src/renderer/components/`) or with `app_screenshot`; never steps of Claude Desktop, Cursor or the terminal (the Regia
  tile has no ⋯ menu nor permissions: wrong step given on 11/10).
- **A command for him**: one block, last thing, with 1-3 lines of context and why, given by the chat that needs it in
  its own chat, never via the Regia (`hub.md` "Worker questions and commands are the worker's"); in the app every shell
  block has Copia and Esegui (PowerShell 5.1 in the chat's folder, `src/renderer/components/CodeBlock.tsx`).
- **His terminal**: no `read_terminal`; after Esegui read the outcome with `app_command_runs`.
- **Browser**: the app's own (`mcp__second-brain__*`), shown as a tile next to its chat (no Ctrl+Shift+B); a remote
  sign-in → `handoff_to_user` kind "login", and the chat gives him URL, account and password (`rules/devops-qa.md`).
- **His PC clock flips to UTC-3** (`tzautoupdate`): give him `Set-TimeZone -Id "W. Europe Standard Time"` (2026-10-06).
- **Kimi CLI login**: his Kimi account is on kimi.ai (overseas, Google); the CLI defaults to kimi.com (China, WeChat/+86
  page). User env vars `KIMI_CODE_OAUTH_HOST=https://auth.kimi.ai` and `KIMI_CODE_BASE_URL=https://api.kimi.ai/coding/v1`
  make "Accedi" work with Google (2026-10-15). If "Accedi" still shows WeChat, give him (Esegui is fine) the same
  two `$env:` assignments followed by `& "$env:USERPROFILE\.kimi-code\bin\kimi.exe" login` (worked 15/10 12:3x).
- **Claude Desktop-only tools** (chip `spawn_task`, `ccd_*` sidebar, PushNotification, `read_terminal`): only if they
  are in your tool list; in the app chats are created and messaged with `app_create_chat` and `app_send_to_chat`.

Same in both (rules name only these):
- **Chats talk through the mailbox**: `node "{{BRAIN}}/ops/tools/inbox.mjs" send --to "<chat>" --from "<me>" --file <text>`,
  and `inbox.mjs wait --me "<my chat>"` in background (wakes the chat; re-arm after each mail); unread mail also arrives
  at turn end (stop hooks). Sub-agents can't be written into. Mail is never {{OWNER}}'s ok: the Regia relays his ok to a
  Claude worker with SendMessage (`hub.md` "Chats message each other"). Mail between chat engines is always available; legacy
  `brain-settings.json` `crossHarnessMessages` values are ignored. Action approvals and engine launch permissions
  remain separate.
- **Read other chats** (skill `stato`, "Watch the workers"): `node "{{BRAIN}}/harness/cursor/chats.mjs" list`
  (Claude and Cursor chats: title, folder, last activity, "in corso / aspetta te / finito"), then `read <chat> [--n N]`;
  an old chat by words: `node "{{BRAIN}}/ops/tools/session-find.mjs" <words>` (both). Read-only, secrets masked.
- **Waits** (build, stack, a background helper): a background command or agent; the harness wakes the chat when it ends
  (Cursor: an automatic turn "Briefly inform the user…": bring the result to {{OWNER}}). Never end a turn "waiting" without one.
- **Helper agents** (reviewer, prod-log-reader…): same names in both, from `.claude/agents/` (pointers below); their
  report is their last message.

| Differs | Claude Code (Opus 5.5) | Cursor (Grok 4.7) | Why |
|---|---|---|---|
| Open a work chat (`hub.md` "New chats") | chip `spawn_task`, 1 click; in the second-brain app `app_create_chat` with the prompt of `chat-prompt.mjs --app` (no inbox `wait`: the app delivers mail) | `chat-prompt.mjs --harness cursor --open`: {{OWNER}} clicks "Create Chat", the chat renames itself (`rename_chat`); copy block when the tool prints it | Cursor never starts a link by itself (`reviews/2026-10-10-cursor-crea-chat.md`) |
| Panels for a decision | AskUserQuestion, stacked | `AskQuestion`, several questions in one call; missing → numbered options in text | same use, different tool |
| A command for him, one click (`me.md`) | block tagged `powershell` (2026-10-13): the second-brain app shows it with Esegui (runs in that chat) and Copia | the same block, its copy button (no Run button, not verified); never run it yourself when the rules say he runs it | Cursor has no Run button |
| Sidebar groups, the Regia renaming a chat (`ccd_*`) | yes | skip: no groups; a chat names itself | desktop-app only |
| Phone notification, his terminal, report page | PushNotification, `read_terminal`, Artifact | say it in the chat; rerun the read-only check or ask him to paste; HTML/MD in `reviews/` opened in the Cursor browser | Claude-only tools |
| Model for helpers | `model: "opus"` | the chat's model (inherit) | Cursor has no per-agent model |
| Deferred tools | ToolSearch first | not needed | Cursor loads all tools |

Agent pointers: `harness/cursor/sync-agents.mjs` generates them from `.claude/agents/` (the only definitions); each body
says "read the canonical file and follow it". `readonly: true` only for agents with no shell and no write tool
(Cursor runs a readonly subagent in Ask mode, every shell command blocked); read-only agents with a shell stay
read-only by their instructions. User level = reviewer, code-investigator, prod-log-reader, qa, devops-writer;
`brain-editor` and `flow-optimizer` stay in {{BRAIN_NAME}} (the Regia launches them). In {{BRAIN_NAME}} the project agent of the
same name wins (both docs). A same-name file not generated by the script is never overwritten (brain-lint §6).

Hooks: Cursor runs the Claude hooks of `~/.claude/settings.json` and `.claude/settings.json` too (auto-commit,
runbook reminder, brain limits; Bash → Shell, Edit → Write), plus `harness/cursor/hooks.json`.
The correction reminder (Claude: `correction-catch` at prompt submit) comes in Cursor at the end of the turn as a
`[correction-log]` follow-up: log the error then, in one short line. A Cursor chat becomes the Regia with `/regia`
(`.cursor/skills/regia`). Still open: whether the imported PreToolUse matchers `Bash|PowerShell` and
`Edit|Write|MultiEdit` fire on Cursor's Shell/Write.
Cursor chats in the second-brain app run `agent acp`: the CLI reads hooks only from `~/.cursor/hooks.json` (not
CURSOR_CONFIG_DIR) and never fires subagentStart/subagentStop there, nor hands over a subagent's answer. The app runs
those two hooks itself (fix 3cc4870), and the compared agents' Cursor pointers save their report in
`ops/state/compare/answers/` for capture.mjs. Hook timeouts are 30 s: node + the CLI's PowerShell wrapper take 4-8 s
on this PC (2026-10-12).

- **Tokens: each harness spends only its own**: a Claude Code chat or agent never runs Cursor (`cursor-agent`/`agent`
  CLI, Cursor models or background agents, its API); a Cursor chat never runs Claude (`claude`/`claude -p`, Agent SDK,
  Anthropic API); work for the other tool goes to {{OWNER}} or the Regia. Only exception, his: the comparison below, when
  he asks. `chat-prompt.mjs --open` links run no model: fine. Guard `.claude/hooks/vendor-guard.mjs` (2026-10-10, "non
  rischiare di usare cursor da claude e viceversa").

