# second-brain app: agent guide

Desktop cockpit (Electron, Windows first) where the user runs their Claude Code and Cursor agents (a strip each in the
Grindhouse, coordinated by the Orchestrator), answers their questions and permissions as panels, watches internal browsers that agents drive over MCP, and sees their brain
(a brain folder chosen at setup) update live. Vision: `docs/VISION.md`. Architecture: `docs/architecture.md`. Decisions:
`docs/adr/`. Human contributors: `CONTRIBUTING.md`. UI language Italian; code, comments, commits and docs English.

Words used everywhere: **Orchestrator** = the coordinating chat and the one place where work starts (it plans, opens
role chats, answers their mail; a full-height column on the right; it sees the work chats' state and the user's own
messages to them, never their content, ADR 0083); **role** = one of nine fixed roles (Orchestrator, Strategist,
Scout, Artisan, Sentinel, Herald, Router, Judge, Scribe) a chat runs; **delegation** = a role chat starting visible
child chats with `agent_delegate` (permissions only go down, questions go to the parent first, one `agent_report`
back, ADR 0083); **Grindhouse** = the home page, the one place for the
agents (a strip each, the browsers they drive under them; the old Mosaico / Corsie views are retired, ADR 0068);
**agent** = who works: a chat running a role, whose tools, ceiling, tier and skills decide its engine, model and
permissions (not a per-chat choice or a routing row, ADR 0078, 0083); **skill** = how a job is
done (`SKILL.md`, shared, loaded on demand; there are no "procedures", ADR 0077); **Brain** section = Agenti, Skill,
Regole, Memoria, Classificatori, Mappa; **brain** = the user's folder of notes, rules and tools the agents read and
write (a template ships in the product; a fresh install starts empty); **Task** = the page of the user's work items and
PRs (Azure DevOps, read only; called DevOps before ADR 0079); **stable / dev** = the user's frozen release vs. anything
run from this repo; **Aggiorna** (the button, Settings → Aggiornamenti) = update the app to main's tip.

## Commands

