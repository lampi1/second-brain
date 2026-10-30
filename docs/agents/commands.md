# Commands, in full

The compact table in `AGENTS.md` names each command; this page holds the details (moved from `AGENTS.md`, ADR 0198).

| What | Command |
|------|---------|
| Install (pinned, scripts off) | `npm run setup` = `npm ci` then `node node_modules/electron/install.js` (`.npmrc` turns `ignore-scripts` on: Electron's binary comes from the second step) then `node scripts/setup-hooks.mjs` (sets `core.hooksPath .githooks`, prints the optional guard config, never sets it) |
| Guard (ADR 0061) | The repo is public product: `.githooks/pre-commit` scans the staged content, `.githooks/pre-push` every new commit (files and their names, message, author, committer), the pushed ref names and annotated tags, both with `tools/guard/scan.mjs`, the repo's `.guardallow` and the private list in git config `guard.denyList` (set but missing → blocked); `guard.email` = the only e-mail allowed on commits. A block prints file:line + rule, never the value, and the fix. By hand: `node tools/guard/scan.mjs . [--history] [--deny <file>] --allow .guardallow`. Status: `npm run doctor`. CI runs it on the whole history (built-in rules). Never `--no-verify`; a false positive is pinned in `.guardallow` (path, rule, sha256), reviewed like code |
| Build | `npm run build` (esbuild main + preload, Vite renderer → `out/`) |
| Run | `npm start` (after a build) · `npm run dev` (dev build + run) |
| Run as an agent (always) | `SB_HIDDEN=1 npm start` / `SB_HIDDEN=1 npm run dev`: the window renders off screen, out of the taskbar, never takes focus, no Windows toasts; see it with `app_screenshot` (MCP) or `capturePage`. The e2e suite and `test:stable` set it themselves: no test may show a window or take focus (owner, 2026-10-11). The stable copy never sets it. |
| Typecheck (ADR 0198) | `npm run typecheck` = the native TypeScript 7 compiler (`typescript7`, about 4 s instead of 36 s); `npm run typecheck:ts6` = the same check with TypeScript 6, the one typescript-eslint uses (TS7 has no stable programmatic API before 7.1) |
| Light check (branches) | `npm run check:branch` = typecheck + lint of the changed files + the unit tests related to them + the guard on them (same scanner and deny list as the hooks) + the doc freshness checks (README, tool catalog, Guida coverage; ADR 0208); **no e2e** (owner, 2026-10-15: the e2e runs only on main, in `npm run check`). Green on a clean tree it records the tip as "tested (light)". What a branch needs before it is merged (ADR 0027). |
| All checks (main) | `npm run check` = typecheck + lint + unit beside the e2e (in parallel, ADR 0042). Runs only on main, after a merge, one at a time (never two heavy suites at once on one machine); `npm run promote` runs it too (ADR 0027); the "Aggiorna" button does not (ADR 0075). |
| Unit / e2e only | `npm test` · `npm run test:e2e` (Playwright drives the real Electron app; screenshots in `test-results/shots/`). The e2e runs spec files in parallel, as many workers as the machine takes now (`SB_E2E_WORKERS=n` to force), then the specs listed in `EXCLUSIVE` (`playwright.config.ts`: timings, the system clipboard) one at a time; `node scripts/e2e.mjs <specs>` for a few (ADR 0042). A new spec that times things or reads the system clipboard goes in `EXCLUSIVE`. |
| e2e baseline (ADR 0198) | Every e2e run is read against `test/e2e/known-red.json` (the tests already red on main): «nuovi rossi» fail the run, «rossi noti» are listed and pass, «nuovi verdi» are suggested for removal. Every test still runs. `node scripts/e2e.mjs --raw` keeps Playwright's own exit code; `node scripts/e2e-baseline.mjs` shows the verdict of the last run's reports (`test-results/e2e-report/*.json`), `--update [--drop-missing]` rewrites the baseline (on main, after a full run; never to hide a branch's red) |
| Live tests (spend real tokens) | `SB_LIVE=1 npx vitest run test/live` (Claude only; never Cursor from a Claude agent) |
| CLI contracts (ADR 0055) | `npm run logs -- --scope drift` (a CLI sent something unknown) · `node scripts/cli-fixtures.mjs` (dev records → `test/fixtures/cli`) · `npx vitest run test/unit/chats/cli-contract.test.ts` (replay, no tokens) |
| Update a clone from GitHub (ADR 0074, 0075) | Settings → Aggiornamenti → "Aggiorna" (the user's click: pull, build, restart, no tests; stable copies via `release.mjs promote-now`) or `npm run pull` (fast-forward main only, `npm ci` if the lockfile changed, build); the Orchestrator runs it with `app_update_code` only when the user asks |
| Is the machine ready? | `npm run doctor` (`-- --json` for agents): build, Electron, CLIs, Claude login, brain, MCP port, today's errors |
| Logs | `npm run logs -- --level warn --since 1h [--scope chats] [--chat <id>] [--run <agent run id>] [--grep x] [--json]` (`--scope renderer` = interface errors; a daily digest, `digest-YYYY-MM.jsonl`, keeps 90 days of counts, ADR 0192); files in `%APPDATA%/second-brain-dev/logs/` (dev, `--dev`) or `%APPDATA%/second-brain/logs/` (stable) |
| Why is a role's level stuck? (ADR 0131) | `npm run levels -- [<app.db \| agent-runs.json \| userData folder>] [--dev] [--json] [--demo]`: read only, zero tokens; per role the verified successes by basis, XP, and why the other runs earned none (default: the stable app's userData, its `app.db` when it holds runs, else `agent-runs.json`, ADR 0199) |
| Demo data (no CLIs, no tokens) | `npm run demo` (build + fake chats, tabs and a synthetic brain; `-- --frozen` fixed clock, `-- --hidden` for agents); bare: `SB_DEMO=1 npm start` (brain pages empty), deterministic: `SB_DEMO_FREEZE=1` |
| README screenshots | `npm run shots` (frozen demo → `docs/screenshots/*.webp`, < 300 KB each); look at them before committing. Each shot is mapped in `docs/readme-shots.json` to its test and the UI files it shows: `node scripts/readme-check.mjs [--base <sha>]` (run by `check:branch`, ADR 0208) fails a branch that changed those files without taking the shot again (opt out with a commit message line `shots: unchanged-visually [shot …]`), a README that is not English, a missing image and a page not mentioned |
| Drive the running app as an agent | MCP `http://127.0.0.1:<mcpPort>/mcp/app` (tools `app_state`, `app_chats`, `app_chat_items`, `app_pending`, `app_feed`, `app_logs`, `app_screenshot`, `app_ui` (`outline` = the screen now), `app_guide` (the app map, read live), `app_send_to_chat`, `app_close_chat`, `app_command_runs`); see ADR 0006. The Orchestrator's own mount also has `app_config` (every configuration, ADR 0149). Each Orchestrator calls its own `/mcp/app/o/<orchestratorId>/<token>` (ADR 0021), the only mount with `app_update_code` (ADR 0074); `/mcp/improve` and "Migliora l'app" are gone (ADR 0079) |

## MCP tools

Every MCP tool the app exposes, by who gets it (ADR 0208). The rows mirror `src/main/appctl/tool-catalog.ts`, which the
Orchestrator's `app_guide` reads; `test/unit/tool-catalog.test.ts` (always run by `npm run check:branch`) fails on a
registered tool missing from either, on a row for a tool that is gone and on a wrong mount. A new tool: add its catalog
row and its line here in the same change.

| Tool | Who gets it | What it does |
|------|-------------|--------------|
| `app_guide` | Orchestrator, /mcp/app | How the app works and where everything is, read live (pages, settings, actions, concepts, every tool). |
| `app_state` | Orchestrator, /mcp/app | Overview: version, brain folder, chats by state, open requests, browser tabs, today usage. |
| `app_chats` | Orchestrator, /mcp/app | The chats with their state, open questions, model, cost and last line; closed ones to reopen. |
| `app_digest` | Orchestrator, /mcp/app | The status in one call, zero tokens: what every open chat waits for, errors, news since last time. |
| `app_chat_items` | Orchestrator, /mcp/app | The last items of one chat (messages, tool rows, results), truncated; never a delegated chat. |
| `app_agent_context` | Orchestrator, /mcp/app | The frozen launch context of one work chat: memories chosen, omissions, skill hashes. |
| `app_command_runs` | Orchestrator, /mcp/app | The commands the user ran from a chat code block with «Esegui», read only. |
| `app_pending` | Orchestrator, /mcp/app | Open questions, permissions and commands waiting for the user, read only. |
| `app_resolve_question` | Orchestrator, /mcp/app | Close a work chat's open question with the answer the user gave the Orchestrator. |
| `app_feed` | Orchestrator, /mcp/app | Recent live feed events (ideas, errors, chats done or waiting). |
| `app_logs` | Orchestrator, /mcp/app | Recent structured log entries (redacted), filtered by level, scope, chat or text. |
| `app_screenshot` | Orchestrator, /mcp/app | A screenshot of the app window and of each browser tab on screen. |
| `app_ui` | Orchestrator, /mcp/app | Steer the UI without taking focus: open a page, maximize a chat, or read the screen outline. |
| `app_create_chat` | Orchestrator, /mcp/app | Open a work chat that runs one role, started with a self-contained prompt. |
| `app_assign_task` | Orchestrator, /mcp/app | Give a finished work chat a new measured task in the same role and project. |
| `app_task_events` | Orchestrator, /mcp/app | The ordered user decisions of a root task, read before assigning it again. |
| `app_send_to_chat` | Orchestrator, /mcp/app | Send a message to an active app chat, labelled as not the user's approval. |
| `app_close_chat` | Orchestrator, /mcp/app | Close a chat for the user, like ✕: its engine and the tools it started end. |
| `app_reopen_chat` | Orchestrator, /mcp/app | Reopen a closed chat with its whole history. |
| `app_handoff_chat` | Orchestrator, /mcp/app | Have a chat write its hand-off note now. |
| `app_continue_chat` | Orchestrator, /mcp/app | «Riprendi»: a new chat on the same engine and folder from the old chat's hand-off. |
| `app_set_chat_effort` | Orchestrator, /mcp/app | Pick the reasoning effort of one running chat for this conversation only. |
| `app_set_chat_work` | Orchestrator, /mcp/app | Declare, wait on or complete a chat's explicit assignment (holds the auto-close). |
| `app_routing` | Orchestrator, /mcp/app | The model routing table in force for chats without a role. |
| `app_routing_save` | Orchestrator, /mcp/app | Write a new version of the routing table for chats without a role. |
| `agent_catalog` | Orchestrator, /mcp/app, work chats | The roles with purpose, tools and skills, and the skills that fit a request. |
| `agent_learn_propose` | Orchestrator, /mcp/app, work chats | Propose a lesson for a role (its text or a skill), queued for the user. |
| `app_unblock` | Orchestrator only | Open the questions window with everything waiting for the user, after a recap he asked for. |
| `app_update_code` | Orchestrator only | Update the app's code from GitHub, only when the user asked in his own words. |
| `app_voice_diagnostics` | Orchestrator only | Content-free voice timing diagnostics (recognition, synthesis, failures). |
| `app_config` | Orchestrator only | Read and change any configuration as the user's own click would, with Undo: settings, view, role cards, MCP connectors (add, edit, test, remove, per role; never a token), profile. |
| `app_routine_export` | Orchestrator only | Export a routine package for the terminal `routine` CLI, secrets filled in the zip. |
| `app_routine_status` | Orchestrator only | Routine packages and run history, read only, when the user asks. |
| `app_routine_capabilities` | Orchestrator only | What a routine package is and can do: read before writing one. |
| `app_routine_connectors` | Orchestrator only | The MCP servers a routine step can use and how to declare one. |
| `app_routine_save` | Orchestrator only | Validate and save a routine package written from the user's need; never runs it. |
| `app_routine_packages` | Orchestrator only | The saved routine packages, secrets masked. |
| `app_work_list` | Orchestrator only | The persistent feature threads with stage, proposals and evidence. |
| `app_work_create` | Orchestrator only | Create one persistent thread for a feature, bugfix or investigation. |
| `app_work_report` | Orchestrator only | Update a thread's stage with concrete evidence. |
| `agent_lessons_waiting` | Orchestrator only | The lessons waiting for review and the ones the user rejected. |
| `brain_script_save` | Orchestrator only | Add, edit or fix a tested script in the brain's scripts/ folder. |
| `brain_script_delete` | Orchestrator only | Move a brain script to scripts/.deleted/ (restorable). |
| `brain_changelog_add` | Orchestrator only | Log a brain change made outside the script tools in the brain's changelog. |
| `app_recordings` | Orchestrator only | The call recordings and their local transcripts, or the audio files found on the PC. |
| `app_recording_import` | Orchestrator only | Import an audio or video file from the PC to be transcribed locally. |
| `app_learn` | Orchestrator only | Start an Impara lesson the user asked for, or list the lessons. |
| `agent_metrics` | Orchestrator only | Success rate, cost, time and corrections per role and version (numbers only). |
| `task_estimate` | Orchestrator only | Estimate a request: kind of work, size, role, time and cost. |
| `agent_delegate` | work chats | Delegate independent parts of the task to other roles as visible child chats. |
| `agent_children` | work chats | The chats you delegated: role, state, goal, result, open requests, cost. |
| `agent_ask_parent` | work chats | Ask the chat that delegated you, before the user. |
| `agent_answer_child` | work chats | Answer a question one of your delegated chats asked you. |
| `agent_report` | work chats | Your one final result for the chat that started you. |
| `agent_assign_task` | work chats | Continue your direct child with a separate task run. |
| `agent_task_events` | work chats | The ordered user instructions for your direct child, read before reassigning it. |
| `agent_integrate_child` | work chats | Stage one finished child's commits in a fresh detached worktree. |
| `agent_integrate_children` | work chats | Combine several finished children's commits in one staging worktree. |
| `agent_child_feedback` | work chats | Your verdict on a delegated child's run, with evidence. |
| `agent_work_decisions` | work chats | The user's recorded decisions for your current assignment. |
| `plan_propose` | work chats | Show the user your short plan for approval (Strategist). |
| `plan_update` | work chats | Move a step of your approved plan: now, done, blocked or todo. |
| `list_chats` | work chats | The user's chats you can write to with send_to_chat. |
| `send_to_chat` | work chats | Send a message to another chat of the user, never as his approval. |
| `show_ui` | work chats | Show the user a visual from the app's component catalog instead of a wall of text. |
| `memory_recall` | work chats | Read the scoped memory of your role and project as quoted data. |
| `memory_propose` | work chats | Propose a scoped memory record for the user to review. |
| `brain_search` | work chats | Search the user's brain by meaning and words. |
| `brain_scripts` | work chats | The brain's tested reusable scripts with usage. |
| `brain_script_add` | work chats | Save a new script in the brain right after it ran and worked. |
| `brain_queries` | work chats | The brain's saved queries (SQL, KQL, GraphQL…). |
| `brain_query_add` | work chats | Save a new query in the brain right after it gave the right answer. |
| `maintenance_pack` | work chats | The data pack of a «Manutenzione» research, one section at a time. |
| `maintenance_propose` | work chats | Turn one maintenance finding into a card for the user. |
| `maintenance_role_trial` | work chats | Propose one revised role text as a trial for the user to approve. |
| `environments` | browser | The browser environments with their sign-in status. |
| `tabs_list` | browser | Your tabs with url, environment and the active one. |
| `tabs_create` | browser | Open a new tab, optionally loading a url. |
| `tabs_select` | browser | Make one of your tabs the active one. |
| `tabs_close` | browser | Close one of your tabs. |
| `navigate` | browser | Load a url in the active tab, or back, forward, reload. |
| `read_page` | browser | The page as an accessibility tree with refs. |
| `find` | browser | Elements whose role, name, text or test id contains a query. |
| `get_page_text` | browser | The visible text of the page and its iframes. |
| `screenshot` | browser | See the tab as an image when text is not enough. |
| `click` | browser | A trusted mouse click on a ref or a coordinate. |
| `hover` | browser | Move the mouse over a ref or coordinate. |
| `drag` | browser | Drag from one ref or coordinate to another. |
| `type` | browser | Type text as real key presses. |
| `key` | browser | Press keys or key combinations. |
| `scroll` | browser | Mouse-wheel scroll at a ref, coordinate or the page center. |
| `fill_form` | browser | Fill several fields in one call. |
| `select_option` | browser | Choose options of a native select. |
| `wait_for` | browser | Wait for text, a selector, a url or the network to settle. |
| `handle_dialog` | browser | Answer a JavaScript dialog that blocks the page. |
| `console_messages` | browser | The console messages and uncaught errors of the tab. |
| `network_requests` | browser | The network requests of the tab, filtered. |
| `javascript` | browser | Run JavaScript only in a verified local stack's top page. |
| `handoff_to_user` | browser | Ask the user to act in your tab (login, MFA, CAPTCHA). |
| `recall` | brain hooks | The past errors (ai-errors.md) most similar to a prompt, from the local search model. |
| `detect_correction` | brain hooks | Tell by meaning whether a message corrects the agent. |
| `text_complete` | brain scripts | One prompt, one text answer on the user's Anthropic API key, for brain scripts. |
