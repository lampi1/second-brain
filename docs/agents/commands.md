# Commands, in full

The compact table in `AGENTS.md` names each command; this page holds the details (moved from `AGENTS.md`, ADR 0198).

`check:quick` serializes worktrees using `check-quick.lock.json` in Git's common directory. The file records the
owner PID; a Windows named pipe (Linux: abstract socket), derived from that path, is the actual mutex, automatically
released by the kernel on process death. A stale owner file is overwritten only after acquiring the mutex, never
deleted based on PID alone. A waiter prints the shared path and waits up to `SB_CHECK_LOCK_WAIT_MS` (default 600000).
This is a queue timeout, separate from the caller's execution timeout: allow 600 seconds for an uncontended gate,
and additional queue time if waiting. The gate does not kill another check's children. macOS is not supported by
this lock backend. Older worktrees without this lock and other test commands do not participate.
The lock serializes only live checks. It does not fix the killed runs: their cause is the caller's 200 s tool timeout
(see the "Light check" row below), not concurrency, and the lock can add up to 600 s of queue on top. On Windows, when
the parent is killed, the `spawnSync` children (cmd → npm → tsc/vitest) stay alive as orphans outside the lock, so a
next check can run beside them. `SB_CHECK_LOCK_WAIT_MS=''` counts as 0: the wait times out at once.

