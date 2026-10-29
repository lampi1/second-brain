# Layout

Where the code lives. Moved from `AGENTS.md` (ADR 0198); the full picture is in `docs/architecture.md`.

- `src/shared/contract.ts`: THE contract: data shapes + IPC channels. Change it first, then both sides.
- `src/main/`: main process. `index.ts` (bootstrap + handlers), `wiring.ts` (builds services), `services.ts`
  (interfaces), `ipc.ts` (typed IPC, sender check), `window.ts`; modules: `chats/` (CLI harnesses: Claude stream-json,
  Cursor ACP; chat manager; external chats), `browser/` (tabs as WebContentsViews, page scripts), `mcp/` (local MCP
  server), `brain/` (brain folder, live feed, notifications, usage, estimates, budget), `appctl/` (app-control MCP tools),
  `log.ts` (structured logs: `import { log } from './log'`; errors need `cause` + `hint`), `demo.ts` (fake services).
- `src/preload/index.ts`: the allow-listed bridge `window.sb` (invoke/on). Nothing else crosses.
- `src/renderer/`: React UI. Never imports main, preload, Node or Electron (lint enforces it).
- `test/unit` (Vitest, node), `test/e2e` (Playwright `_electron`; `known-red.json` = the baseline of tests red on main,
  ADR 0198), `test/live` (opt-in, real CLIs).
