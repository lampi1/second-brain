# second-brain app: agent guide

Desktop cockpit (Electron, Windows first) where the user runs their Claude Code and Cursor chats as tiles, answers their
questions and permissions as panels, watches internal browsers that agents drive over MCP, and sees his brain
(a brain folder chosen at setup) update live. Vision: `docs/VISION.md`. Architecture: `docs/architecture.md`. Decisions:
`docs/adr/`. UI language Italian; code, comments, commits and docs English.

## Commands

| What | Command |
|------|---------|
| Install (pinned, scripts off) | `npm ci` then `node node_modules/electron/install.js` (npm `ignore-scripts` is on: Electron's binary comes from this step) |
| Build | `npm run build` (esbuild main + preload, Vite renderer → `out/`) |
| Run | `npm start` (after a build) · `npm run dev` (dev build + run) |
| All checks | `npm run check` = typecheck + lint + unit + e2e. Must pass before every commit. |
| Unit / e2e only | `npm test` · `npm run test:e2e` (Playwright drives the real Electron app; screenshots in `test-results/shots/`) |
| Live tests (spend real tokens) | `SB_LIVE=1 npx vitest run test/live` (Claude only; never Cursor from a Claude agent) |
| Is the machine ready? | `npm run doctor` (`-- --json` for agents): build, Electron, CLIs, Claude login, brain, MCP port, today's errors |
| Logs | `npm run logs -- --level warn --since 1h [--scope chats] [--chat <id>] [--grep x] [--json]`; files in `%APPDATA%/second-brain/logs/` |
| Demo data (no CLIs, no tokens) | `SB_DEMO=1 npm start`; deterministic for screenshots: `SB_DEMO=1 SB_DEMO_FREEZE=1` |
| Drive the running app as an agent | MCP `http://127.0.0.1:<mcpPort>/mcp/app` (tools `app_state`, `app_chats`, `app_chat_items`, `app_pending`, `app_feed`, `app_logs`, `app_screenshot`, `app_ui`, `app_send_to_chat`); see ADR 0006 |

**Stable vs dev (ADR 0007).** The user's cockpit is a frozen release in `%LOCALAPPDATA%/second-brain/releases/`
started by `%LOCALAPPDATA%/second-brain/launch.cmd` (userData `second-brain`, MCP 4319). Anything run from this repo
is the dev instance (userData `second-brain-dev`, MCP 4329; `npm run doctor -- --dev`, `npm run logs -- --dev`).
Chats may start, test and kill the dev instance; never the stable one. Promotion (`npm run promote`: needs a clean
tree and a green `npm run check`) and `npm run rollback` are triggered by the user from the app, not by agents.

How an agent verifies a change by itself: `npm run check` → read the screenshots in `test-results/shots/` → if
something fails at runtime, `npm run logs -- --level warn --since 15m` → `npm run doctor`.

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
   files or logs, credentials never handled by the app (each CLI logs in itself).
3. **Dependencies:** only well-known packages, exact versions, published ≥ 14 days before install (`npm install
   --save-exact --before=<date>`), an ADR line for each new runtime dependency. Prefer writing 100 lines over adding a
   package with a large tree.
4. **Each harness spends only its own tokens.** The app starts `claude` only for Claude chats and `agent` only for
   Cursor chats, with the user's own login. An agent working on this repo inside Claude Code never runs the Cursor CLI.
5. **No production from the app**: no prod DB, no ops scripts, no write `az` commands are ever wired in.
6. **Coexistence**: the app never changes Claude desktop / Cursor config, hooks or settings files; it reads their
   transcripts and state read-only; an external session is resumed only as a fork (never two writers).
7. **Tests:** every module has unit tests; every user-visible feature has an e2e test with a screenshot; "done" =
   `npm run check` green + the screenshot looked at.
8. **Commits: local only** (owner decision, 2026-10-11): agents commit on their branch/worktree; never push,
   never add a remote. Conventional messages (`feat(chats): …`), English.
9. **Review:** before merging a branch, a fresh-context reviewer per touched dimension (security, correctness,
   UI/UX); fix what they confirm.
10. **Every file starts with a header comment**: what it does, why, who uses it. Decisions go to `docs/adr/`.
11. **Parallel agents:** one worktree per agent (`git worktree add ../second-brain-app-wt/<name> -b feat/<name>`),
    one module each; shared files (`contract.ts`, `wiring.ts`, `index.ts`) are changed only by the integrator.