| What | Command |
|------|---------|
| Install (pinned, scripts off) | `npm run setup` = `npm ci` then `node node_modules/electron/install.js` (`.npmrc` turns `ignore-scripts` on: Electron's binary comes from the second step) then `node scripts/setup-hooks.mjs` (sets `core.hooksPath .githooks`, prints the optional guard config, never sets it) |
| Guard (ADR 0061) | The repo is public product: `.githooks/pre-commit` scans the staged content, `.githooks/pre-push` every new commit (files and their names, message, author, committer), the pushed ref names and annotated tags, both with `tools/guard/scan.mjs`, the repo's `.guardallow` and the private list in git config `guard.denyList` (set but missing → blocked); `guard.email` = the only e-mail allowed on commits. A block prints file:line + rule, never the value, and the fix. By hand: `node tools/guard/scan.mjs . [--history] [--deny <file>] --allow .guardallow`. Status: `npm run doctor`. CI runs it on the checkout and on every commit that leads to it (built-in rules; ADR 0314). Never `--no-verify`; a false positive is pinned in `.guardallow` (path, rule, sha256), reviewed like code |
| Build | `npm run build` (esbuild main + preload, Vite renderer → `out/`) |
| Run | `npm start` (after a build) · `npm run dev` (dev build + run) |
| Run as an agent (always) | `SB_HIDDEN=1 npm start` / `SB_HIDDEN=1 npm run dev`: the window renders off screen, out of the taskbar, never takes focus, no Windows toasts; see it with `app_screenshot` (MCP) or `capturePage`. The e2e suite and `test:stable` set it themselves: no test may show a window or take focus (owner, 2026-10-11). The stable copy never sets it. |
| Typecheck (ADR 0198) | `npm run typecheck` = the native TypeScript 7 compiler (`typescript7`, about 4 s instead of 36 s); `npm run typecheck:ts6` = the same check with TypeScript 6, the one typescript-eslint uses (TS7 has no stable programmatic API before 7.1) |
| Quick check (a branch's gate) | `npm run check:quick` = typecheck + lint of the changed files + only the test files that reach a changed file directly: import it (static, dynamic, `vi.mock`, or through the `export … from` of any imported module, chains included), name it in a code string (`scripts/logs.mjs`, `path.join(ROOT, 'scripts', 'logs.mjs')`, an import in a `node -e` program), reach it through a test helper or fixture under `test/unit` / `test/fixtures`, commit through the git hook that runs it, load it implicitly (`new ESLint()` → `eslint.config.js`), are named like it (`foo.ts` → `foo.test.ts`; covers only from one of its folders) or were changed; deleted and renamed paths included, no transitive graph + the doc freshness tests and README check when `src/`, `docs/` or the README changed. Records nothing. Changed sources no test reaches still exit 0 but print "green WITHOUT tests: <files> (typecheck and lint only)". With a clean Sentinel and the guard it is what a branch needs before the merge, no e2e (owner, 2026-11-08; `docs/agents/rules.md` §7). |
| Light check (optional) | `npm run check:branch` = typecheck + lint of the changed files + the unit tests related to them (`vitest --changed`) + the guard on them (same scanner and deny list as the hooks) + the doc freshness checks (README, tool catalog; ADR 0208); **no e2e**. Branches only (it refuses to run on main). Green on a clean tree it records the tip as "tested (light)". No longer required before a merge (owner, 2026-11-08: `check:quick` is the gate, no e2e). A branch touching `src/main/chats/manager*.ts` pulls in ~64 test files and takes 4-6 minutes: run it in the background or with a tool timeout of at least 600 s, output to a file, and read the exit code (a 200 s tool timeout killed the shell wrapper with "ChildProcess.kill" and no exit code, 2026-10-31). A unit test red only under CPU load is not rerun: it is removed (owner, 2026-11-08; `docs/agents/rules.md` §7). |
| All checks (main) | `npm run check` = typecheck + lint + unit beside the e2e (in parallel, ADR 0042). Runs only on main; after a batch of merges only its non-e2e parts run, once (owner, 2026-11-08): `npm run check -- --no-e2e` (typecheck, lint, every unit test, publish guard, in a row; no build, no display; it records nothing), one at a time (never two heavy suites at once on one machine); `npm run promote` runs it too (ADR 0027); the "Aggiorna" button does not (ADR 0075). |
| Unit / e2e only | `npm test` · `npm run test:e2e` (Playwright drives the real Electron app; screenshots in `test-results/shots/`). The e2e runs spec files in parallel, as many workers as the machine takes now (`SB_E2E_WORKERS=n` to force), then the specs listed in `EXCLUSIVE` (`playwright.config.ts`: timings, the system clipboard) one at a time; `node scripts/e2e.mjs <specs>` for a few (ADR 0042). A new spec that times things or reads the system clipboard goes in `EXCLUSIVE`. |
| Boot smoke (ADR 0314) | `node scripts/build.mjs --dev && node scripts/boot-smoke.mjs` (Linux without a display: under `xvfb-run`, with `SB_E2E_ELECTRON_ARGS="--use-angle=swiftshader --enable-unsafe-swiftshader"`): starts the built app once in its frozen demo, hidden, in an isolated profile; opens every sidebar page, fails on any renderer error, takes one picture and quits; report and picture in `test-results/boot-smoke/`. CI runs it on Windows, Linux and macOS on every pull request and every push to main: the proof that the app starts on each OS. Not a test of features. |
| e2e baseline (ADR 0198) | Every e2e run is read against `test/e2e/known-red.json` (the tests already red on main): «nuovi rossi» fail the run, «rossi noti» are listed and pass, «nuovi verdi» are suggested for removal. Every test still runs. `node scripts/e2e.mjs --raw` keeps Playwright's own exit code; `node scripts/e2e-baseline.mjs` shows the verdict of the last run's reports (`test-results/e2e-report/*.json`), `--update [--drop-missing]` rewrites the baseline (on main, after a full run; never to hide a branch's red) |
| Live tests (spend real tokens) | `SB_LIVE=1 npx vitest run test/live` (Claude only; never Cursor from a Claude agent) |
| CLI contracts (ADR 0055) | `npm run logs -- --scope drift` (a CLI sent something unknown) · `node scripts/cli-fixtures.mjs` (dev records → `test/fixtures/cli`) · `npx vitest run test/unit/chats/cli-contract.test.ts` (replay, no tokens) |
| Wire record / replay (ADR 0221) | `SB_WIRE_RECORD_DIR=<folder>` (opt-in, redacted NDJSON of every engine wire; `SB_WIRE_RECORD_PROMPTS=1` keeps the prompts) · `npx vitest run test/unit/chats/wire-replay.test.ts` (adapters replayed, no tokens) · `SB_WIRE_FIXTURES_UPDATE=1` on it (re-record `test/fixtures/wire` from the fakes) |
| Turn-start watchdog (ADR 0221) | `SB_TURN_WATCHDOG_MS` (default 120000): a sent turn with no first event → a warning in the chat and `npm run logs -- --level warn` «turn start watchdog»; `timing: turn start` logs `firstEventMs` |
| Update a clone from GitHub (ADR 0074, 0075) | Settings → Aggiornamenti → "Aggiorna" (the user's click: pull, build, restart, no tests; stable copies via `release.mjs promote-now`) or `npm run pull` (fast-forward main only, `npm ci` if the lockfile changed, build); the Orchestrator runs it with `app_update_code` only when the user asks |
| Is the machine ready? | `npm run doctor` (`-- --json` for agents): build, Electron, CLIs, Claude login, brain, MCP port, today's errors |
| Logs | `npm run logs -- --level warn --since 1h [--scope chats] [--chat <id>] [--run <agent run id>] [--grep x] [--json]` (`--scope renderer` = interface errors; a daily digest, `digest-YYYY-MM.jsonl`, keeps 90 days of counts, ADR 0192); files in `%APPDATA%/second-brain-dev/logs/` (dev, `--dev`) or `%APPDATA%/second-brain/logs/` (stable) |
| Why is a role's level stuck? (ADR 0131) | `npm run levels -- [<app.db \| agent-runs.json \| userData folder>] [--dev] [--json] [--demo]`: read only, zero tokens; per role the verified successes by basis, XP, and why the other runs earned none (default: the stable app's userData, its `app.db` when it holds runs, else `agent-runs.json`, ADR 0199) |
| Demo data (no CLIs, no tokens) | `npm run demo` (build + fake chats, tabs and a synthetic brain; `-- --frozen` fixed clock, `-- --hidden` for agents); bare: `SB_DEMO=1 npm start` (brain pages empty), deterministic: `SB_DEMO_FREEZE=1` |
| README screenshots | `npm run shots` (frozen demo → `docs/screenshots/*.webp`, < 300 KB each); look at them before committing. Each shot is mapped in `docs/readme-shots.json` to its test and the UI files it shows: `node scripts/readme-check.mjs [--base <sha>]` (run by `check:branch`, ADR 0208) fails a branch that changed those files without taking the shot again (opt out with a commit message line `shots: unchanged-visually [shot …]`), a README that is not English, a missing image and a page not mentioned |
| Drive the running app as an agent | MCP `http://127.0.0.1:<mcpPort>/mcp/app` (tools `app_state`, `app_chats`, `app_chat_items`, `app_pending`, `app_feed`, `app_logs`, `app_screenshot`, `app_ui` (`outline` = the screen now), `app_guide` (the app map, read live), `app_send_to_chat`, `app_close_chat`, `app_command_runs`); see ADR 0006. The Orchestrator's own mount also has `app_config` (every configuration, ADR 0149). Each Orchestrator calls its own `/mcp/app/o/<orchestratorId>/<token>` (ADR 0021), the only mount with `app_update_code` (ADR 0074); `/mcp/improve` and "Migliora l'app" are gone (ADR 0079) |
| A chat's app tool its engine did not give it | In the chat's own shell: `sb-tool list`, `sb-tool <tool> '<json>'`, `sb-tool <tool> --file args.json`, `sb-tool <tool> -` (stdin). The app writes it into `<userData>/bin` at start and puts that folder first on every chat engine's PATH, with the chat's own endpoint in `SB_CHAT_TOOLS`; it calls the same tool with the same checks (ADR 0356, `src/main/chats/tool-cli.ts`) |

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
| `app_pending` | Orchestrator, /mcp/app | The worker questions the Orchestrator holds, and the questions, permissions and commands waiting for the user, read only. |
| `app_resolve_question` | Orchestrator, /mcp/app | Answer a worker's question it holds (`answer` + `why`, or `askUser`: one level up to the user, ADR 0344); else answer a work chat's question, permission or plan as the user (ADR 0275: it counts as his own), a delegated chat's question only with his `words`; a production/DB/Azure permission needs `confirmed` after his yes. |
| `app_feed` | Orchestrator, /mcp/app | Recent live feed events (ideas, errors, chats done or waiting). |
| `app_logs` | Orchestrator, /mcp/app | Recent structured log entries (redacted), filtered by level, scope, chat or text. |
| `app_screenshot` | Orchestrator, /mcp/app | A screenshot of the app window and of each browser tab on screen. |
| `app_ui` | Orchestrator, /mcp/app | Steer the UI without taking focus: open a page, maximize a chat, or read the screen outline. |
| `app_create_chat` | Orchestrator, /mcp/app | Open a work chat that runs one role, started with a self-contained prompt; `map` links it to the pieces of a project map it works on (ADR 0330). |
| `app_assign_task` | Orchestrator, /mcp/app | Give a finished work chat a new measured task in the same role, on any engine; another folder (`cwd`, `place`) or the engine the user's order starts its role on now goes on in a linked chat (ADR 0359, 0360; a chat whose engine cannot run goes on in a new one on its card's engine, ADR 0352); `map` moves it to other pieces of the map. |
| `app_task_events` | Orchestrator, /mcp/app | The ordered user decisions of a root task (optional: app_assign_task returns the unread ones). |
| `app_send_to_chat` | Orchestrator, /mcp/app | Send a message to an app chat on any engine (a stopped or auto-closed one resumes; ADR 0352), labelled as not the user's approval. |
| `app_close_chat` | Orchestrator, /mcp/app | Close a chat for the user, like ✕: its engine, the tools it started and its delegation tree end; refused while it or an open descendant waits for the user. |
| `app_reopen_chat` | Orchestrator, /mcp/app | Reopen a closed chat with its whole history and engine; `reopened: true` or why not (a chat the user closed: only right after his own ask). |
| `app_handoff_chat` | Orchestrator, /mcp/app | Have a chat write its hand-off note now. |
| `app_continue_chat` | Orchestrator, /mcp/app | «Riprendi»: a new chat from the old chat's hand-off, in the last folder it used or in `cwd`, on the engine its role starts on now (ADR 0359, 0360). |
| `app_set_chat_effort` | Orchestrator, /mcp/app | Pick the reasoning effort of one running chat for this conversation only. |
| `app_set_chat_work` | Orchestrator, /mcp/app | Declare, wait on or complete a chat's explicit assignment (holds the auto-close). |
| `agent_catalog` | Orchestrator, /mcp/app, work chats | The roles with purpose, tools and skills, and the skills that fit a request. |
| `agent_learn_propose` | Orchestrator, /mcp/app, work chats | Propose a lesson for a role (its text or a skill), queued for the user. |
| `app_unblock` | Orchestrator only | Open the questions window with everything waiting for the user, after a recap he asked for. |
| `app_update_code` | Orchestrator only | Update the app's code from GitHub, only when the user asked in his own words. |
| `app_voice_diagnostics` | Orchestrator only | Content-free voice timing diagnostics (recognition, synthesis, failures). |
| `app_config` | Orchestrator only | Read and change any configuration as the user's own click would, with Undo: settings, view, role cards (their Minimo/Base/Massimo presets too), the one engine order and its thresholds (ADR 0359: a change it may not apply stays «da applicare» on a panel), MCP connectors (add, edit, test, remove, per role; never a token), profile. |
| `app_skills` | Orchestrator only | Every skill (brain, the user's folders, the app's) with files, roles and usage; one skill's files, file text or history. |
| `app_skill_write` | Orchestrator only | Create, change or delete a skill or one of its files (SKILL.md, scripts/, references/, assets/), logged with Undo; an app skill becomes a brain copy. |
| `app_skill_roles` | Orchestrator only | Give a skill to roles or take it away (a role's default skills stay on its own page). |
| `app_skill_undo` | Orchestrator only | Undo one change from a skill's history. |
| `app_work_list` | Orchestrator only | The persistent feature threads with stage, proposals and evidence. |
| `app_work_create` | Orchestrator only | Create one persistent thread for a feature, bugfix or investigation. |
| `app_work_report` | Orchestrator only | Update a thread's stage with concrete evidence. |
| `agent_lessons_waiting` | Orchestrator only | The lessons waiting for review and the ones the user rejected. |
| `brain_script_save` | Orchestrator only | Add, edit or fix a tested script in the brain's scripts/ folder. |
| `brain_script_delete` | Orchestrator only | Move a brain script to scripts/.deleted/ (restorable). |
| `brain_changelog_add` | Orchestrator only | Log a brain change made outside the script tools in the brain's changelog. |
| `app_recordings` | Orchestrator only | The call recordings and their local transcripts, or the audio files found on the PC. |
| `app_recording_import` | Orchestrator only | Import an audio or video file from the PC to be transcribed locally. |
| `app_learn` | Orchestrator only | Start an Impara lesson the user asked for (an explanation or a quiz), or list the lessons. |
| `app_news` | Orchestrator only | The user's newspaper by editions: the editions, or one edition's front page, sections and sources with their last reading. |
| `app_news_edition` | Orchestrator only | Create, change or delete an edition of the newspaper: name, what the user wants from it, sections, key words. |
| `app_news_source` | Orchestrator only | Try a link at zero tokens, then add, remove, pause or resume a source of an edition. |
| `app_news_refresh` | Orchestrator only | Refresh one edition or all now: reads the sources, one AI pass per edition, returns what it brought and its cost. |
| `app_project_map` | Orchestrator only | The user's work maps, one per Strategist job or idea (`jobs`, `job`, `idea`, `approve`, `keep`, `start`, `stop`, `resume`, `replan`, `archive`, `reopen`, `seen`: ADR 0342), and the project maps: list, read as text (ending with how far the project is, ADR 0326), open in the maps window (ADR 0275), the brief for a Scout that draws one, the user's corrections, piece-by-piece edits from the talk with the user (also a piece's place in the order, «together with the one before», a level as a line or in layers, an arrow to the next step: ADR 0322) and undo (ADR 0276); a brief with `question` has a Scout answer it as a path on the map (ADR 0316); `link` ties a work chat to the pieces it works on, and their status then follows the chat by itself (ADR 0330). |
| `app_agents_recap` | Orchestrator only | The recap: one short line per agent that works, waits or finished; with detail, one block per agent with its last steps. |
| `app_child_output` | Orchestrator only | The latest report of a chat in its tree, delegates included: summary and criteria; full: the output, max 4,000 chars. |
| `agent_metrics` | Orchestrator only | Success rate, cost, time and corrections per role and version (numbers only). |
| `task_estimate` | Orchestrator only | Estimate a request: kind of work, size, role, time and cost. |
| `agent_delegate` | work chats | Delegate independent parts of the task to other roles as visible child chats (Orchestrator and Strategist only; a parallel group starts in one call; a Sentinel takes `reviewOf`; `cwd` = any existing folder, `place` = here by default or copy, ADR 0360; `contract.tools` never limits what it may run, ADR 0355). |
| `agent_children` | work chats | The chats you delegated: role, state, goal, result, open requests, cost, why a task was closed early (`endCause`), and `waitsOn: "credits"` for a child whose model ran out of credits (it goes on when the user changes its role's card, ADR 0346). |
| `agent_ask_parent` | work chats | Ask up the ladder (the chat that delegated you, the Orchestrator, the user; ADR 0344) and go on with the rest. |
| `run_code` | work chats (Code Mode on) | Run a JavaScript script in a QuickJS sandbox that calls many tools in one go through a typed API (Bash, PowerShell, files, app tools, connectors); each call meets the same permission rules, an Esegui action stops the script (ADR 0331). |
| `agent_answer_child` | work chats | Answer a delegated chat's question that waits for you, or pass it one level up (`askUser`). |
| `agent_report` | work chats | Your one final result for the chat that started you; `amends: true` corrects it (at most 2 corrections, ADR 0224). |
| `agent_close_child` | work chats | Close one of your delegated chats and its tree, never while it waits for the user. |
| `agent_wake_later` | work chats | Schedule your own next turn in 1-1440 minutes (CI, a deploy, a slow job), kept across restarts; minutes 0 cancels. |
| `relay_question` | Orchestrator | Bring a work chat's Sì/No question to the user in its own conversation (Remote Control, phone, PC); the user's «sì» / «no» there answers it. |
| `agent_assign_task` | work chats | Continue your direct child with a separate task run (another folder or engine: a linked chat); the user's entries there you have not seen come back to you. |
| `agent_task_events` | work chats | The ordered user instructions for your direct child (optional before reassigning it). |
| `agent_integrate_child` | work chats | Stage one finished child's commits in a fresh detached worktree. |
| `agent_integrate_children` | work chats | Combine several finished children's commits in one staging worktree. |
| `agent_work_decisions` | work chats | The user's recorded decisions for your latest assignment, readable after reporting without reopening it. Historical decisions remain context, not new grants. |
| `ask_user` | work chats | Ask the user one Sì/No question as a panel (engines whose question tool may not reach the model: OpenCode, Cursor). |
| `plan_propose` | work chats | Show the user your short plan for approval (Strategist); `doubts` lists every real doubt, open or closed by the user, code or brain with its source, and one open keeps the plan from being shown (ADR 0344); `revise` re-proposes a saved plan to today's standards; on a project it is drawn on the project's map (`map`, each step's `on`: ADR 0276); each step may carry a `preset` (`min`/`base`/`max`, the role card's) and the map shows role · preset, never a model (ADR 0346). |
| `plan_update` | work chats | Move a step of your approved plan (now, done, blocked or todo), or add one found on the way (ADR 0276). |
| `list_chats` | work chats | The user's chats you can write to with send_to_chat. |
| `send_to_chat` | work chats | Send a message to another chat of the user, never as his approval. |
| `show_ui` | work chats | Show the user a visual from the app's component catalog instead of a wall of text. |
| `memory_recall` | work chats | Read the scoped memory of your role and project as quoted data. |
| `memory_propose` | work chats | Propose a scoped memory record for the user to review. |
| `brain_search` | work chats | Search the user's brain by meaning and words. |
| `brain_scripts` | work chats | The brain's tested reusable scripts with usage. |
| `brain_script_add` | work chats | Save a new script in the brain right after it ran and worked. |
| `project_map_read` | work chats | The user's project maps: the list, one map as text with statuses and agents and, on a map that tells a plan, how far the project is (ADR 0326), or one `element` in full (details, files, links). |
| `project_map_save` | work chats | Draw or redraw a project's map (people, systems, parts inside parts up to four levels, links, statuses, evidence files, `rules`, `keeps`, `why`, `keyFiles`, `paths`; ADR 0316), or as a sequence: kinds `phase` and `step` drawn in a line in the saved order, `par`, `layout`, links of kind `next`, `proofs`, `refs` (ADR 0322). |
| `project_map_update` | work chats | Say which elements of a map you work on (their status then follows the chat by itself, ADR 0330), update the status of anything else you finished, add `paths` or `drop_paths` by id (ADR 0316). |
| `brain_queries` | work chats | The brain's saved queries (SQL, KQL, GraphQL…). |
| `brain_query_add` | work chats | Save a new query in the brain right after it gave the right answer. |
| `artifact_save` | work chats | Declare the report, document or plan you wrote because the user asked for one: it shows in Memoria → Artifact (ADR 0328). |
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
| `fill_credential` | browser | Sign in with a test account of the credentials file: the app types the password, the agent never reads it. |
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
