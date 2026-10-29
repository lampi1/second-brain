# Layout

Where the code lives. Moved from `AGENTS.md` (ADR 0198); the full picture is in `docs/architecture.md`.

- `src/shared/contract.ts`: THE contract: data shapes + IPC channels. Change it first, then both sides. The shapes and
  each area's invoke channels live in `src/shared/contract/*.ts` (chats, browser, settings, brain, agents, …); the entry
  re-exports them and assembles `InvokeMap` / `EventMap` / the channel lists, so imports stay `@shared/contract`.
- `src/main/`: main process. `index.ts` (bootstrap: builds the window, the services and a `HandlerContext`, registers
  the handlers), `ipc-handlers/*.ts` (the IPC handlers per area: chats, browser, app, settings, brain, agents, media;
  each returns `HandlersOf<its prefixes>`), `wiring.ts` (builds services; `wiring-types.ts` = `Ctx` / `Wired`,
  `wiring-shared.ts` = steps shared with `demo-wiring.ts`, `wiring-builders.ts` = self-contained builders),
  `services.ts` (interfaces), `ipc.ts` (typed IPC, sender check), `window.ts`; modules: `chats/` (CLI harnesses: Claude
  stream-json, Cursor ACP; chat manager; external chats), `browser/` (tabs as WebContentsViews, page scripts), `mcp/`
  (local MCP server), `brain/` (brain folder, live feed, notifications, usage, estimates, budget), `appctl/`
  (app-control MCP tools), `log.ts` (structured logs: `import { log } from './log'`; errors need `cause` + `hint`),
  `demo.ts` (fake services).
- `src/main/chats/manager.ts`: `ChatManager`, built in layers (ADR 0200): abstract classes in
  `chats/manager-*.ts`, each extending the one before: `core` (fields, constructor, items) → `persistence` (chats.json,
  agent runs) → `sessions` (engines, warm pool, kill) → `checkpoints` (ADR 0103, receipts) → `requests` (questions,
  permissions, away mode) → `continuity` (hand-offs, cold notes) → `delegation` (reports, turn end) → `lifecycle` (stop,
  archive, auto-close, shutdown) → `work` (assignments, user events, plans) → `sink` (session reports) → `manager.ts`
  (create, send, deliver, Flash, set). Shapes in `manager-types.ts` (`Rec`, options), constants in `manager-helpers.ts`.
  A method goes in the layer of its concern; one a lower layer calls is declared `abstract` there. Callers import only
  `./chats/manager`.
- `src/preload/index.ts`: the allow-listed bridge `window.sb` (invoke/on). Nothing else crosses.
- `src/renderer/`: React UI. Never imports main, preload, Node or Electron (lint enforces it).
- `test/unit` (Vitest, node), `test/e2e` (Playwright `_electron`; `known-red.json` = the baseline of tests red on main,
  ADR 0198), `test/live` (opt-in, real CLIs).