| What | Command |
|------|---------|
| Install (pinned, scripts off) | `npm run setup` = `npm ci` then `node node_modules/electron/install.js` (`.npmrc` turns `ignore-scripts` on: Electron's binary comes from the second step) then `node scripts/setup-hooks.mjs` (sets `core.hooksPath .githooks`, prints the optional guard config, never sets it) |
| Guard (ADR 0061) | The repo is public product: `.githooks/pre-commit` scans the staged content, `.githooks/pre-push` every new commit (files and their names, message, author, committer), the pushed ref names and annotated tags, both with `tools/guard/scan.mjs`, the repo's `.guardallow` and the private list in git config `guard.denyList` (set but missing → blocked); `guard.email` = the only e-mail allowed on commits. A block prints file:line + rule, never the value, and the fix. By hand: `node tools/guard/scan.mjs . [--history] [--deny <file>] --allow .guardallow`. Status: `npm run doctor`. CI runs it on the whole history (built-in rules). Never `--no-verify`; a false positive is pinned in `.guardallow` (path, rule, sha256), reviewed like code |
| Build | `npm run build` (esbuild main + preload, Vite renderer → `out/`) |
| Run | `npm start` (after a build) · `npm run dev` (dev build + run) |
| Run as an agent (always) | `SB_HIDDEN=1 npm start` / `SB_HIDDEN=1 npm run dev`: the window renders off screen, out of the taskbar, never takes focus, no Windows toasts; see it with `app_screenshot` (MCP) or `capturePage`. The e2e suite and `test:stable` set it themselves: no test may show a window or take focus (owner, 2026-10-11). The stable copy never sets it. |
| Light check (branches) | `npm run check:branch` = typecheck + lint of the changed files + the unit tests related to them + the guard on them (same scanner and deny list as the hooks); **no e2e** (owner, 2026-10-15: the e2e runs only on main, in `npm run check`). Green on a clean tree it records the tip as "tested (light)". What a branch needs before it is merged (ADR 0027). |
| All checks (main) | `npm run check` = typecheck + lint + unit beside the e2e (in parallel, ADR 0042). Runs only on main, after a merge, one at a time (never two heavy suites at once on one machine); `npm run promote` runs it too (ADR 0027); the "Aggiorna" button does not (ADR 0075). |
| Unit / e2e only | `npm test` · `npm run test:e2e` (Playwright drives the real Electron app; screenshots in `test-results/shots/`). The e2e runs spec files in parallel, as many workers as the machine takes now (`SB_E2E_WORKERS=n` to force), then the specs listed in `EXCLUSIVE` (`playwright.config.ts`: timings, the system clipboard) one at a time; `node scripts/e2e.mjs <specs>` for a few (ADR 0042). A new spec that times things or reads the system clipboard goes in `EXCLUSIVE`. |
| Live tests (spend real tokens) | `SB_LIVE=1 npx vitest run test/live` (Claude only; never Cursor from a Claude agent) |
| CLI contracts (ADR 0055) | `npm run logs -- --scope drift` (a CLI sent something unknown) · `node scripts/cli-fixtures.mjs` (dev records → `test/fixtures/cli`) · `npx vitest run test/unit/chats/cli-contract.test.ts` (replay, no tokens) |
| Update a clone from GitHub (ADR 0074, 0075) | Settings → Aggiornamenti → "Aggiorna" (the user's click: pull, build, restart, no tests; stable copies via `release.mjs promote-now`) or `npm run pull` (fast-forward main only, `npm ci` if the lockfile changed, build); the Orchestrator runs it with `app_update_code` only when the user asks |
| Is the machine ready? | `npm run doctor` (`-- --json` for agents): build, Electron, CLIs, Claude login, brain, MCP port, today's errors |
| Logs | `npm run logs -- --level warn --since 1h [--scope chats] [--chat <id>] [--grep x] [--json]`; files in `%APPDATA%/second-brain-dev/logs/` (dev, `--dev`) or `%APPDATA%/second-brain/logs/` (stable) |
| Demo data (no CLIs, no tokens) | `npm run demo` (build + fake chats, tabs and a synthetic brain; `-- --frozen` fixed clock, `-- --hidden` for agents); bare: `SB_DEMO=1 npm start` (brain pages empty), deterministic: `SB_DEMO_FREEZE=1` |
| README screenshots | `npm run shots` (frozen demo → `docs/screenshots/*.webp`, < 300 KB each); look at them before committing |
| Drive the running app as an agent | MCP `http://127.0.0.1:<mcpPort>/mcp/app` (tools `app_state`, `app_chats`, `app_chat_items`, `app_pending`, `app_feed`, `app_logs`, `app_screenshot`, `app_ui`, `app_send_to_chat`, `app_close_chat`, `app_command_runs`); see ADR 0006. Each Orchestrator calls its own `/mcp/app/o/<orchestratorId>/<token>` (ADR 0021), the only mount with `app_update_code` (ADR 0074); `/mcp/improve` and "Migliora l'app" are gone (ADR 0079) |

**Stable vs dev (ADR 0007).** The user's cockpit is a frozen release in `%LOCALAPPDATA%/second-brain/releases/`
started by `%LOCALAPPDATA%/second-brain/launch.cmd` (userData `second-brain`, MCP 4319). Anything run from this repo
is the dev instance (userData `second-brain-dev`, MCP 4329; `npm run doctor -- --dev`, `npm run logs -- --dev`).
Chats may start, test and kill the dev instance; never the stable one. Updating the stable copy is the user's: "Aggiorna" in Settings →
Aggiornamenti (main's tip, without the test suite, ADR 0075, 0079) or `npm run promote` (needs a clean tree and a green
`npm run check`) from a terminal; `npm run rollback` from a terminal; never by agents.

How an agent verifies a change by itself: on its branch `npm run check:branch` (no e2e there; the e2e runs only in the
full `npm run check`, the Orchestrator's, on main after the merge) → a visible change: see it in the dev app
(`SB_HIDDEN=1 npm run dev`, `app_screenshot`) → if something fails at runtime,
`npm run logs -- --level warn --since 15m` → `npm run doctor`. A new or changed e2e spec is written on the branch but
first runs on main: say so in the hand-off, so the Orchestrator knows which branch to look at if it goes red.

## Layout

- `src/shared/contract.ts`: THE contract: data shapes + IPC channels. Change it first, then both sides.
- `src/main/`: main process. `index.ts` (bootstrap + handlers), `wiring.ts` (builds services), `services.ts`
  (interfaces), `ipc.ts` (typed IPC, sender check), `window.ts`; modules: `chats/` (CLI harnesses: Claude stream-json,
  Cursor ACP; chat manager; external chats), `browser/` (tabs as WebContentsViews, page scripts), `mcp/` (local MCP
  server), `brain/` (brain folder, live feed, notifications, usage, estimates, budget), `appctl/` (app-control MCP tools),
  `log.ts` (structured logs: `import { log } from './log'`; errors need `cause` + `hint`), `demo.ts` (fake services).
- `src/preload/index.ts`: the allow-listed bridge `window.sb` (invoke/on). Nothing else crosses.
- `src/renderer/`: React UI. Never imports main, preload, Node or Electron (lint enforces it).
- `test/unit` (Vitest, node), `test/e2e` (Playwright `_electron`), `test/live` (opt-in, real CLIs).

## Rules

1. **Contract first, typed IPC only.** No `ipcRenderer`/`ipcMain` outside `preload/index.ts` and `main/ipc.ts`.
2. **Security baseline (never relax):** `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP in `index.html`, IPC
   sender check, browser tabs in their own partition, MCP bound to 127.0.0.1 with Host/Origin checks, no secrets in
   files or logs, credentials never handled by the app (each CLI logs in itself) with two exceptions: a login
   hand-off's password, read from the user's brain file only when they click Copia, never stored or logged (ADR 0012);
   the API keys the user types in Settings → Motori, encrypted with safeStorage, write-only from the UI, given only to
   their own engine's process env or HTTP header (ADR 0046; the Cursor Cloud Agents key only to api.cursor.com, ADR 0080).
3. **Dependencies:** only well-known packages, exact versions, published ≥ 14 days before install (`npm install
   --save-exact --before=<date>`), an ADR line for each new runtime dependency. Prefer writing 100 lines over adding a
   package with a large tree.
4. **Each harness spends only its own tokens.** The app starts `claude` only for Claude chats and `agent` only for
   Cursor chats and for the token-free login check (`agent status`), with the user's own login; a cloud agent
   (`claude --cloud`, `codex cloud`, Cursor's API with its own key) spends only its own vendor's plan or key (ADR 0080). An agent working on this repo inside Claude Code never runs the Cursor CLI.
5. **No production from the app**: no prod DB, no ops scripts, no write `az` commands are ever wired in.
6. **Coexistence**: the app never changes Claude desktop / Cursor config, hooks or settings files; it reads their
   transcripts and state read-only; an external session is resumed only as a fork (never two writers).
7. **Tests:** every module has unit tests; every user-visible feature has an e2e test with a screenshot; "done" =
   `npm run check:branch` green on the branch's commit (no e2e) + the change looked at in the dev app; the e2e specs
   and their screenshots run only on main, in `npm run check` after the merge (owner, 2026-10-15; ADR 0027).
   Load tests, stress tests, synthetic CPU/RAM load generators, benchmarks under load and e2e runs repeated to load
   the machine run only at night, outside the owner's working hours; never during the day on their work PC (owner,
   2026-10-15).
8. **Commits: local only for agents**: agents commit on their branch/worktree; pushing, adding remotes and opening
   pull requests are the human's steps. Conventional messages (`feat(chats): …`), English.
9. **Review:** before merging a branch, a fresh-context reviewer per touched dimension (security, correctness,
   UI/UX); fix what they confirm.
10. **Every file starts with a header comment**: what it does, why, who uses it. Decisions go to `docs/adr/`.
11. **Parallel agents:** one worktree per agent (`git worktree add ../second-brain-wt/<name> -b feat/<name>`),
    one module each; shared files (`contract.ts`, `wiring.ts`, `index.ts`) are changed only by the integrator.
